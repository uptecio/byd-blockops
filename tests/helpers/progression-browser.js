import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { startServer } from '../../server/server.mjs';
import { emulateLegacyWebView } from './legacy-webview.js';
import { walkSolo } from './loot-browser.js';

export async function persistentFixture({legacy=false,viewport={width:1200,height:700},artifactDir='artifacts/xp-progression-browser',fullChromium=false}={}) {
  await mkdir(artifactDir,{recursive:true});
  const userDataDir=await mkdtemp(join(resolve(artifactDir),'profile-'));
  const server=await startServer({port:0,distDir:process.env.DIST_DIR||'dist'}),origin=`http://127.0.0.1:${server.port}`;
  const errors=[];let context,page;
  async function launch() {
    context=await chromium.launchPersistentContext(userDataDir,{headless:true,...(fullChromium?{executablePath:chromium.executablePath()}:{}),viewport,hasTouch:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    if(legacy)await emulateLegacyWebView(context);
    await context.addInitScript(()=>{
      const native=requestAnimationFrame.bind(window);let previous;
      window.__lootObservation={seconds:0};
      window.requestAnimationFrame=callback=>native(now=>{
        if(previous!==now){if(previous!==undefined&&document.body?.dataset.mode==='playing')window.__lootObservation.seconds+=Math.min(.05,(now-previous)/1000);previous=now;}
        callback(now);
      });
    });
    page=context.pages()[0]||await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    page.on('response',response=>{if(response.status()>=400&&!response.url().endsWith('/favicon.ico'))errors.push(`${response.status()} ${response.url()}`);});
    await page.goto(origin);await page.waitForSelector('body[data-mode="home"]');
    return page;
  }
  try{await launch();}catch(error){await context?.close();await server.close();throw error;}
  return {get page(){return page;},origin,userDataDir,
    async reopen(){await context.close();return launch();},
    clean(){assert.deepEqual(errors,[],'no runtime or asset errors');},
    async close(){await context?.close();await server.close();},
  };
}
export const readProfile=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('block-ops-progression-v1')));
export async function setupSolo(page) {
  await page.locator('#home-settings').click();await page.locator('#bots').fill('1');
  await page.locator('#difficulty').selectOption('easy');await page.locator('#sensitivity').fill('1');
  await page.locator('#sound').uncheck();await page.locator('#settings-done').click();
  await page.locator('[data-map="courtyard"]').click();await page.locator('[data-mode-id="ffa"]').click();
  await page.locator('#home-armory').click();await page.locator('[data-class="sniper"]').click();
  await page.locator('[data-weapon="awp"]').click();await page.locator('#armory-home').click();
}
export async function goHome(page) {
  const mode=await page.locator('body').getAttribute('data-mode');
  await page.locator(mode==='results'?'#results-home':'#home-button').click();
  if(await page.locator('#confirm-home-screen').isVisible())await page.locator('#confirm-home').click();
  await page.waitForSelector('body[data-mode="home"]');
}
export async function dragAim(page,dx,dy=0) {
  const {width,height}=page.viewportSize(),steps=Math.max(1,Math.ceil(Math.max(Math.abs(dx),Math.abs(dy))/150));
  for(let i=0;i<steps;i++) {
    await page.mouse.move(width*.54,height*.45);await page.mouse.down();
    await page.mouse.move(width*.54+dx/steps,height*.45+dy/steps,{steps:2});await page.mouse.up();
  }
}
// Passive screenshot vision: find an enemy's red world-space health bar, not
// internal actor objects, scores or a production automation hook.
export async function visibleBot(page) {
  const png=(await page.screenshot()).toString('base64');
  return page.evaluate(async png=>{
    const image=new Image();image.src=`data:image/png;base64,${png}`;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const {width,height}=canvas,pixels=ctx.getImageData(0,0,width,height).data;
    const rows=[];
    for(let y=Math.floor(height*.27);y<height*.70;y++) {
      let first=-1,last=-1;
      for(let x=width*.16|0;x<width*.84;x++) {
        const i=(y*width+x)*4,r=pixels[i],g=pixels[i+1],b=pixels[i+2];
        // World-space health bar uses unlit #f45b4f. Coral roof edges are
        // #ca724e, so a broad red threshold incorrectly aims at scenery.
        const match=r>225&&g>65&&g<115&&b>55&&b<105;
        if(match){if(first<0)first=x;last=x;}
        else if(first>=0){if(last-first>=3&&last-first<150)rows.push({x:(first+last)/2,y,w:last-first+1});first=last=-1;}
      }
    }
    const groups=[];
    for(const row of rows){let group=groups.find(g=>Math.abs(g.x-row.x)<4&&row.y-g.lastY<=2&&row.y>=g.lastY);if(!group){group={x:row.x,top:row.y,lastY:row.y,w:row.w,count:0};groups.push(group);}group.lastY=row.y;group.w=Math.max(group.w,row.w);group.count++;}
    const bars=groups.filter(g=>g.w>=4&&g.lastY-g.top<Math.max(3,g.w*.18)&&g.count>=1);
    bars.sort((a,b)=>b.w-a.w);
    if(!bars.length)return null;const bar=bars[0];
    return {x:bar.x,y:(bar.top+bar.lastY)/2+bar.w*.7,width,height,barWidth:bar.w};
  },png);
}
// Zombies' green heads sit at eye height. Restricting vision to that narrow
// horizontal band avoids confusing the holder's green sleeves with enemies.
// Neon City is used by the existing Zombies acceptance route (no green trees).
export async function visibleZombie(page) {
  const png=(await page.screenshot()).toString('base64');
  return page.evaluate(async png=>{
    const image=new Image();image.src=`data:image/png;base64,${png}`;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const {width,height}=canvas,pixels=ctx.getImageData(0,0,width,height).data,columns=[];
    for(let x=75;x<width-75;x++){let count=0;for(let y=Math.floor(height/2)-8;y<height/2+10;y++){
      const i=(y*width+x)*4,r=pixels[i],g=pixels[i+1],b=pixels[i+2];
      if(r>60&&g>100&&g>r*1.1&&g>b*1.25&&b>35)count++;
    }if(count>=2)columns.push({x,count});}
    const clusters=[];for(const p of columns){let c=clusters[clusters.length-1];if(!c||p.x-c.last>4){c={sum:0,weight:0,last:p.x};clusters.push(c);}c.sum+=p.x*p.count;c.weight+=p.count;c.last=p.x;}
    clusters.sort((a,b)=>b.weight-a.weight);return clusters[0]?{x:clusters[0].sum/clusters[0].weight,y:height/2,width,height}:null;
  },png);
}
export async function fightSolo(page,targetKills,{artifactDir,label='solo'}={}) {
  await page.waitForSelector('body[data-mode="playing"]');
  await walkSolo(page,'KeyW',10);
  let previousKills=-1,frame=0,searchSteps=0;const deadline=Date.now()+300000;
  while(Date.now()<deadline) {
    const mode=await page.locator('body').getAttribute('data-mode');
    const score=await page.locator(mode==='results'?'#result-kills':'#kills').textContent();
    const kills=Number(score.startsWith('RED ')?score.match(/^RED (\d+)/)[1]:score);
    if(kills!==previousKills){console.log(`REAL SOLO ${label}: kills=${kills}, XP=${(await readProfile(page).catch(()=>null))?.lifetimeXP??'temporary'}`);previousKills=kills;}
    if(kills>=targetKills){await page.keyboard.up('KeyF');return;}
    assert.equal(mode,'playing',`round must stay live until ${targetKills} genuine eliminations`);
    if(Number(await page.locator('#health-count').textContent())<=0){await page.waitForTimeout(300);continue;}
    if(Number(await page.locator('#ammo-count').textContent())===0){await page.keyboard.press('KeyR');await page.waitForTimeout(500);continue;}
    const target=await visibleBot(page);
    if(frame++%20===0&&artifactDir)await page.screenshot({path:`${artifactDir}/${label}-aim-${frame}.png`});
    if(target){
      searchSteps=0;const focal=target.height/(2*Math.tan(75*Math.PI/360));
      const dx=Math.atan((target.x-target.width/2)/focal)/.0026,dy=Math.atan((target.y-target.height/2)/focal)/.0026;
      if(Math.abs(dx)>2||Math.abs(dy)>2)await dragAim(page,dx,dy);
      await page.keyboard.down('KeyF');await page.waitForTimeout(140);await page.keyboard.up('KeyF');
    }else{
      // At melee distance an approaching bot can fill the screen with its
      // health bar above the viewport. Keep firing through the normal controls
      // while searching rather than waiting indefinitely inside that model.
      await page.keyboard.down('KeyF');await page.waitForTimeout(140);await page.keyboard.up('KeyF');
      if(++searchSteps%6===0)await dragAim(page,140);
      await page.waitForTimeout(180);
    }
  }
  assert.fail(`Visual-control player did not reach ${targetKills} kills (${label})`);
}

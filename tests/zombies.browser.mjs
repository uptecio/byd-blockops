import assert from 'node:assert/strict';
import { PROTOCOL_VERSION } from '../src/protocol.js';
import { mkdir } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { fixture, walkSolo, until, onlinePair } from './helpers/loot-browser.js';
import { emulateLegacyWebView } from './helpers/legacy-webview.js';
import { readProfile } from './helpers/progression-browser.js';
import { observeGame, aimAt, followRoute } from './helpers/traversal-browser.js';
import { MAPS } from '../src/maps.js';
import { createNavigation } from '../src/navigation.js';
import { createSpatialWorld, segmentClear } from '../src/spatial.js';

const legacy=process.env.LEGACY_WEBVIEW==='1';
const artifacts=process.env.ARTIFACT_DIR || process.env.ZOMBIE_ARTIFACTS || 'artifacts/zombies-review';
const f=await fixture(),page=f.pages[0];
const home=async()=>{ await page.locator('#home-button').tap(); await page.locator('#confirm-home').tap(); };
async function start(mapId='courtyard') {
  await page.locator(`[data-map="${mapId}"]`).tap();
  await page.locator('[data-mode-id="zombies"]').tap();
  await page.locator('#home-solo').tap();
  await page.waitForSelector('body[data-mode="playing"]');
  assert.match(await page.locator('#hud-mode').textContent(),/ZOMBIE/);
  assert.equal(await page.locator('#loot-inventory').isVisible(),true);
  assert.equal(await page.locator('#fatal-screen').isHidden(),true);
  assert.notEqual(await page.locator('#timer').textContent(),'03:00');
}
// Screenshot targeting plus passive path observations for exploration. No
// production hooks, teleports, health changes, grants or skipped waves.
async function visibleHead() {
  const screenshot=(await page.screenshot()).toString('base64');
  return page.evaluate(async data=>{
    const image=new Image(); image.src=`data:image/png;base64,${data}`; await image.decode();
    const canvas=document.createElement('canvas'); canvas.width=image.width; canvas.height=image.height;
    const ctx=canvas.getContext('2d'); ctx.drawImage(image,0,0);
    const { width,height }=canvas,pixels=ctx.getImageData(0,0,width,height).data;
    const columns=[];
    for(let x=75;x<width-75;x++) {
      let count=0;
      for(let y=Math.floor(height/2)-8;y<height/2+10;y++) {
        const i=(y*width+x)*4,r=pixels[i],g=pixels[i+1],b=pixels[i+2];
        if(r>60 && g>100 && g>r*1.1 && g>b*1.25 && b>35) count++;
      }
      if(count>=2) columns.push({x,count});
    }
    const clusters=[];
    for(const p of columns) {
      let c=clusters[clusters.length-1];
      if(!c || p.x-c.last>4) {c={sum:0,weight:0,last:p.x}; clusters.push(c);}
      c.sum+=p.x*p.count; c.weight+=p.count; c.last=p.x;
    }
    clusters.sort((a,b)=>b.weight-a.weight);
    return clusters[0] ? { x:clusters[0].sum/clusters[0].weight,width,height } : null;
  },screenshot);
}
async function aim(dx) {
  const segments=Math.ceil(Math.abs(dx)/180);
  for(let i=0;i<segments;i++) {
    await page.mouse.move(600,240); await page.mouse.down();
    await page.mouse.move(600+dx/segments,240,{steps:2}); await page.mouse.up();
  }
}
async function fightUntilWaveThree() {
  // Software rendering can advance far less simulation time than wall time.
  // Retain the two-wave assertions while allowing genuine patrol/search play.
  const deadline=Date.now()+360000; let lastRecovery=0, lastFighting=1, frame=0;
  const observation=await observeGame(page),map=MAPS.find(m=>m.id==='neon-city'),navigation=createNavigation(map,{radius:.34}),world=createSpatialWorld(map);
  await aim(Math.PI/.0026);
  try {
    while(Date.now()<deadline) {
      assert.equal(await page.locator('body').getAttribute('data-mode'),'playing','visual-control player survives to runner wave');
      const wave=Number((await page.locator('#kills').textContent()).match(/\d+/)?.[0]);
      const timer=await page.locator('#timer').textContent();
      if(timer.startsWith('NEXT WAVE')) {
        await page.keyboard.up('KeyS');
        await page.keyboard.down('KeyF');
        if(lastRecovery!==wave) {
          lastRecovery=wave;
          assert.equal(Number(await page.locator('#ammo-count').textContent())+Number(await page.locator('#reserve-count').textContent()),500);
          assert.equal(await page.locator('#health-count').textContent(),'100');
          assert.equal(await page.locator('#fire-button').isDisabled(),true);
          await page.screenshot({path:`${artifacts}/recovery-${wave}-${legacy?'legacy':'modern'}.png`});
          const before=await page.locator('#ammo-count').textContent();
          await page.locator('#pause-button').tap(); const frozen=await page.locator('#timer').textContent();
          await page.waitForTimeout(250); assert.equal(await page.locator('#timer').textContent(),frozen);
          await page.keyboard.up('KeyF'); await page.locator('#resume-button').tap(); await page.keyboard.down('KeyF');
          // Simulate a stalled frame without changing simulation state. Main's
          // existing frame clamp must prevent consuming a 10-second break.
          await page.evaluate(()=>{ const end=performance.now()+300; while(performance.now()<end){} });
          assert.match(await page.locator('#timer').textContent(),/NEXT WAVE/);
          assert.equal(await page.locator('#ammo-count').textContent(),before);
          console.log(`PASS real wave ${wave}: kills, health/ammo refill, held fire suppression and paused recovery`);
        }
        await page.waitForTimeout(100); continue;
      }
      if(wave>=3) {
        // Wave 3 interleaves runners after its first few staggered spawns.
        await page.keyboard.up('KeyF'); await page.keyboard.up('KeyS');
        const entered=await page.evaluate(()=>window.__lootObservation.seconds);
        await page.waitForFunction(entered=>window.__lootObservation.seconds-entered>=5.2,entered,{timeout:25000});
        await page.screenshot({path:`${artifacts}/runner-wave-${legacy?'legacy':'modern'}.png`}); return;
      }
      await page.keyboard.up('KeyF');
      if(wave!==lastFighting) {await aim(Math.PI/.0026); lastFighting=wave;}
      if(Number(await page.locator('#ammo-count').textContent())===0) await page.keyboard.press('KeyR');
      const target=await visibleHead();
      if(frame++%10===0) {
        console.log('VISUAL',frame,JSON.stringify(target),'health',await page.locator('#health-count').textContent(),'ammo',await page.locator('#ammo-count').textContent());
        await page.screenshot({path:`${artifacts}/aim-${frame}-${legacy?'legacy':'modern'}.png`});
      }
      if(target) {
        const focal=target.height/(2*Math.tan(75*Math.PI/360));
        const angle=Math.atan((target.x-target.width/2)/focal);
        if(Math.abs(angle)>.007) await aim(angle/.0026);
        await page.keyboard.down('KeyS');
        await page.keyboard.press('KeyF',{delay:70});
      } else {
        await page.keyboard.up('KeyS');
        // Rotation/short-forward loops can circle a corner indefinitely now
        // that enemies patrol instead of tracking through walls. Observe only
        // position, then physically follow a supported waypoint into view.
        const state=await observation.read(),own=state.player;
        const enemy=state.actors.filter(a=>a.id!=='local'&&a.alive).sort((a,b)=>Math.hypot(a.x-own.x,a.z-own.z)-Math.hypot(b.x-own.x,b.z-own.z))[0];
        if(enemy) {
          await aimAt(page,observation.actor,Math.atan2(own.x-enemy.x,own.z-enemy.z),0);
          if(!segmentClear({...own,y:own.y+1.6},{...enemy,y:enemy.y+1.58},world)) {
            const next=navigation.nextWaypoint(own,enemy);
            if(next)await followRoute(page,observation.actor,[next],{map,timeout:15000});
          }
        }
      }
      await page.waitForTimeout(40);
    }
    assert.fail('real control play did not reach wave three');
  } finally { await page.keyboard.up('KeyF'); await page.keyboard.up('KeyS'); await observation.close(); }
}
try {
  await mkdir(artifacts,{recursive:true});
  if(legacy) for(const p of f.pages) await emulateLegacyWebView(p.context());
  await page.goto(f.base);
  assert.equal(await page.locator('[data-mode-id]').count(),4,'Zombies must exist in Home, absent in the old baseline');
  for(const map of ['courtyard','dust-town','neon-city','snow-base','jungle-ruins','harbor','desert-fort','space-station']) {
    await start(map); await page.screenshot({path:`${artifacts}/start-${map}-${legacy?'legacy':'modern'}.png`}); await home();
  }
  await start();
  await walkSolo(page,'KeyW',3); await walkSolo(page,'KeyA',6);
  const frag=page.locator('[data-inventory-key="grenade:frag"]'); await frag.waitFor(); await frag.tap();
  assert.equal(await frag.getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#grenade-picker').isHidden(),true);
  await page.locator('#pause-button').tap(); const ammo=await page.locator('#ammo-count').textContent();
  await page.keyboard.down('KeyF'); await page.waitForTimeout(200); await page.keyboard.up('KeyF');
  assert.equal(await page.locator('#ammo-count').textContent(),ammo);
  await page.locator('#resume-button').tap(); await home();
  const beforeZombieXP=(await readProfile(page)).lifetimeXP;
  await start('neon-city'); await fightUntilWaveThree();
  await page.waitForSelector('body[data-mode="results"]',{timeout:90000});
  assert.equal(await page.locator('#result-kills').textContent(),'2');
  const genuineZombieKills=Number(await page.locator('#result-deaths').textContent());
  assert.equal((await readProfile(page)).lifetimeXP-beforeZombieXP,genuineZombieKills*2+2*25+50,'genuine zombie kills, two cleared waves and one natural game-over bonus');
  assert.match(await page.locator('#results-progression').textContent(),/Waves \+50.*Match finish \+50/);
  assert.match(await page.locator('#zombie-best').textContent(),/2 WAVES/);
  await page.screenshot({path:`${artifacts}/results-${legacy?'legacy':'modern'}.png`});
  await page.locator('#again-button').tap(); await page.waitForSelector('body[data-mode="playing"]');
  assert.equal(await page.locator('#kills').textContent(),'WAVE 1'); await home();
  const peers=await onlinePair(f);
  assert.equal(peers[0].room.modeId,'ffa');
  assert.equal(await page.locator('#room-mode option').count(),3);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(200); await page.keyboard.up('KeyW');
  await page.locator('#home-button').tap(); await page.locator('#confirm-home').tap();
  await f.pages[1].locator('#home-button').tap(); await f.pages[1].locator('#confirm-home').tap();
  await until(async()=> (await (await fetch(`${f.base}/health`)).json()).rooms===0,'owned test rooms removed');
  const socket=new WebSocket(`${f.base.replace('http:','ws:')}/ws`);
  await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
  const response=new Promise(resolve=>socket.once('message',message=>resolve(JSON.parse(String(message)))));
  socket.send(JSON.stringify({type:'create',protocol: PROTOCOL_VERSION,name:'Invalid',weaponId:'m4a1',mapId:'courtyard',skinId:'ranger',modeId:'zombies'}));
  assert.equal((await response).type,'error'); socket.close();
  const denied=await f.browser.newContext({viewport:{width:1200,height:700},hasTouch:true});
  await denied.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new Error('denied');}}));
  const deniedPage=await denied.newPage(); await deniedPage.goto(f.base);
  await deniedPage.locator('[data-mode-id="zombies"]').tap(); await deniedPage.locator('#home-solo').tap();
  await deniedPage.waitForSelector('body[data-mode="playing"]'); assert.equal(await deniedPage.locator('#fatal-screen').isHidden(),true);
  await denied.close(); f.clean(); console.log(`PASS Zombies browser ${legacy?'legacy':'modern'}: all maps, real loot/play/recovery/death/replay, storage denial, online fallback`);
} catch(error) { await page.screenshot({path:`${artifacts}/failure-${legacy?'legacy':'modern'}.png`}); throw error; }
finally { await f.close(); }

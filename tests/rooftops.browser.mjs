import assert from 'node:assert/strict';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { MAPS } from '../src/maps.js';
import { SIDES } from '../src/map-traversal.js';
import { fixture,until } from './helpers/loot-browser.js';
import { goHome,persistentFixture,readProfile,setupSolo,fightSolo } from './helpers/progression-browser.js';
import { observeGame,followRoute,hideAt,recordFrames,assertRendered,captureEightZombies,aimAt,defendAgainstVisibleEnemy } from './helpers/traversal-browser.js';

const legacy=process.env.LEGACY_WEBVIEW==='1',dir=process.env.ARTIFACT_DIR||`artifacts/rooftops-hiding-zQylUE/browser-${legacy?'legacy':'modern'}`;
await mkdir(dir,{recursive:true});
const f=await fixture({width:1200,height:700},{legacy}),page=f.pages[0];
const evidence={distDir:process.env.DIST_DIR,browser:f.browser.version(),legacy,maps:[],errors:[]};let observation;
try {
  await page.goto(f.base);
  assert.equal(await page.locator('#hide-button').count(),1,'candidate contains contextual Hide control (absent in frozen0.7 baseline)');
  await page.locator('#home-settings').tap();await page.locator('#bots').fill('1');await page.locator('#difficulty').selectOption('easy');
  await page.locator('#sound').uncheck();await page.locator('#settings-done').tap();
  if(process.env.TRAVERSAL_PERFORMANCE_ONLY!=='1'&&process.env.TRAVERSAL_PERSISTENCE_ONLY!=='1')for(let cycle=0;cycle<2;cycle++) for(const [index,map] of MAPS.entries()) {
    const modeId=cycle===1?'ffa':['ffa','tdm','ctf','zombies'][index%4];
    await page.locator(`[data-map="${map.id}"]`).tap();await page.locator(`[data-mode-id="${modeId}"]`).tap();await page.locator('#home-solo').tap();
    await page.waitForSelector('body[data-mode="playing"]'); observation=await observeGame(page);
    const defend=()=>defendAgainstVisibleEnemy(page,observation,map);
    const annex=index%4===3?1-cycle:cycle,roof=map.traversal.roofs[annex];
    const trace=await followRoute(page,observation.actor,[roof.point],{map,touch:cycle===0,defend});
    const top=await assertRendered(page,observation,`${map.id} roof`);
    assert.equal(top.player.supportId,roof.supportId);assert.equal(top.player.y,roof.point.y);
    assert.ok(trace.some(p=>!p.grounded && p.y>0),'actual jumping, not elevation injection');
    await aimAt(page,observation.actor,Math.atan2(top.player.x,top.player.z),-.25);
    await page.screenshot({path:`${dir}/${map.id}-${cycle}-roof.png`});
    const spot=map.hideSpots[annex],center=map.traversal.shelters[annex].point,out=SIDES[spot.facing];
    await followRoute(page,observation.actor,[{x:center.x+out.x*3,y:0,z:center.z+out.z*3,direct:true}],{map,defend});
    await hideAt(page,observation,map,spot,{defend});
    const hidden=await assertRendered(page,observation,`${map.id} hide`);assert.equal(hidden.weaponVisible,false);
    await page.screenshot({path:`${dir}/${map.id}-${cycle}-hide.png`});
    await page.keyboard.down('KeyH');await page.waitForTimeout(350);await page.keyboard.down('KeyH');await page.waitForTimeout(100);
    assert.equal((await observation.actor()).hiddenSpotId,null,'held H exits only once');await page.keyboard.up('KeyH');
    await page.locator('#hide-button').tap();await until(async()=>!!(await observation.actor()).hiddenSpotId,'touch re-entry');
    const frames=await recordFrames(page,1);
    const resources=await page.evaluate(()=>window.__lootObservation);
    evidence.maps.push({mapId:map.id,modeId,cycle,roof:top.player,hidden:hidden.player,drawCalls:hidden.drawCalls,resources,frames});
    await observation.close();observation=null;await goHome(page);
    console.log(`PASS ${map.id} ${modeId} cycle${cycle}: real climb, supported roof, room/hide, held H`);
  }
  if(evidence.maps.length)for(const map of MAPS){const pair=evidence.maps.filter(e=>e.mapId===map.id);for(const kind of ['Buffer','Texture','Program'])
    assert.ok((pair[1].resources.live[kind]||0)<=(pair[0].resources.live[kind]||0)+12,`${map.id}: bounded repeated-cycle ${kind}`);}
  if(process.env.TRAVERSAL_PERFORMANCE_ONLY==='1') {
    await page.locator('#home-settings').tap();await page.locator('#bots').fill('8');await page.locator('#settings-done').tap();
    evidence.botAttempts=[];
    for(let attempt=0;attempt<5&&!evidence.bots;attempt++) {
      await page.locator('[data-map="courtyard"]').tap();await page.locator('[data-mode-id="ffa"]').tap();await page.locator('#home-solo').tap();
      await page.waitForSelector('body[data-mode="playing"]');await page.waitForTimeout(250);await page.screenshot({path:`${dir}/eight-bots-before-${attempt}.png`});observation=await observeGame(page);
      const before=await observation.read(),frames=await recordFrames(page,4),after=await observation.read(),sample={before,after,frames};
      evidence.botAttempts.push(sample);
      if(before.actors.filter(a=>a.alive).length===9&&after.actors.filter(a=>a.alive).length===9)evidence.bots=sample;
      await observation.close();observation=null;await goHome(page);
    }
    assert.ok(evidence.bots,'matched eight-live-bot sample; retain natural casualty attempts separately');
    evidence.zombieAttempts=[];
    for(let attempt=0;attempt<3&&!evidence.zombies;attempt++) {
      await page.locator('[data-mode-id="zombies"]').tap();await page.locator('#home-solo').tap();await page.waitForSelector('body[data-mode="playing"]');
      observation=await observeGame(page);const sample=await captureEightZombies(page,observation,MAPS[0]);evidence.zombieAttempts.push(sample);
      console.log('ZOMBIE TIMING POPULATION',JSON.stringify({before:sample.before.player,after:sample.after.player,valid:sample.valid}));
      if(sample.valid)evidence.zombies=sample;
      await page.screenshot({path:`${dir}/eight-zombies-${attempt}.png`});await observation.close();observation=null;await goHome(page);
    }
    assert.ok(evidence.zombies,'four-second sample retains eight live zombies including runner, and a living player');
    const baseline=JSON.parse(await readFile('artifacts/rooftops-hiding-zQylUE/baseline-capture/courtyard-eight-zombies-attempt-1-raw-raf.json','utf8'));
    evidence.baseline={path:'baseline-capture/courtyard-eight-zombies-attempt-1-raw-raf.json',rows:baseline.rows};
    console.log('TIMING',JSON.stringify({bots:evidence.bots.frames,zombies:evidence.zombies.frames},(key,value)=>key==='rows'?undefined:value));
  }
  f.clean();
} catch(error){evidence.errors.push(error.stack);await page.screenshot({path:`${dir}/failure.png`}).catch(()=>{});throw error;}
finally {await writeFile(`${dir}/evidence.json`,JSON.stringify(evidence,null,2));await observation?.close().catch(()=>{});await f.close();}

if(process.env.TRAVERSAL_PERSISTENCE==='1'||process.env.TRAVERSAL_PERSISTENCE_ONLY==='1') {
  const profile=await persistentFixture({legacy,artifactDir:`${dir}/save`});
  try {
    let p=profile.page;await setupSolo(p);await p.locator('[data-skin="shadow-ninja"]').tap();
    await p.locator('#home-online').tap();await p.locator('.server-settings summary').tap();await p.locator('#server-address').fill(profile.origin);
    await p.locator('#create-room').tap();await p.locator('#room-lobby:not([hidden])').waitFor();await p.locator('#leave-room').tap();
    await p.locator('#confirm-home').tap();
    await p.waitForSelector('body[data-mode="home"]');await p.locator('#home-solo').tap();await fightSolo(p,1,{artifactDir:dir,label:'traversal-save'});
    await goHome(p);const saved=await readProfile(p),storage=await p.evaluate(()=>Object.fromEntries(Object.entries(localStorage)));
    assert.ok(saved.lifetimeXP>0,'save test earned genuine XP');p=await profile.reopen();
    assert.deepEqual(await readProfile(p),saved,'XP/cosmetics survive full browser restart at same origin');
    assert.deepEqual(await p.evaluate(()=>Object.fromEntries(Object.entries(localStorage))),storage,'settings and cosmetics retained');profile.clean();
  }finally{await profile.close();}
}

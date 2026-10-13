import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { persistentFixture, readProfile, goHome } from './helpers/progression-browser.js';
import { equip, until } from './helpers/loot-browser.js';
import { touchControls, aimAt } from './helpers/traversal-browser.js';
import { openPowers, choosePowers } from './helpers/solo-powers-browser.js';
import { observeRange, enterRange, fireRangeKill, assertLegacy } from './helpers/range-browser.js';
import { WEAPONS } from '../src/weapons.js';

// Catches incorrect precision totals, paused respawn clocks, temporary loadouts
// persisting, lost legitimate rewards, infinite magazines without the power,
// held input leaking through menus, failed saves overwriting bytes, and startup
// rollback that strands Home. Only storage/canvas failure seams are injected.
const artifacts=resolve(process.env.ARTIFACT_DIR||'artifacts/shooting-range-browser');
const legacy=process.env.LEGACY_WEBVIEW==='1',pin='0427';
await mkdir(artifacts,{recursive:true});
const f=await persistentFixture({legacy,viewport:{width:1024,height:600},artifactDir:artifacts,fullChromium:true});
const evidence={kills:[],respawn:[],guns:[],movement:[]};let observation,focusCdp;
const off={invincible:false,unlimitedAmmo:false,superSpeed:false,speedMultiplier:2};
async function checkOff(page){await openPowers(page,{pin});for(const id of ['invincible','ammo','speed'])assert.equal(await page.locator(`#solo-powers-${id}`).isChecked(),false);await page.locator('#solo-powers-cancel').click();}
async function watchLifecycle(page){await page.evaluate(()=>{window.__rangeLifecycle=[];for(const event of ['blur','focus'])window.addEventListener(event,()=>window.__rangeLifecycle.push({event,focused:document.hasFocus(),hidden:document.hidden,mode:document.body.dataset.mode}));});}
try {
  let page=f.page;
  await watchLifecycle(page);
  focusCdp=await page.context().newCDPSession(page);await focusCdp.send('Emulation.setFocusEmulationEnabled',{enabled:false});await page.bringToFront();
  await page.locator('#home-settings').click();await page.locator('#sound').uncheck();await page.locator('#bots').fill('1');await page.locator('#settings-done').click();
  await page.locator('[data-map="harbor"]').click();await page.locator('[data-mode-id="tdm"]').click();
  await page.locator('#home-armory').click();await page.locator('[data-class="assault"]').click();await page.locator('[data-weapon="m4a1"]').click();await page.locator('#armory-home').click();
  await openPowers(page,{pin,firstSetup:true});await choosePowers(page,off);
  const savedPin=await page.evaluate(()=>localStorage.getItem('block-ops-solo-powers-pin-v1'));
  await enterRange(page);observation=await observeRange(page);
  assert.equal((await observation.read()).targets.length,6);assert.equal((await observation.read()).stats.targetKills,0);
  assert.equal(await page.locator('#reserve-count').textContent(),'∞');
  await page.screenshot({path:`${artifacts}/range-initial.png`});console.log(`SCREENSHOT ${artifacts}/range-initial.png`);
  await equip(page,'sniper','awp');
  for(const [id,region,total] of [['close-dummy','body',10],['medium-dummy','head',30],['close-bullseye','centre',50]]){
    evidence.kills.push(await fireRangeKill(page,id,region,observation));assert.equal((await readProfile(page)).lifetimeXP,total);
  }
  console.log('PASS actual normal/head/centre kills: 10 + 20 + 20 = 50 XP');
  const killed=(await observation.read()).targets.find(t=>t.id==='close-bullseye');
  await page.locator('#loadout-button').click();const paused=await observation.read();await page.waitForTimeout(5500);
  assert.deepEqual((await observation.read()).targets,paused.targets,'Loadout freezes target clock');
  await page.locator('#play-button').click();await page.locator('#pause-button').click();
  for(const transition of ['native','blur','visibility']){
    await page.locator('#resume-button').click();
    if(transition==='native')await page.evaluate(()=>window.pauseGame());
    else if(transition==='visibility'){
      const background=await page.context().newPage();await background.goto('about:blank');await background.bringToFront();
      await page.waitForTimeout(200);await background.close();await page.bringToFront();
      // Real blur may already have paused. Resume first so this isolated
      // property/event seam must itself stop the active session.
      if(await page.locator('body').getAttribute('data-mode')==='paused')await page.locator('#resume-button').click();
      assert.equal(await page.locator('body').getAttribute('data-mode'),'playing');
      // Chromium retains visibility here. A synthetic visibilitychange with
      // a browser-property seam covers only the handler, not true backgrounding.
      await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
    }else{
      await focusCdp.send('Emulation.setFocusEmulationEnabled',{enabled:false});const background=await page.context().newPage();await background.goto('about:blank');await background.bringToFront();console.log('FOCUS OBSERVED',await page.evaluate(()=>({focused:document.hasFocus(),mode:document.body.dataset.mode,events:window.__rangeLifecycle})));await page.waitForSelector('body[data-mode="paused"]');assert.equal(await page.evaluate(()=>document.hasFocus()),false,'actual second tab blurs original');await background.close();await page.bringToFront();assert.equal(await page.evaluate(()=>document.hasFocus()),true,'actual foreground restores focus');await page.screenshot({path:`${artifacts}/real-focus-paused.png`});
    }
    await page.waitForSelector('body[data-mode="paused"]');const before=await observation.read();await page.waitForTimeout(550);
    assert.equal((await observation.read()).time,before.time,`${transition} stops active simulation`);
    evidence.respawn.push({transition,before,after:await observation.read(),events:await page.evaluate(()=>window.__rangeLifecycle)});
    if(transition==='visibility')await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
    assert.equal(await page.locator('body').getAttribute('data-mode'),'paused','foreground focus never automatically resumes practice');
  }
  await page.locator('#resume-button').click();
  await until(async()=>(await observation.read()).targets.find(t=>t.id==='close-bullseye').lifeId>killed.lifeId,'target respawns after five active seconds',30000);
  const respawned=await observation.read();assert.equal(respawned.targets.find(t=>t.id==='close-bullseye').health,100);
  const killedAt=evidence.kills[2].after.time,activeUntilRespawn=respawned.time-killedAt;
  assert.ok(activeUntilRespawn>=4.85&&activeUntilRespawn<=5.4,`five active seconds, observed ${activeUntilRespawn}`);evidence.respawn.push({killedAt,respawnedAt:respawned.time,activeUntilRespawn});
  for(const [id,region] of [['close-dummy','head'],['medium-dummy','head'],['far-dummy','head'],['medium-bullseye','centre'],['far-bullseye','centre']])evidence.kills.push(await fireRangeKill(page,id,region,observation));
  assert.equal((await readProfile(page)).lifetimeXP,150);
  await page.locator('#loadout-button').click();await page.locator('#armory-skin').selectOption('crimson-ninja');await page.locator('#play-button').click();
  for(const gun of WEAPONS){await equip(page,gun.classId,gun.id);const state=await observation.read();assert.equal(state.weaponId,gun.id);assert.ok(Number.isFinite(state.ammo)&&state.ammo>=0&&state.ammo<=gun.magazine);for(const item of state.equipment){assert.ok([item.ammo,item.reserve,item.cooldown,item.reload].every(Number.isFinite),'all internal ammo/timers remain finite');assert.ok(item.ammo>=0&&item.reserve>=0&&item.cooldown>=0&&item.reload>=0);}evidence.guns.push({id:gun.id,ammo:state.ammo});}
  assert.equal(evidence.guns.length,29);await equip(page,'assault','m4a1');
  await equip(page,'lmg','minigun');const touch=await touchControls(page),before=await observation.read();
  try{await touch.send('touchStart',[await touch.point('#fire-button',71)]);await until(async()=>(await observation.read()).time-before.time>=.8,'sustained real Minigun touch',15000);}finally{await touch.send('touchEnd');await touch.close();}
  const released=await observation.read();assert.ok(before.ammo-released.ammo>=15);await page.waitForTimeout(500);assert.equal((await observation.read()).ammo,released.ammo);
  await page.locator('#reload-button').tap();await until(async()=>(await observation.read()).reload>0,'ordinary reload begins');
  await page.keyboard.down('KeyF');
  try{await equip(page,'assault','m4a1');assert.equal((await observation.read()).input.fire,false,'reload switch back to starter clears still-held fire');}
  finally{await page.keyboard.up('KeyF');}
  await page.keyboard.down('KeyF');
  try{await page.locator('#loadout-button').click();await page.locator('#play-button').click();assert.equal((await observation.read()).input.fire,false,'Loadout clears fire before the held key is released');}
  finally{await page.keyboard.up('KeyF');}
  await equip(page,'lmg','minigun');await page.locator('#reload-button').tap();await until(async()=>(await observation.read()).ammo===200,'real finite magazine reload',30000);
  await page.locator('#pause-button').click();await openPowers(page,{origin:'paused',pin});await choosePowers(page,{...off,unlimitedAmmo:true,superSpeed:true,speedMultiplier:5});await page.locator('#resume-button').click();
  assert.equal(await page.locator('#ammo-count').textContent(),'∞');assert.equal(await page.locator('#reload-button').isDisabled(),true);
  const powered=await observation.read();await page.keyboard.press('KeyF',{delay:1200});assert.equal((await observation.read()).ammo,powered.ammo,'no-reload power preserves finite internal magazine');
  await aimAt(page,async()=>(await observation.read()).player,Math.PI/2,0);
  const start=await observation.read();await page.keyboard.down('KeyW');try{await until(async()=>(await observation.read()).time-start.time>=2,'5x movement reaches authored wall',30000);}finally{await page.keyboard.up('KeyW');}
  const wall=await observation.read();evidence.movement.push({start,wall});assert.ok(wall.player.x<=-29&&wall.player.x>=-29.67,'5x movement collides with wall');assert.ok(Math.abs(wall.player.z-start.player.z)<1);
  assert.ok(wall.stats.accuracy>=0&&wall.stats.accuracy<=100);
  const earned=(await readProfile(page)).lifetimeXP;await goHome(page);assert.equal((await readProfile(page)).lifetimeXP,earned,'no exit bonus');
  await page.locator('#home-armory').click();assert.equal(await page.locator('[data-weapon="m4a1"]').getAttribute('aria-pressed'),'true');await page.locator('#armory-home').click();
  assert.equal(await page.locator('[data-map="harbor"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('[data-mode-id="tdm"]').getAttribute('aria-pressed'),'true');
  await observation.close();observation=null;await page.reload();await page.waitForSelector('body[data-mode="home"]');assert.equal((await readProfile(page)).lifetimeXP,earned);assert.equal((await readProfile(page)).skinId,'crimson-ninja');assert.equal(await page.evaluate(()=>localStorage.getItem('block-ops-solo-powers-pin-v1')),savedPin);await checkOff(page);
  await focusCdp.detach();focusCdp=null;page=await f.reopen();await watchLifecycle(page);focusCdp=await page.context().newCDPSession(page);await focusCdp.send('Emulation.setFocusEmulationEnabled',{enabled:false});await page.bringToFront();assert.equal((await readProfile(page)).lifetimeXP,earned);assert.equal((await readProfile(page)).skinId,'crimson-ninja');assert.equal(await page.evaluate(()=>localStorage.getItem('block-ops-solo-powers-pin-v1')),savedPin);await checkOff(page);
  await enterRange(page);observation=await observeRange(page);assert.equal((await observation.read()).stats.targetKills,0);assert.ok((await observation.read()).targets.every(t=>t.health===100));await equip(page,'sniper','awp');
  const bytes=await page.evaluate(()=>[localStorage.getItem('block-ops-progression-v1'),localStorage.getItem('block-ops-progression-v1-backup')]);
  await page.evaluate(()=>{const original=Storage.prototype.setItem;window.__restoreRangeStorage=()=>{Storage.prototype.setItem=original;};Storage.prototype.setItem=function(key,value){if(key.startsWith('block-ops-progression-v1'))throw new DOMException('Fixture blocked storage','QuotaExceededError');return original.call(this,key,value);};});
  await fireRangeKill(page,'close-dummy','head',observation);assert.equal(await page.locator('#progression-live-save-status').isVisible(),true);assert.match(await page.locator('#progression-live-save-status').textContent(),/unsaved|not saved|temporary|cannot|could not/i);
  assert.deepEqual(await page.evaluate(()=>[localStorage.getItem('block-ops-progression-v1'),localStorage.getItem('block-ops-progression-v1-backup')]),bytes,'storage failure leaves saved bytes intact');
  await page.screenshot({path:`${artifacts}/unsaved-progress.png`});await page.evaluate(()=>window.__restoreRangeStorage());const retryTab=await page.context().newPage();await retryTab.goto('about:blank');await retryTab.bringToFront();await retryTab.close();await page.bringToFront();await until(async()=>await page.locator('#progression-save-status').getAttribute('data-save-status')==='saved','actual focus retries available storage');assert.equal((await readProfile(page)).lifetimeXP,earned+20);await page.locator('#resume-button').click();assert.equal(await page.locator('#progression-live-save-status').isVisible(),false);await goHome(page);await observation.close();observation=null;
  await assertLegacy(page,legacy);f.clean();
  console.log('PASS XP150 unlock/reopen/PIN/reset; 29 guns; touch/reload/powers/wall; pause/respawn/storage/save rules');
}catch(error){await f.page.screenshot({path:`${artifacts}/failure.png`}).catch(()=>{});throw error;}
finally{await observation?.close();await focusCdp?.detach();await writeFile(`${artifacts}/evidence.json`,JSON.stringify(evidence,null,2));await f.close();}

// Isolated allocation failure after world attachment, followed by real Home,
// practice retry and normal Solo startup in the same page.
const failure=await persistentFixture({legacy,artifactDir:`${artifacts}/allocation-fixture`});
try{
  const page=failure.page;await openPowers(page,{pin,firstSetup:true});await choosePowers(page,{...off,invincible:true,unlimitedAmmo:true,superSpeed:true,speedMultiplier:5});await page.evaluate(()=>{const native=HTMLCanvasElement.prototype.getContext;let armed=true;HTMLCanvasElement.prototype.getContext=function(type,...args){if(armed&&type==='2d'&&this.width===512&&this.height===96){armed=false;throw new Error('Fixture range label allocation failure');}return native.call(this,type,...args);};});
  await page.locator('#home-range').tap();await page.waitForTimeout(600);assert.equal(await page.locator('body').getAttribute('data-mode'),'home');assert.equal(await page.locator('#fatal-screen').isVisible(),false);
  await checkOff(page);await page.screenshot({path:`${artifacts}/allocation-recovered-home.png`});await enterRange(page);assert.notEqual(await page.locator('#ammo-count').textContent(),'∞');await goHome(page);await page.locator('#home-solo').tap();await page.waitForSelector('body[data-mode="playing"]');assert.equal(await page.locator('#range-stats').isVisible(),false);await goHome(page);failure.clean();console.log('PASS one-shot range allocation failure recovers Home and normal play');
}finally{await failure.close();}

const future=await persistentFixture({legacy,artifactDir:`${artifacts}/future-save-fixture`});
try{
  const page=future.page;
  // An isolated newer-version storage record has no XP. This is a storage
  // compatibility fixture, never a grant of progression or target state.
  const newer='{"schemaVersion":2,"lifetimeXP":0,"skinId":"ranger","finishId":"standard","receipts":[]}';
  await page.evaluate(bytes=>localStorage.setItem('block-ops-progression-v1',bytes),newer);await page.reload();await page.waitForSelector('body[data-mode="home"]');
  assert.match(await page.locator('#progression-save-status').textContent(),/temporary.*newer save/i);
  await enterRange(page);const view=await observeRange(page);
  try{await equip(page,'sniper','awp');await fireRangeKill(page,'close-dummy','head',view);assert.equal(await page.locator('#progression-live-save-status').isVisible(),true);assert.match(await page.locator('#progression-live-save-status').textContent(),/temporary.*newer save/i);await page.screenshot({path:`${artifacts}/newer-save-preserved.png`});await goHome(page);assert.equal(await page.evaluate(()=>localStorage.getItem('block-ops-progression-v1')),newer,'real kill and exit preserve newer save bytes');}
  finally{await view.close();}
  future.clean();console.log('PASS real kill/exit preserves isolated newer save bytes with visible temporary status');
}finally{await future.close();}

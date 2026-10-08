import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {MAPS} from '../../src/maps.js';
import {SIDES} from '../../src/map-traversal.js';
import {LOOT_SPAWNS} from '../../src/loot-spawns.js';
import {createSpatialWorld,segmentClear} from '../../src/spatial.js';
import {nativeProgressionFixture} from './helpers/progression-native.js';
import {setupSolo,fightSolo,goHome,readProfile} from '../../tests/helpers/progression-browser.js';
import {observeGame,followRoute,hideAt,assertRendered,defendAgainstVisibleEnemy,aimAt} from '../../tests/helpers/traversal-browser.js';
import {until} from '../../tests/helpers/loot-browser.js';

const dir=process.env.ANDROID_TEST_ARTIFACTS;assert.ok(dir,'Explicit owned evidence directory');await mkdir(dir,{recursive:true});
const apk=process.env.ANDROID_APK_PATH;assert.ok(apk,'Explicit candidate APK');
const f=await nativeProgressionFixture({artifactDir:dir});
const evidence={apk,maps:[],errors:[]};let page,observation;
const storage=()=>page.evaluate(()=>Object.fromEntries(Object.entries(localStorage)));
try {
  page=await f.attach();evidence.beforeVersion=await f.version();
  if(process.env.ANDROID_BASELINE_ASSERT==='1') {
    assert.equal(await page.evaluate(()=>!!document.querySelector('#hide-button')),true,'old package lacks contextual Hide feature');
  }
  if(process.env.ANDROID_RESUME_CODE10!=='1') {
    assert.equal(evidence.beforeVersion.code,9,'retained same-signed0.7 baseline');
    await setupSolo(page);await page.locator('[data-skin="shadow-ninja"]').click();
    const initial=(await readProfile(page)).lifetimeXP;
    await page.locator('#home-solo').click();await fightSolo(page,1,{artifactDir:dir,label:'old-version-real-xp'});await goHome(page);
    assert.equal((await readProfile(page)).lifetimeXP,initial+10,'real XP earned before upgrade');
    evidence.beforeUpgrade=await storage();await writeFile(`${dir}/before-upgrade.json`,JSON.stringify(evidence.beforeUpgrade,null,2));
    await f.install(apk);page=await f.attach();assert.deepEqual(await storage(),evidence.beforeUpgrade,'9→10 retains all saved data');
  }
  assert.deepEqual(await f.version(),{code:10,name:'0.8.0'});
  await page.locator('#home-settings').click();await page.locator('#bots').fill('1');await page.locator('#difficulty').selectOption('easy');await page.locator('#sound').uncheck();await page.locator('#settings-done').click();
  for(const map of process.env.ANDROID_ZOMBIES_ONLY==='1'?[]:MAPS) {
    await page.locator(`[data-map="${map.id}"]`).click();await page.locator('[data-mode-id="ffa"]').click();await page.locator('#home-solo').click();
    await page.waitForSelector('body[data-mode="playing"]');observation=await observeGame(page);
    const annex=map.traversal.roofs.map((roof,index)=>({index,distance:Math.hypot(roof.point.x-map.playerSpawn.x,roof.point.z-map.playerSpawn.z)})).sort((a,b)=>a.distance-b.distance)[0].index;
    const roof=map.traversal.roofs[annex],spot=map.hideSpots[annex],defend=()=>defendAgainstVisibleEnemy(page,observation,map);
    const trace=await followRoute(page,observation.actor,[roof.point],{map,defend,timeout:90000});
    const top=await assertRendered(page,observation,`${map.id} native roof`);assert.equal(top.player.supportId,roof.supportId);assert.ok(trace.some(p=>!p.grounded&&p.y>0));
    await page.screenshot({path:`${dir}/${map.id}-roof.png`});
    const center=map.traversal.shelters[annex].point,out=SIDES[spot.facing];
    await followRoute(page,observation.actor,[{x:center.x+out.x*3,y:0,z:center.z+out.z*3,direct:true}],{map,defend,timeout:90000});
    await hideAt(page,observation,map,spot,{defend,timeout:90000});
    const hidden=await assertRendered(page,observation,`${map.id} native hide`);assert.equal(hidden.weaponVisible,false);
    await page.screenshot({path:`${dir}/${map.id}-hide.png`});
    await page.locator('#fire-button').click();await until(async()=>!(await observation.actor()).hiddenSpotId,'native Fire exits hide');
    evidence.maps.push({id:map.id,roof:top.player,hidden:hidden.player,drawCalls:hidden.drawCalls});
    await observation.close();observation=null;await goHome(page);console.log(`PASS native ${map.id}: real climb/Hide/Fire exit, rendered roof and room`);
  }
  const map=MAPS[0],spot=map.hideSpots[1];
  await page.locator('[data-map="courtyard"]').click();await page.locator('[data-mode-id="zombies"]').click();await page.locator('#home-solo').click();
  observation=await observeGame(page);
  // Earn four real eliminations before the contact/Hide/pursuit scenario.
  // One remaining walker proves pursuit without a surrounding five-enemy
  // crowd overwhelming a slow ADB-driven route controller.
  const combatDeadline=Date.now()+120000;
  while(true) {
    const s=await observation.read();assert.ok(s.player.health>0,'real native Zombie combat survives');
    if(s.queued===0&&s.activeIds===1)break;
    assert.ok(Date.now()<combatDeadline,'real native shots leave one walker');
    await defendAgainstVisibleEnemy(page,observation,map);await page.waitForTimeout(100);
  }
  evidence.afterRealCombat=await observation.read();
  const pack=LOOT_SPAWNS.courtyard.find(p=>p.supplyType==='health');
  const armour=LOOT_SPAWNS.courtyard.find(p=>p.supplyType==='armour');
  const shelter=map.traversal.shelters[1].point,out=SIDES[spot.facing],doorway={x:shelter.x+out.x*3,y:0,z:shelter.z+out.z*3};
  await followRoute(page,observation.actor,[{...armour,y:0},{...pack,y:0},doorway],{map,timeout:90000});
  await page.locator('[data-inventory-key="supply:health"]').waitFor();
  await until(async()=>{const s=await observation.read();return s.player.health<100&&s.bots.some(b=>b.targetId==='local');},'witnessed live zombie approach/damage',60000);
  await followRoute(page,observation.actor,[spot.entry],{map,timeout:15000});
  const world=createSpatialWorld(map);
  await until(async()=>{const s=await observation.read();return s.actors.some(a=>a.kind&&a.alive&&segmentClear({...a,y:a.y+1.35},{...s.player,y:s.player.y+1.35},world));},'zombie directly sees player immediately before Hide',15000);
  await page.locator('#hide-button').click();await until(async()=>!!(await observation.actor()).hiddenSpotId,'native zombie hide');
  await until(async()=>(await observation.read()).bots.every(b=>b.targetId!=='local'),'witnessed hiding erases zombie tracking');
  const hurt=(await observation.actor()).health;assert.ok(hurt>0&&hurt<100);
  await page.locator('[data-inventory-key="supply:health"]').click();
  await until(async()=>(await observation.actor()).health===100,'health pack completes inside hide',15000);
  assert.equal((await observation.actor()).hiddenSpotId,spot.id);await page.screenshot({path:`${dir}/hidden-health-pack.png`});
  await page.locator('[data-inventory-key="supply:armour"]').click();await until(async()=>(await observation.actor()).armour>0,'actually collected armour completes while hidden',15000);
  evidence.beforePursuit=await observation.read();
  await aimAt(page,observation.actor,(await observation.actor()).yaw,-1.2);
  await page.locator('#fire-button').click();await until(async()=>!(await observation.actor()).hiddenSpotId,'raw Fire exposes healed player');
  await aimAt(page,observation.actor,(await observation.actor()).yaw,0);
  await followRoute(page,observation.actor,[map.traversal.roofs[1].point],{map,timeout:90000});
  await until(async()=>(await observation.read()).actors.some(a=>a.alive&&a.kind&&a.y===2.2),'zombie physically follows visible rooftop route',90000);
  evidence.zombiePursuit=await assertRendered(page,observation,'native rooftop pursuit');await page.screenshot({path:`${dir}/zombie-rooftop-pursuit.png`});
  await followRoute(page,observation.actor,[{...doorway,direct:true}],{map,timeout:90000});await hideAt(page,observation,map,spot,{timeout:90000});
  evidence.beforeLifecycle=await storage();await f.background();await f.foreground();await page.waitForSelector('body[data-mode="paused"]');
  assert.deepEqual(await storage(),evidence.beforeLifecycle,'background grants no XP and retains saves');
  await observation.close();observation=null;page=await f.relaunch();assert.deepEqual(await storage(),evidence.beforeLifecycle,'force-stop retains complete saves');
  await page.locator('#home-solo').click();observation=await observeGame(page);assert.equal((await observation.actor()).hiddenSpotId,null,'new match has no stale hide');await observation.close();observation=null;await goHome(page);
  const replacement=await storage();await f.install(apk);page=await f.attach();assert.deepEqual(await storage(),replacement,'10→10 signed replacement retains data');
  evidence.afterVersion=await f.version();evidence.afterStorage=await storage();f.clean();console.log(`PASS native Zombie forget/pursuit, hidden healing and lifecycle saves; ${evidence.maps.length} map cases in this run; upgrade=${process.env.ANDROID_RESUME_CODE10!=='1'}`);
}catch(error){evidence.errors.push(error.stack);evidence.failureState=await observation?.read().catch(()=>null);await page?.screenshot({path:`${dir}/failure.png`}).catch(()=>{});throw error;}
finally{await observation?.close().catch(()=>{});await writeFile(`${dir}/evidence.json`,JSON.stringify(evidence,null,2));await f.close();}

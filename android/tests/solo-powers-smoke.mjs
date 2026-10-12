import assert from 'node:assert/strict';
import {mkdir,writeFile,readdir,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {nativeProgressionFixture} from './helpers/progression-native.js';
import {setupSolo,fightSolo,goHome,readProfile} from '../../tests/helpers/progression-browser.js';
import {openPowers,choosePowers} from '../../tests/helpers/solo-powers-browser.js';
import {observeGame,followRoute,defendAgainstVisibleEnemy} from '../../tests/helpers/traversal-browser.js';
import {walkSolo} from '../../tests/helpers/loot-browser.js';
import {MAPS} from '../../src/maps.js';
import {createNavigation} from '../../src/navigation.js';

for(const key of ['ANDROID_TEST_ARTIFACTS','ANDROID_APK_PATH','ANDROID_BASELINE_APK_PATH','ANDROID_TEST_SERIAL','ANDROID_TEST_AVD'])assert.ok(process.env[key],`Explicit ${key} required`);
const artifactDir=resolve(process.env.ANDROID_TEST_ARTIFACTS),apk=resolve(process.env.ANDROID_APK_PATH),baseline=resolve(process.env.ANDROID_BASELINE_APK_PATH);
await mkdir(artifactDir,{recursive:true});
const run=promisify(execFile),sdk=process.env.ANDROID_SDK_ROOT||process.env.ANDROID_HOME||`${process.env.HOME}/Android/Sdk`;
let aapt;for(const version of (await readdir(join(sdk,'build-tools'))).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}))) {
  const path=join(sdk,'build-tools',version,'aapt');try{await access(path);aapt=path;break;}catch{}
}
assert.ok(aapt,'SDK metadata reader is available');
const badging=(await run(aapt,['dump','badging',baseline])).stdout;
assert.match(badging,/package: name='au\.local\.blockops'.*versionCode='11'.*versionName='0\.9\.0'/,'inspect retained baseline identity before any device mutation');
const f=await nativeProgressionFixture({artifactDir}); // validates exact owned AVD before install
const off={invincible:false,unlimitedAmmo:false,superSpeed:false,speedMultiplier:2},assist={...off,invincible:true,unlimitedAmmo:true};
const saveKeys=['block-ops-v1','block-ops-progression-v1','block-ops-progression-v1-backup','block-ops-zombies-v1','block-ops-solo-powers-pin-v1'];
const saves=page=>page.evaluate(keys=>Object.fromEntries(keys.map(key=>[key,localStorage.getItem(key)])),saveKeys);
const evidence={};let observation,page;
async function offControls() {
  for(const name of ['invincible','ammo','speed'])assert.equal(await page.locator(`#solo-powers-${name}`).evaluate(el=>el.checked),false);
  assert.equal(await page.locator('#solo-powers-speed-multiplier').evaluate(el=>el.value),'2');
}
async function closeObservation(){await observation?.close();observation=null;}
try {
  await f.install(baseline);page=await f.attach();assert.deepEqual(await f.version(),{code:11,name:'0.9.0'});
  await setupSolo(page);await page.locator('[data-skin="shadow-ninja"]').click();
  await page.locator('#home-settings').click();await page.locator('#control-size').fill('1.3');await page.locator('#settings-done').click();
  const baselineXP=(await readProfile(page)).lifetimeXP;
  await page.locator('#home-solo').click();await fightSolo(page,1,{artifactDir,label:'baseline-kill'});await goHome(page);
  assert.equal((await readProfile(page)).lifetimeXP,baselineXP+10,'baseline earns a real saved kill before upgrade');
  const beforeUpgradeSave=await saves(page);evidence.beforeUpgrade=beforeUpgradeSave;
  await writeFile(`${artifactDir}/before-upgrade.json`,JSON.stringify({version:await f.version(),save:beforeUpgradeSave},null,2));
  await f.install(apk);page=await f.attach();assert.deepEqual(await f.version(),{code:12,name:'0.9.1'});
  assert.deepEqual(await saves(page),beforeUpgradeSave,'signed code11→12 upgrade preserves every relevant saved byte before new actions');
  console.log('PASS native code11→12 signed upgrade retains genuine XP, skin selection, settings and records');
  assert.equal(await page.evaluate(()=>location.href),'https://appassets.androidplatform.net/assets/index.html');
  evidence.identity=await f.identity();assert.equal(evidence.identity.wifi,'0');assert.equal(evidence.identity.mobileData,'0');
  await openPowers(page,{pin:'0427',firstSetup:true});await offControls();
  await choosePowers(page,{...assist,superSpeed:true,speedMultiplier:5});
  const pinRecord=await page.evaluate(()=>localStorage.getItem('block-ops-solo-powers-pin-v1'));
  const parsed=JSON.parse(pinRecord);assert.equal(parsed.iterations,100000);assert.equal(parsed.kdf,'PBKDF2-SHA256');
  const afterGate=await saves(page);delete afterGate['block-ops-solo-powers-pin-v1'];
  const existing={...beforeUpgradeSave};delete existing['block-ops-solo-powers-pin-v1'];assert.deepEqual(afterGate,existing,'first PIN setup changes only its own key');
  await page.locator('#home-solo').click();observation=await observeGame(page);
  // Sample while the key remains held: native command/observer latency before
  // key-down and after key-up is idle time, not a movement-speed measurement.
  let beforeMove,afterMove;
  await page.keyboard.down('KeyW');
  try {
    beforeMove=await observation.read();
    await page.waitForFunction(start=>window.__lootObservation.seconds-start>=.5,await page.evaluate(()=>window.__lootObservation.seconds));
    afterMove=await observation.read();
  }finally{await page.keyboard.up('KeyW');}
  assert.ok(beforeMove.input.keys.includes('KeyW')&&afterMove.input.keys.includes('KeyW'));
  const rate=Math.hypot(afterMove.player.x-beforeMove.player.x,afterMove.player.z-beforeMove.player.z)/(afterMove.simulationTime-beforeMove.simulationTime);
  evidence.speed={beforeMove,afterMove,rate};
  assert.ok(rate>23.5&&rate<28,'native real movement reaches 5x');
  await walkSolo(page,'KeyW',100,26.5);const wall=await observation.actor();assert.ok(wall.z>=-21.661&&wall.z<-21.5,'native 5x respects outer wall');
  assert.equal(await page.locator('#ammo-count').textContent(),'∞');
  await page.keyboard.down('KeyF');await page.waitForTimeout(2200);await page.keyboard.up('KeyF');
  assert.equal(await page.locator('#ammo-count').textContent(),'∞');assert.equal(await page.locator('#health-count').textContent(),'100');
  evidence.speed.wall=wall;
  await page.locator('#pause-button').click();await openPowers(page,{origin:'paused',pin:'0427'});
  await run(join(sdk,'platform-tools','adb'),['-s',process.env.ANDROID_TEST_SERIAL,'shell','input','keyevent','KEYCODE_BACK']);
  await page.waitForFunction(()=>document.getElementById('solo-powers-screen').hidden);
  assert.equal(await page.locator('body').getAttribute('data-mode'),'paused','native Back cancels without resuming');
  await openPowers(page,{origin:'paused',pin:'0427'});await f.background();await f.foreground();
  await page.waitForFunction(()=>!document.hidden&&document.hasFocus());
  assert.equal(await page.locator('#solo-powers-screen').isVisible(),false);assert.equal(await page.locator('body').getAttribute('data-mode'),'paused');
  await page.locator('#resume-button').click();await page.waitForFunction(()=>document.body.dataset.mode==='playing');
  assert.equal(await page.locator('#ammo-count').textContent(),'∞');
  await closeObservation();await goHome(page);
  await openPowers(page,{pin:'0427'});await offControls();await choosePowers(page,assist);
  const earnedBefore=(await readProfile(page)).lifetimeXP;
  await page.locator('#home-solo').click();await fightSolo(page,15,{artifactDir,label:'powered-win'});
  assert.equal((await readProfile(page)).lifetimeXP-earnedBefore,225,'native assisted match uses normal rewards');
  await goHome(page);await page.locator('[data-skin="crimson-ninja"]').click();
  await page.locator('[data-map="neon-city"]').click();await page.locator('[data-mode-id="zombies"]').click();
  await openPowers(page,{pin:'0427'});await choosePowers(page,{...assist,invincible:false});const zombieXP=(await readProfile(page)).lifetimeXP;
  await page.locator('#home-solo').click();observation=await observeGame(page);
  const map=MAPS.find(m=>m.id==='neon-city'),navigation=createNavigation(map,{radius:.34});
  const encounterDeadline=Date.now()+90000;
  while((await observation.actor()).health===100&&Date.now()<encounterDeadline) {
    const state=await observation.read();
    const enemy=state.actors.filter(a=>a.enemy&&a.alive).sort((a,b)=>Math.hypot(a.x-state.player.x,a.z-state.player.z)-Math.hypot(b.x-state.player.x,b.z-state.player.z))[0];
    const next=enemy&&navigation.nextWaypoint(state.player,enemy);
    if(next)await followRoute(page,observation.actor,[next],{map,timeout:20000});else await page.waitForTimeout(150);
  }
  await page.locator('#pause-button').click();const damaged=(await observation.actor()).health;
  assert.ok(damaged>0&&damaged<100,'real native Zombie contact causes damage while invincibility is off');
  await openPowers(page,{origin:'paused',pin:'0427'});await choosePowers(page,assist);
  assert.equal((await observation.actor()).health,damaged,'enabling invincibility does not heal');
  await page.locator('#resume-button').click();
  const protectedStart=await page.evaluate(()=>window.__lootObservation.seconds);
  await page.waitForFunction(start=>window.__lootObservation.seconds-start>=2.5,protectedStart,{timeout:15000});
  assert.equal((await observation.actor()).health,damaged,'ongoing close-range Zombie attacks cannot damage the powered player');
  evidence.invincibility={damaged,afterContact:(await observation.actor()).health};
  const deadline=Date.now()+240000;
  while(Date.now()<deadline) {
    const state=await observation.read();if(state.phase==='recovery')break;
    assert.equal(state.player.health,damaged,'invincibility preserves existing health through native Zombie combat');
    const inputs=await defendAgainstVisibleEnemy(page,observation,map);
    if(!inputs.length) {
      const enemy=state.actors.filter(a=>a.enemy&&a.alive).sort((a,b)=>Math.hypot(a.x-state.player.x,a.z-state.player.z)-Math.hypot(b.x-state.player.x,b.z-state.player.z))[0];
      const next=enemy&&navigation.nextWaypoint(state.player,enemy);
      if(next)await followRoute(page,observation.actor,[next],{map,timeout:20000});else await page.waitForTimeout(150);
    }
  }
  const wave=await observation.read();assert.equal(wave.phase,'recovery');assert.equal(wave.wave,1);
  assert.equal((await readProfile(page)).lifetimeXP-zombieXP,35);await closeObservation();await goHome(page);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('block-ops-zombies-v1'))['neon-city']),{waves:1,kills:5});
  const earnedSave=await saves(page);evidence.earned=earnedSave;evidence.wave=wave;
  page=await f.relaunch();assert.deepEqual(await saves(page),earnedSave,'force-stop/relaunch preserves exact PIN, XP/cosmetics/settings/records');
  await openPowers(page,{pin:'0427'});await offControls();await page.locator('#solo-powers-cancel').click();
  await f.install(apk);page=await f.attach();assert.deepEqual(await f.version(),{code:12,name:'0.9.1'});
  assert.deepEqual(await saves(page),earnedSave,'same-version signed replacement retains every saved byte');
  await openPowers(page,{pin:'0427'});await offControls();await page.locator('#solo-powers-cancel').click();
  assert.equal(await page.evaluate(()=>localStorage.getItem('block-ops-solo-powers-pin-v1')),pinRecord);
  await page.screenshot({path:`${artifactDir}/retained-after-replacement.png`});
  await writeFile(`${artifactDir}/native-powers-evidence.json`,JSON.stringify(evidence,null,2));f.clean();
  console.log('PASS offline native PIN/PBKDF2, all3 powers, native Back/background, genuine225+35 XP, Zombie best, restart and signed replacement retention');
} catch(error){if(page)await page.screenshot({path:`${artifactDir}/failure.png`}).catch(()=>{});await writeFile(`${artifactDir}/partial-evidence.json`,JSON.stringify(evidence,null,2));throw error;}
finally {await closeObservation();await f.close();}

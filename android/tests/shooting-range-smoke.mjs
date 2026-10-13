import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,readdir,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {nativeProgressionFixture} from './helpers/progression-native.js';
import {setupSolo,fightSolo,goHome,readProfile} from '../../tests/helpers/progression-browser.js';
import {choosePowers} from '../../tests/helpers/solo-powers-browser.js';
import {enterRange,observeRange,aimAtRangeTarget,fireRangeKill} from '../../tests/helpers/range-browser.js';
import {equip,until} from '../../tests/helpers/loot-browser.js';
import {touchControls} from '../../tests/helpers/traversal-browser.js';

// Catches save loss during signed upgrades/reinstalls, incorrect real rewards,
// held touch leakage, pause-clock advancement and persistence of temporary guns
// or powers. All writes to saves/gameplay come through visible app controls.
for(const key of ['ANDROID_TEST_ARTIFACTS','ANDROID_APK_PATH','ANDROID_BASELINE_APK_PATH','ANDROID_TEST_SERIAL','ANDROID_TEST_AVD'])assert.ok(process.env[key],`Explicit ${key} required`);
const artifactDir=resolve(process.env.ANDROID_TEST_ARTIFACTS),apk=resolve(process.env.ANDROID_APK_PATH),baseline=resolve(process.env.ANDROID_BASELINE_APK_PATH);
await mkdir(artifactDir,{recursive:true});
const run=promisify(execFile),sdk=process.env.ANDROID_SDK_ROOT||process.env.ANDROID_HOME||`${process.env.HOME}/Android/Sdk`;
const adb=(...args)=>run(join(sdk,'platform-tools','adb'),['-s',process.env.ANDROID_TEST_SERIAL,...args]);
let tools;for(const version of (await readdir(join(sdk,'build-tools'))).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}))){const path=join(sdk,'build-tools',version);try{await access(join(path,'aapt'));await access(join(path,'apksigner'));tools=path;break;}catch{}}
assert.ok(tools,'SDK metadata and signature readers available');
const evidence={artifacts:{},kills:[],lifecycle:[]};
for(const [label,path,code,name] of [['baseline',baseline,13,'0.9.2'],['candidate',apk,14,'0.10.0']]){
  const bytes=await readFile(path),sha256=createHash('sha256').update(bytes).digest('hex');
  if(label==='baseline')assert.equal(sha256,'4e6123695c96e4525b740423803abd7576e6dccb4aab0178148dea20d515e86a','retained baseline is unchanged');
  const badging=(await run(join(tools,'aapt'),['dump','badging',path])).stdout;
  assert.ok(badging.includes(`package: name='au.local.blockops' versionCode='${code}' versionName='${name}'`),`${label} identity before device mutation`);
  const signer=(await run(join(tools,'apksigner'),['verify','--verbose','--print-certs',path])).stdout;
  assert.match(signer,/Signer #1 certificate SHA-256 digest: 6b2d84eb4133168fec0850ed710acffa01d8399b75c8410621b2d0ce9881cb49/);
  evidence.artifacts[label]={path,sha256,badging,signer};
}
const f=await nativeProgressionFixture({artifactDir});
const off={invincible:false,unlimitedAmmo:false,superSpeed:false,speedMultiplier:2},pin='0427';
const keys=['block-ops-v1','block-ops-progression-v1','block-ops-progression-v1-backup','block-ops-zombies-v1','block-ops-solo-powers-pin-v1'];
const saves=page=>page.evaluate(keys=>Object.fromEntries(keys.map(key=>[key,localStorage.getItem(key)])),keys);
let page,observation;
async function openPowers(page,{origin='home',pin,firstSetup=false}={}){
  for(let i=0;i<5;i++)await page.locator(origin==='home'?'#home-secret-logo':'#pause-secret-logo').click();
  await page.waitForSelector('#solo-powers-screen:not([hidden])');
  assert.equal(await page.locator('#solo-powers-controls').isVisible(),false);
  assert.equal(await page.locator('#solo-powers-pin').getAttribute('type'),'password');
  await page.locator('#solo-powers-pin').fill(pin);if(firstSetup)await page.locator('#solo-powers-pin-confirm').fill(pin);
  // The real Android IME obscures the lower controls. Wait for its actual
  // state, dismiss with Back, then tap submit after it is gone; do not synthesize
  // a click through the keyboard or change the production PIN flow.
  await until(async()=>/mInputShown=true/.test((await adb('shell','dumpsys','input_method')).stdout),'native PIN keyboard appears');
  await adb('shell','input','keyevent','KEYCODE_BACK');
  await until(async()=>/mInputShown=false/.test((await adb('shell','dumpsys','input_method')).stdout),'native PIN keyboard dismissed');
  assert.equal(await page.locator('#solo-powers-screen').isVisible(),true,'IME dismissal leaves gate open');
  await page.locator('#solo-powers-pin-submit').click();await page.waitForSelector('#solo-powers-controls:not([hidden])');
}
async function closeObservation(){await observation?.close();observation=null;}
async function checkOff(){await openPowers(page,{pin});for(const name of ['invincible','ammo','speed'])assert.equal(await page.locator(`#solo-powers-${name}`).evaluate(el=>el.checked),false);assert.equal(await page.locator('#solo-powers-speed-multiplier').evaluate(el=>el.value),'2');await page.locator('#solo-powers-cancel').click();}
async function normalSelections(){assert.equal(await page.locator('[data-map="neon-city"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('[data-mode-id="ctf"]').getAttribute('aria-pressed'),'true');await page.locator('#home-armory').click();assert.equal(await page.locator('[data-weapon="minigun"]').getAttribute('aria-pressed'),'true');await page.locator('#armory-home').click();}
async function freshVisit(){await enterRange(page);observation=await observeRange(page);const state=await observation.read();assert.equal(state.targets.length,6);assert.ok(state.targets.every(t=>t.health===100));assert.deepEqual(state.stats,{targetKills:0,shotsFired:0,shotsHit:0,accuracy:0,earnedXP:0},'every visit starts with complete zero statistics');return state;}
try{
  await f.install(baseline);page=await f.attach();assert.deepEqual(await f.version(),{code:13,name:'0.9.2'});
  await setupSolo(page);await page.locator('[data-skin="shadow-ninja"]').click();
  const startXP=(await readProfile(page)).lifetimeXP;
  await page.locator('#home-solo').click();await fightSolo(page,1,{artifactDir,label:'baseline-kill'});await goHome(page);
  assert.equal((await readProfile(page)).lifetimeXP,startXP+10,'baseline earns genuine XP before migration');
  await page.locator('[data-map="neon-city"]').click();await page.locator('[data-mode-id="ctf"]').click();
  await page.locator('#home-armory').click();await page.locator('[data-class="lmg"]').click();await page.locator('[data-weapon="minigun"]').click();await page.locator('#armory-home').click();
  const existingPin=await page.evaluate(()=>localStorage.getItem('block-ops-solo-powers-pin-v1'));
  await openPowers(page,{pin,firstSetup:existingPin===null});await choosePowers(page,off);
  // Establish baseline persistence through actual lifecycle and a baseline-only
  // restart before attributing any save change to the candidate upgrade.
  await f.background();await f.foreground();await page.waitForFunction(()=>!document.hidden&&document.hasFocus());
  const baselineSaved=await saves(page);page=await f.relaunch();
  assert.deepEqual(await saves(page),baselineSaved,'baseline lifecycle/force-stop retains saved UI state before upgrade');
  evidence.baselinePersistence={version:await f.version(),saved:baselineSaved};
  const before=await saves(page),pinRecord=before['block-ops-solo-powers-pin-v1'];
  assert.equal(JSON.parse(pinRecord).kdf,'PBKDF2-SHA256');assert.equal(JSON.parse(pinRecord).iterations,100000);
  evidence.beforeUpgrade=before;await writeFile(`${artifactDir}/before-upgrade.json`,JSON.stringify(before,null,2));
  await f.install(apk);page=await f.attach();assert.deepEqual(await f.version(),{code:14,name:'0.10.0'});
  assert.deepEqual(await saves(page),before,'signed upgrade preserves every previous save byte before new actions');
  assert.equal(await page.evaluate(()=>location.href),'https://appassets.androidplatform.net/assets/index.html');
  evidence.identity=await f.identity();assert.equal(evidence.identity.wifi,'0');assert.equal(evidence.identity.mobileData,'0');
  await normalSelections();await checkOff();const rangeXP=(await readProfile(page)).lifetimeXP;
  await freshVisit();await page.screenshot({path:`${artifactDir}/range-initial.png`});
  console.log(`SCREENSHOT ${artifactDir}/range-initial.png`);
  await equip(page,'sniper','awp');
  for(const [id,region,total] of [['close-dummy','body',10],['medium-dummy','head',30],['close-bullseye','centre',50]]){evidence.kills.push(await fireRangeKill(page,id,region,observation));assert.equal((await readProfile(page)).lifetimeXP,rangeXP+total);}
  console.log('PASS offline native upgrade, map/targets and powers-off 10/20/20 XP');
  await page.locator('#loadout-button').click();const menu=await observation.read();await page.waitForTimeout(5500);assert.deepEqual((await observation.read()).targets,menu.targets,'Loadout freezes target clock');assert.equal((await observation.read()).time,menu.time);await page.locator('#play-button').click();
  await equip(page,'lmg','minigun');await aimAtRangeTarget(page,'far-dummy','body',observation);
  const touch=await touchControls(page),beforeTouch=await observation.read();
  try{await touch.send('touchStart',[await touch.point('#fire-button',71)]);await until(async()=>(await observation.read()).time-beforeTouch.time>=.8,'native held touch fire',20000);}finally{await touch.send('touchEnd');await touch.close();}
  const released=await observation.read();assert.ok(beforeTouch.ammo-released.ammo>=15&&released.ammo>=0,'held touch consumes at least15 finite rounds');assert.equal(released.input.fire,false);await page.waitForTimeout(500);assert.equal((await observation.read()).ammo,released.ammo,'touch release stops firing');evidence.touch={beforeTouch,released};
  await page.locator('#reload-button').tap();await until(async()=>(await observation.read()).reload>0,'native reload begins');await until(async()=>(await observation.read()).ammo===200,'native finite reload completes',30000);
  await page.locator('#pause-button').click();await openPowers(page,{origin:'paused',pin});
  await run(join(sdk,'platform-tools','adb'),['-s',process.env.ANDROID_TEST_SERIAL,'shell','input','keyevent','KEYCODE_BACK']);
  await page.waitForFunction(()=>document.getElementById('solo-powers-screen').hidden);assert.equal(await page.locator('body').getAttribute('data-mode'),'paused');
  await openPowers(page,{origin:'paused',pin});await choosePowers(page,{...off,invincible:true,unlimitedAmmo:true,superSpeed:true,speedMultiplier:5});await page.locator('#resume-button').click();
  assert.equal(await page.locator('#ammo-count').textContent(),'∞');assert.equal(await page.locator('#reload-button').isDisabled(),true);
  assert.deepEqual((await observation.read()).powers,{invincible:true,unlimitedAmmo:true,superSpeed:true,speedMultiplier:5});
  await equip(page,'sniper','awp');const poweredXP=(await readProfile(page)).lifetimeXP;
  const poweredAmmo=(await observation.read()).ammo;
  for(const [id,region,total] of [['close-dummy','body',10],['medium-dummy','head',30],['close-bullseye','centre',50]]){evidence.kills.push(await fireRangeKill(page,id,region,observation));assert.equal((await readProfile(page)).lifetimeXP,poweredXP+total);}
  assert.equal((await observation.read()).ammo,poweredAmmo,'powered real kills retain finite internal magazine');
  // Background immediately after a kill: actual Android visibility transitions
  // must freeze both active time and target respawn, and require explicit Resume.
  await f.background();assert.equal(await page.evaluate(()=>document.hidden),true);const hidden=await observation.read();assert.equal(await page.locator('body').getAttribute('data-mode'),'paused');await page.waitForTimeout(5500);
  const background=await observation.read();assert.equal(background.time,hidden.time);assert.deepEqual(background.targets,hidden.targets);assert.deepEqual(background.stats,hidden.stats);
  await f.foreground();await page.waitForFunction(()=>!document.hidden&&document.hasFocus());assert.equal(await page.locator('body').getAttribute('data-mode'),'paused');const foreground=await observation.read();assert.equal(foreground.time,hidden.time);assert.deepEqual(foreground.targets,hidden.targets);evidence.lifecycle.push({hidden,background,foreground});await page.screenshot({path:`${artifactDir}/foreground-requires-resume.png`});await page.locator('#resume-button').click();
  await until(async()=>(await observation.read()).targets.find(t=>t.id==='close-bullseye').health===100,'backgrounded target resumes natural five-second respawn',30000);
  await closeObservation();await goHome(page);await normalSelections();await checkOff();
  const earned=await saves(page);evidence.earned=earned;assert.equal((await readProfile(page)).skinId,'shadow-ninja');assert.equal(earned['block-ops-solo-powers-pin-v1'],pinRecord);
  await openPowers(page,{pin});await choosePowers(page,{...off,invincible:true,unlimitedAmmo:true,superSpeed:true,speedMultiplier:5});
  page=await f.relaunch();assert.deepEqual(await saves(page),earned,'offline force-stop/relaunch preserves earned saves');await normalSelections();await checkOff();
  await openPowers(page,{pin});await choosePowers(page,{...off,invincible:true,unlimitedAmmo:true,superSpeed:true,speedMultiplier:5});
  await f.install(apk);page=await f.attach();assert.deepEqual(await saves(page),earned,'same candidate install-r preserves earned saves');await normalSelections();await checkOff();
  await freshVisit();await closeObservation();await goHome(page);await page.screenshot({path:`${artifactDir}/retained-after-reinstall.png`});
  f.clean();evidence.result='PASS';console.log('PASS native held touch/reload/Loadout/Back; real hidden/visible pause; powered10/20/20; exact saves/reinstall; fresh zero stats');
}catch(error){evidence.result='INCOMPLETE';evidence.error=String(error);if(page)await page.screenshot({path:`${artifactDir}/failure.png`}).catch(()=>{});throw error;}
finally{await closeObservation();await writeFile(`${artifactDir}/native-shooting-range-evidence.json`,JSON.stringify(evidence,null,2));await f.close();}

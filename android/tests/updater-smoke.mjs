import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {nativeProgressionFixture} from './helpers/progression-native.js';
import {updaterNativeFixture} from './helpers/updater-native.js';
import {setupSolo,goHome,readProfile,visibleZombie,dragAim} from '../../tests/helpers/progression-browser.js';
import {choosePowers} from '../../tests/helpers/solo-powers-browser.js';
import {enterRange,observeRange,fireRangeKill} from '../../tests/helpers/range-browser.js';
import {equip} from '../../tests/helpers/loot-browser.js';

for(const key of ['ANDROID_TEST_SERIAL','ANDROID_TEST_AVD','ANDROID_TEST_ARTIFACTS','ANDROID_FIXTURE_MANIFEST'])assert.ok(process.env[key],`Explicit ${key} required`);
const artifactDir=resolve(process.env.ANDROID_TEST_ARTIFACTS),manifest=JSON.parse(await readFile(process.env.ANDROID_FIXTURE_MANIFEST,'utf8'));
await mkdir(artifactDir,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
for(const fixture of [manifest.baseline,manifest.candidate,...Object.values(manifest.fixtures)])assert.equal(hash(await readFile(fixture.path)),fixture.sha256,'Exact verified fixture bytes');
assert.equal(manifest.baseline.sha256,'e208ef6fd6fdefb0cc6ea1e49eb31d4e0deff2956f3299252e86c51ae7a6385b');
assert.equal(manifest.candidate.code,15);assert.equal(manifest.fixtures.valid.code,16);
const run=promisify(execFile),tools='/home/alex/Android/Sdk/build-tools/36.0.0';
for(const fixture of [manifest.baseline,manifest.candidate,...Object.values(manifest.fixtures).filter(f=>!f.deliberatelyInvalid)]){
  const signature=(await run(join(tools,'apksigner'),['verify','--print-certs',fixture.path])).stdout;assert.ok(signature.includes(`Signer #1 certificate SHA-256 digest: ${fixture.signer}`));
  const metadata=(await run(join(tools,'aapt2'),['dump','badging',fixture.path])).stdout;assert.ok(metadata.includes(`package: name='${fixture.packageName}' versionCode='${fixture.code}' versionName='${fixture.name}'`));
}
const testSignature=(await run(join(tools,'apksigner'),['verify','--print-certs',manifest.instrumentation])).stdout;assert.ok(testSignature.includes('6b2d84eb4133168fec0850ed710acffa01d8399b75c8410621b2d0ce9881cb49'));
if(manifest.instrumentationIdentity)assert.equal(hash(await readFile(manifest.instrumentation)),manifest.instrumentationIdentity.sha256);
const native=await updaterNativeFixture({artifactDir,serial:process.env.ANDROID_TEST_SERIAL,avd:process.env.ANDROID_TEST_AVD});
const rawFixture=await nativeProgressionFixture({artifactDir,networkMode:'preserve'});
const f={...rawFixture,async attach(){return native.gamePage(await rawFixture.attach());},async relaunch(){return native.gamePage(await rawFixture.relaunch());}};
const keys=['block-ops-v1','block-ops-progression-v1','block-ops-progression-v1-backup','block-ops-zombies-v1','block-ops-solo-powers-pin-v1'];
const saves=page=>page.evaluate(keys=>{const result={};keys.forEach(key=>result[key]=localStorage.getItem(key));return result;},keys);
const off={invincible:false,unlimitedAmmo:false,superSpeed:false,speedMultiplier:2},pin='0427';
const prepareOnly=process.argv.includes('--prepare-only')||process.argv.includes('--resume-earn15');
let page,observation,preservePending=false;const evidence={api:native.api,phases:[],kills:[]};
async function record(name,value){await writeFile(join(artifactDir,`${name}.json`),JSON.stringify(value,null,2),{mode:0o600});}
async function installedBytes(fixture,label){
  const path=(await native.command('shell','pm','path','au.local.blockops')).stdout.trim().replace(/^package:/,'');
  const copy=join(artifactDir,`installed-${label}.apk`);await native.command('pull',path,copy);
  assert.equal(hash(await readFile(copy)),fixture.sha256,'Installed APK is the exact verified fixture');
  await record(`installed-${label}`,{sha256:fixture.sha256,...await native.version()});
}
async function powers(firstSetup=false,origin='home'){
  const logo=origin==='home'?'#home-secret-logo':'#pause-secret-logo';
  if(native.api==='26')await page.logoGesture(logo);else for(let i=0;i<5;i++)await page.locator(logo).click();
  await page.waitForSelector('#solo-powers-screen:not([hidden])');await page.locator('#solo-powers-pin').fill(pin);
  if(firstSetup)await page.locator('#solo-powers-pin-confirm').fill(pin);
  // Normal Android Back dismisses the IME, leaving the visible PIN gate intact.
  if(/mInputShown=true/.test((await native.command('shell','dumpsys','input_method')).stdout))await native.mutate('shell','input','keyevent','KEYCODE_BACK');
  await page.locator('#solo-powers-pin-submit').click();await page.waitForSelector('#solo-powers-controls:not([hidden])');
}
async function checkOff(){await powers();for(const name of ['invincible','ammo','speed'])assert.equal(await page.locator(`#solo-powers-${name}`).evaluate(e=>e.checked),false);await page.locator('#solo-powers-cancel').click();}
async function openUpdate(){await page.locator('#update-check').click();await page.locator('#update-open').click();}
async function retryCancelledCandidate(){
  await page.locator('#update-open').click();await native.button('Retry');
  await native.until(async()=>(await native.status()).phase==='ready','Home Retry retains complete candidate');
  assert.match(await native.hierarchy(),/text="(?:INSTALL|Install)"/);assert.deepEqual((await native.status()).sessions,[]);
  await native.screenshot('cancel-retry-install');await record('cancel-retry',await native.status());
}
async function negativeCases(){
  assert.equal((await native.version()).code,15,'Run negatives before the irreversible native replacement');
  for(const [fixture,mode] of [['wrongPackage','normal'],['wrongSigner','normal'],['older','normal'],['malformed','normal'],['truncated','normal'],['valid','shortTransfer'],['valid','transferError'],['valid','storageFull']]){
    await native.instrument(fixture,mode,{reset:true});page=await f.attach();const before=await saves(page);
    await openUpdate();await native.button('Download');
    const status=await native.until(async()=>{const s=await native.status();return s.phase==='error'&&s;},`${fixture}/${mode} rejected`);
    assert.equal((await native.version()).code,15);assert.deepEqual(status.sessions,[],'Rejected candidate never creates installer session');assert.deepEqual(await saves(page),before);
    await native.screenshot(`negative-${fixture}-${mode}`);await record(`negative-${fixture}-${mode}`,status);console.log(`PASS negative ${fixture}/${mode}: ${status.message}`);
  }
  for(const action of ['cancel','background']){
    await native.instrument('valid','slow',{reset:true});page=await f.attach();await openUpdate();await native.button('Download');
    await native.until(async()=>(await native.status()).downloaded>0,'real store receives delayed scripted bytes');
    if(action==='cancel')await native.button('Cancel');else await f.background();
    await native.until(async()=>!['checking','downloading','verifying'].includes((await native.status()).phase),`${action} cancels transfer`);
    const status=await native.status();assert.deepEqual(status.sessions,[]);await record(`transfer-${action}`,status);console.log(`PASS foreground transfer ${action}`);
    if(action==='background')await f.foreground();
  }
  await native.instrument('valid','recreate',{reset:true});page=await f.attach();await openUpdate();await native.button('Download');
  await native.until(async()=>(await native.status()).phase==='ready','transfer survives real Activity recreation',90000);
  assert.ok((await native.status()).activityCreations>=2,'Actual Activity was recreated during the transfer');
  await native.screenshot('recreation-ready');await record('recreation',await native.status());
  await native.instrument('valid','recreate');page=await f.attach();
  assert.equal((await native.status()).phase,'ready','Complete real candidate survives process restart and revalidation');
  await record('complete-candidate-restart',await native.status());evidence.result='NEGATIVES_PASS';
}
async function recoveryCases(){
  assert.equal((await native.version()).code,15);
  await native.instrument('valid','normal',{reset:true});page=await f.attach();const before=await saves(page);
  await openUpdate();await native.button('Download');await native.button('Install');
  await native.until(async()=>(await native.status()).phase==='permission','initial source permission missing');
  await native.button('Open Settings');await native.permissionEnabled(false);await native.screenshot('permission-denied');
  await native.mutate('shell','input','keyevent','KEYCODE_BACK');
  await native.until(async()=>(await native.status()).phase==='permission','denied source permission does not install');
  assert.deepEqual((await native.status()).sessions,[]);assert.equal((await native.version()).code,15);
  await page.locator('#update-open').click();await native.button('Open Settings');
  await native.button('Allow from this source');await native.permissionEnabled(true);await native.screenshot('permission-granted');await native.mutate('shell','input','keyevent','KEYCODE_BACK');
  await native.until(async()=>(await native.status()).phase==='ready','permission grant returns ready without committing');assert.deepEqual((await native.status()).sessions,[]);
  await page.locator('#update-open').click();await native.button('Install');
  await native.installerConfirmation();
  await native.screenshot('os-confirmation-before-cancel');await native.button('Cancel');
  const cancelled=await native.until(async()=>{const s=await native.status();return s.phase==='error'&&s.message.includes('cancelled')&&s;},'Android cancellation is reported without installing');
  assert.deepEqual(cancelled.sessions,[]);assert.equal(cancelled.ownedSession,undefined);await record('os-cancellation',cancelled);
  assert.equal((await native.version()).code,15);assert.deepEqual(await saves(page),before);
  await retryCancelledCandidate();
  await native.instrument('valid','normal');page=await f.attach();assert.equal((await native.status()).phase,'ready','Cancelled Android install retains complete candidate for explicit retry');
  await submissionRecovery(before);evidence.result='RECOVERY_PASS';console.log('PASS real denial/grant, OS cancel, process death/recovery, no double commit, unrelated session retained');
}
async function submissionRecovery(before){
  assert.equal((await native.version()).code,15);
  await native.instrument('valid','deathAtSubmission',{reset:true,sentinel:true});page=await f.attach();
  const sentinel=Number((await native.command('shell','run-as','au.local.blockops','cat','files/updater-fixture-sentinel.txt')).stdout.trim());assert.ok(sentinel>=0);
  await openUpdate();await native.button('Download');await native.button('Install');
  const submitted=await native.until(async()=>{const s=await native.status();return s.ownedSession!==undefined&&s.ownedSealed===true&&s.phase==='installing'&&s;},'durable sealed session at real process death');
  await native.until(async()=>!(await native.command('shell','pidof','au.local.blockops').catch(()=>({stdout:''}))).stdout.trim(),'app process actually died');
  await record('death-after-submission',submitted);await native.instrument('valid','deathAtSubmission');page=await f.attach();
  const recovered=await native.status();assert.notEqual(recovered.pid,submitted.pid);assert.equal(recovered.phase,'installing');assert.equal(recovered.ownedSession,submitted.ownedSession);assert.deepEqual(recovered.sessions.sort(),submitted.sessions.sort(),'Restart never creates a second installer session');
  await record('recovered-owned-session',recovered);
  await page.locator('#update-open').click();await native.button('Cancel pending install');
  await native.until(async()=>{const s=await native.status();return s.phase==='ready'&&s.sessions.length===1&&s.sessions[0]===sentinel;},'cancel removes only updater-owned session');
  await record('process-recovery',await native.status());assert.deepEqual(await saves(page),before);
  await native.suite('cleanupSentinel');console.log('PASS sealed submission, new process, no double commit, unrelated session retained');
}
async function earn(){
  await setupSolo(page);const start=(await readProfile(page)).lifetimeXP;
  await enterRange(page);observation=await observeRange(page);await equip(page,'sniper','awp');
  for(let i=0;i<8;i++){evidence.kills.push(await fireRangeKill(page,i%2?'medium-dummy':'close-bullseye',i%2?'head':'centre',observation));console.log(`PASS genuine range kill ${i+1}/8`);}
  assert.equal((await readProfile(page)).lifetimeXP-start,160);await observation.close();observation=null;await goHome(page);
  await page.locator('[data-skin="crimson-ninja"]').click();assert.equal((await readProfile(page)).skinId,'crimson-ninja');
  await powers((await saves(page))['block-ops-solo-powers-pin-v1']===null);await choosePowers(page,{...off,invincible:true,unlimitedAmmo:true});
  await page.locator('[data-map="neon-city"]').click();await page.locator('[data-mode-id="zombies"]').click();await page.locator('#home-solo').click();
  await dragAim(page,Math.PI/.0026);let attempts=0;const deadline=Date.now()+120000;
  while(Number.parseInt(await page.locator('#timer').textContent())<1){
    assert.ok(Date.now()<deadline,'Earn genuine Zombie record');assert.equal(await page.locator('body').getAttribute('data-mode'),'playing');
    const target=await visibleZombie(page);
    if(target){const focal=target.height/(2*Math.tan(75*Math.PI/360));await dragAim(page,Math.atan((target.x-target.width/2)/focal)/.0026,Math.atan((target.y-target.height/2)/focal)/.0026);await page.keyboard.down('KeyF');await page.waitForTimeout(180);await page.keyboard.up('KeyF');}
    else{if(++attempts%5===0)await dragAim(page,140);await page.waitForTimeout(160);}
  }
  if(native.api==='26')await native.mutate('shell','input','keyevent','KEYCODE_BACK');else await page.locator('#pause-button').click();
  await page.waitForSelector('#pause-screen:not([hidden])');await powers(false,'paused');await choosePowers(page,off);await page.locator('#resume-button').click();
  await page.waitForFunction(()=>document.body.dataset.mode==='results',null,{timeout:120000});await page.screenshot({path:join(artifactDir,'genuine-zombie-result.png')});await goHome(page);
  const stored=await saves(page);assert.ok(JSON.parse(stored['block-ops-zombies-v1'])['neon-city'].kills>=1);assert.equal(JSON.parse(stored['block-ops-solo-powers-pin-v1']).kdf,'PBKDF2-SHA256');
  await f.background();await f.foreground();page=await f.relaunch();assert.deepEqual(await saves(page),stored,'Earned save survives baseline restart');
  await record('earned-save',stored);return stored;
}
try {
  evidence.device=await f.identity();await record('fixture-identities',manifest);
  const observeNative16=process.argv.includes('--observe-native16');
  if(!observeNative16)await native.mutate('install','-r','-t',manifest.instrumentation);
  if(observeNative16){
    assert.match(process.env.ANDROID_PREVIOUS_APP_PID||'',/^\d+$/);assert.match(process.env.ANDROID_SUBMITTED_SESSION||'',/^\d+$/);
    const provenance=JSON.parse(await readFile(process.env.ANDROID_PENDING_EVIDENCE_PATH,'utf8'));
    assert.equal(String(provenance.pid),process.env.ANDROID_PREVIOUS_APP_PID);assert.equal(String(provenance.ownedSession),process.env.ANDROID_SUBMITTED_SESSION);assert.equal(provenance.phase,'installing');
    assert.deepEqual(provenance.sessions,[provenance.ownedSession]);
    const packages=(await native.command('shell','dumpsys','package')).stdout;
    const historical=packages.split('Historical install sessions:')[1]||'';
    const session=historical.split(`Session ${provenance.ownedSession}:`)[1]?.split(/\n  Session |\nLegacy install sessions:/)[0];
    assert.ok(session&&session.includes('mOriginalInstallerPackageName=au.local.blockops')&&session.includes('mPermissionsManuallyAccepted=true')&&session.includes('mFinalMessage=Session installed')&&session.includes('mSessionApplied=true'),'Previously recorded real app-originating session must be installed');
    const active=packages.split('Active install sessions:')[1]?.split('Finalized install sessions:')[0];assert.ok(active!==undefined&&!/Session \d+:/.test(active),'No active session remains');
    assert.deepEqual(await native.version(),{code:16,name:'0.11.1'});await installedBytes(manifest.fixtures.valid,'native16');await record('installed-session-provenance',{sessionId:provenance.ownedSession,history:session,scanPerformed:false});
    const retained=JSON.parse(await readFile(join(artifactDir,'retained15.json'),'utf8'));page=await f.attach();assert.deepEqual(await saves(page),retained,'Previously submitted native replacement retains exact earned bytes before gameplay');
    const afterReplacementPid=(await native.command('shell','pidof','au.local.blockops')).stdout.trim();assert.notEqual(afterReplacementPid,process.env.ANDROID_PREVIOUS_APP_PID);
    await record('replacement-process',{beforeReplacementPid:process.env.ANDROID_PREVIOUS_APP_PID,afterReplacementPid});
    assert.equal(await page.evaluate(()=>location.href),'https://appassets.androidplatform.net/assets/index.html');await record('after-native16',await saves(page));await checkOff();await record('temporary-powers-reset',{verified:true});await native.screenshot('retained16-home');
    f.clean();evidence.result='PASS_OBSERVED_EXISTING_NATIVE16';console.log('PASS exact native16, original app-originating session, new process, packaged origin, exact genuine saves and powers reset; no scan claimed');
  }
  else if(process.argv.includes('--repair15')){
    assert.equal((await native.version()).code,15,'Development repair is same-code15 only');assert.ok(process.env.ANDROID_RETAINED_SAVE_PATH,'Explicit genuine save checkpoint required');
    const retained=JSON.parse(await readFile(process.env.ANDROID_RETAINED_SAVE_PATH,'utf8'));page=await f.attach();assert.deepEqual(await saves(page),retained);
    await f.install(manifest.candidate.path);page=await f.attach();assert.deepEqual(await saves(page),retained);assert.equal((await native.version()).code,15);
    await record('development-refresh15',{candidateSha256:manifest.candidate.sha256,exactSaveEquality:true});evidence.result='REPAIRED15';console.log('PASS explicitly authorized development15→15 repair retains exact earned saves');
  }
  else if(process.argv.includes('--diagnose-ui')){
    await native.instrument('valid','slow',{reset:true});page=await f.attach();await openUpdate();await native.button('Download');
    await native.until(async()=>(await native.status()).downloaded>0,'progress before idle-wait diagnosis');
    const before=await native.status(),started=Date.now();const xml=await native.hierarchy();const elapsed=Date.now()-started,after=await native.status();
    await record('accessibility-idle-diagnosis',{before,after,elapsed,xml});console.log(`OBSERVED native hierarchy ${elapsed}ms: ${before.phase}/${before.downloaded} -> ${after.phase}/${after.downloaded}`);evidence.result='DIAGNOSIS_RECORDED';
  }
  else if(process.argv.includes('--network')){
    await record('network-before',{connectivity:(await native.command('shell','dumpsys','connectivity')).stdout});
    console.log(await native.suite('network'));evidence.result='NETWORK_PASS';
  }
  else if(process.argv.includes('--regression')){
    for(const suite of [native.api==='36'?'controller':'installer','bridge'])console.log(await native.suite(suite));evidence.result='REGRESSION_PASS';
  }
  else if(process.argv.includes('--negative')){await negativeCases();}
  else if(process.argv.includes('--recovery')){await recoveryCases();}
  else if(process.argv.includes('--submission-recovery')){page=await f.attach();await submissionRecovery(await saves(page));evidence.result='SUBMISSION_RECOVERY_PASS';}
  else if(process.argv.includes('--cancel-retry')){
    assert.equal((await native.version()).code,15);await native.instrument('valid','normal',{reset:true});page=await f.attach();const before=await saves(page);
    await openUpdate();await native.button('Download');await native.button('Install');
    await native.installerConfirmation();
    await native.button('Cancel');await native.until(async()=>{const s=await native.status();return s.phase==='error'&&s.message.includes('cancelled');},'real Android cancellation');
    await retryCancelledCandidate();assert.deepEqual(await saves(page),before);evidence.result='CANCEL_RETRY_PASS';console.log('PASS real OS cancellation → Home Retry → retained Install');
  }
  else if(process.argv.includes('--probe')){
    await native.instrument('valid','probe',{reset:true});page=await f.attach();await openUpdate();await native.button('Download');
    await native.until(async()=>(await native.status()).phase==='ready','real fixture download ready');evidence.result='PROBE_PASS';console.log('PASS native fixture offer/download/verification; no installation');
  }
  else {
  let retained;
  if(process.argv.includes('--resume-native')){
    assert.equal((await native.version()).code,15);retained=JSON.parse(await readFile(join(artifactDir,'retained15.json'),'utf8'));page=await f.attach();assert.deepEqual(await saves(page),retained,'Resume uses the retained genuine save checkpoint');
  }else if(process.argv.includes('--resume-earn15')){
    assert.equal(native.api,'26','Earn-after-bootstrap continuation is the approved API26 matrix only');assert.equal((await native.version()).code,15);
    const prior=process.env.ANDROID_BOOTSTRAP_ARTIFACTS;assert.ok(prior,'Explicit original bootstrap evidence required');
    assert.equal(hash(await readFile(join(prior,'installed-baseline.apk'))),manifest.baseline.sha256);
    assert.equal(hash(await readFile(join(prior,'installed-candidate15.apk'))),manifest.candidate.sha256);
    assert.ok(JSON.parse(await readFile(join(prior,'exact14-api26-fatal.json'),'utf8')).xml.includes('Object.fromEntries is not a function'));
    await installedBytes(manifest.candidate,'continued15');await record('bootstrap-continuation',{prior,baselineSha256:manifest.baseline.sha256,candidateSha256:manifest.candidate.sha256,noDowngrade:true});
    page=await f.attach();retained=await earn();
  }else{
  const startingCode=(await native.version()).code;
  assert.ok(Number.isNaN(startingCode)||startingCode<=14,'A fresh chain starts before upgrading; never downgrade or clear to retry');
  await f.install(manifest.baseline.path);
  const installedPath=(await native.command('shell','pm','path','au.local.blockops')).stdout.trim().replace(/^package:/,'');
  const installedCopy=join(artifactDir,'installed-baseline.apk');await native.command('pull',installedPath,installedCopy);assert.equal(hash(await readFile(installedCopy)),manifest.baseline.sha256);
  if(native.api==='36'){page=await f.attach();retained=await earn();}
  else{
    await native.mutate('shell','am','start','-W','-n','au.local.blockops/.MainActivity');
    const failureXml=await native.until(async()=>{const xml=await native.hierarchy();return xml.includes('Object.fromEntries is not a function')&&xml;},'exact14 genuinely fails on Chrome69');
    await record('exact14-api26-fatal',{xml:failureXml});await native.screenshot('exact14-api26-startup');
    evidence.phases.push('API26 exact14 startup failure retained in environment-api26-ready.md; earned-save14→15 unavailable');
  }
  await f.install(manifest.candidate.path);page=await f.attach();assert.deepEqual(await native.version(),{code:15,name:'0.11.0'});await installedBytes(manifest.candidate,'candidate15');
  if(retained){assert.deepEqual(await saves(page),retained,'Manual14→15 retains exact earned save bytes');await record('after-manual15',await saves(page));}
  else retained=await earn();
  }
  assert.equal(await page.evaluate(()=>location.href),'https://appassets.androidplatform.net/assets/index.html');await checkOff();
  await record('retained15',retained);
  if(prepareOnly){evidence.result='PREPARED15';console.log('PASS earned-save bootstrap to15; native replacement intentionally pending');}
  else {
  if(!process.argv.includes('--resume-native')){
    await negativeCases();await recoveryCases();await record('network-before',{connectivity:(await native.command('shell','dumpsys','connectivity')).stdout});console.log(await native.suite('network'));
    page=await f.attach();assert.deepEqual(await saves(page),retained,'All acceptance scenarios retain the same earned save');
  }
  await powers();await choosePowers(page,{...off,invincible:true,unlimitedAmmo:true,superSpeed:true,speedMultiplier:5});
  await native.instrument('valid','normal',{reset:true});page=await f.attach();assert.deepEqual(await saves(page),retained,'Instrumentation launch retains genuine earned data');await checkOff();
  await installedBytes(manifest.candidate,'pre-native15');const beforeReplacementPid=(await native.command('shell','pidof','au.local.blockops')).stdout.trim();
  await powers();await choosePowers(page,{...off,invincible:true,unlimitedAmmo:true,superSpeed:true,speedMultiplier:5});
  await openUpdate();await native.button('Download');await native.button('Install');
  await native.screenshot('install-permission-or-confirmation');
  // The platform permission and confirmation phases are asserted below by their visible native controls.
  const xml=await native.hierarchy();
  if(xml.toLowerCase().includes('open settings')){await native.button('Open Settings');await native.permissionEnabled(false);await native.screenshot('unknown-app-source-permission');await native.button('Allow from this source');await native.permissionEnabled(true);await native.mutate('shell','input','keyevent','KEYCODE_BACK');await page.locator('#update-open').click();await native.button('Install');}
  const confirmationXml=await native.installerConfirmation();
  await native.screenshot('android-install-confirmation');
  const submission=await native.status();assert.equal(submission.phase,'installing');assert.ok(Number.isInteger(submission.ownedSession));assert.equal(submission.ownedSealed,true);
  await record('pending-native-submission',submission);
  preservePending=true;
  await native.button(/text="(?:UPDATE|Update)"/.test(confirmationXml)?'Update':'Install');await native.waitVersion(16,{scanAuthorized:process.env.ANDROID_ALLOW_PLAY_PROTECT_SCAN==='1'});
  if(/mCurrentFocus=.*(?:packageinstaller|permissioncontroller)/.test((await native.command('shell','dumpsys','window')).stdout)){
    const completedXml=await native.hierarchy();if(/text="(?:OPEN|Open)"/.test(completedXml))await native.button('Open');else if(/text="(?:DONE|Done)"/.test(completedXml))await native.button('Done');
  }
  page=await f.attach();assert.deepEqual(await saves(page),retained,'Native15→16 retains exact earned save bytes before gameplay');assert.deepEqual(await native.version(),{code:16,name:'0.11.1'});
  const afterReplacementPid=(await native.command('shell','pidof','au.local.blockops')).stdout.trim();assert.notEqual(afterReplacementPid,beforeReplacementPid,'Real replacement kills original application/instrumentation');
  const packageDump=(await native.command('shell','dumpsys','package')).stdout;
  const active=packageDump.split('Active install sessions:')[1]?.split(/Finalized install sessions:|Historical install sessions:/)[0];assert.ok(active!==undefined&&!/Session \d+:/.test(active),'No active install sessions after replacement');
  const session=packageDump.split('Historical install sessions:')[1]?.split(`Session ${submission.ownedSession}:`)[1]?.split(/\n  Session |\nLegacy install sessions:/)[0];
  assert.ok(session&&/[Ii]nstallerPackageName=au.local.blockops/.test(session)&&session.includes('mFinalStatus=1'),'The recorded app-originating OS session succeeded');
  await record('installed-session-provenance',{sessionId:submission.ownedSession,history:session,continuousHost:true});
  await record('replacement-process',{beforeReplacementPid,afterReplacementPid});await installedBytes(manifest.fixtures.valid,'native16');
  assert.equal(await page.evaluate(()=>location.href),'https://appassets.androidplatform.net/assets/index.html');await record('after-native16',await saves(page));await checkOff();
  await native.screenshot('retained16-home');f.clean();evidence.result='PASS';preservePending=false;console.log('PASS real signed upgrade chain and exact earned-save retention');
  }
  }
}catch(error){evidence.result='FAIL';evidence.error=String(error);await native.screenshot('failure').catch(()=>{});await record('failure-hierarchy',{xml:await native.hierarchy().catch(()=>null)});throw error;}
finally{
  await observation?.close().catch(()=>{});await record('acceptance-evidence',evidence);
  if(preservePending){
    await record('pending-preserved',{reason:evidence.error,version:await native.version().catch(error=>({observationError:String(error)})),packageDump:await native.command('shell','dumpsys','package').then(result=>result.stdout,error=>`Observation failed: ${error}`),noForceStop:true,noCancellation:true});
    await f.detach().catch(error=>record('detach-error',{error:String(error)}));await native.detachHost();console.error('STOP: pending native installation preserved; inspect recorded state before any resume.');process.exit(1);
  }
  await f.close().catch(async error=>{await record('cleanup-error',{error:String(error)});if(evidence.result!=='FAIL')throw error;});
}

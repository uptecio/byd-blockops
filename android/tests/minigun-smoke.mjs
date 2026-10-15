import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {nativeProgressionFixture} from './helpers/progression-native.js';

for(const key of ['ANDROID_TEST_ARTIFACTS','ANDROID_APK_PATH','ANDROID_TEST_SERIAL','ANDROID_TEST_AVD'])assert.ok(process.env[key],`Explicit ${key} required`);
const artifactDir=resolve(process.env.ANDROID_TEST_ARTIFACTS);
await mkdir(artifactDir,{recursive:true});
const fixture=await nativeProgressionFixture({artifactDir});
const evidence={};let page;
const ammo=async()=>({magazine:Number(await page.locator('#ammo-count').textContent()),reserve:Number(await page.locator('#reserve-count').textContent())});
try {
  await fixture.install(process.env.ANDROID_APK_PATH);page=await fixture.attach();
  evidence.version=await fixture.version();assert.deepEqual(evidence.version,{code:13,name:'0.9.2'});
  evidence.identity=await fixture.identity();assert.equal(evidence.identity.wifi,'0');assert.equal(evidence.identity.mobileData,'0');
  assert.equal(await page.evaluate(()=>location.href),'https://appassets.androidplatform.net/assets/index.html');
  await page.locator('#home-settings').click();await page.locator('#bots').fill('1');
  await page.locator('#difficulty').selectOption('easy');await page.locator('#sound').uncheck();await page.locator('#settings-done').click();
  await page.locator('#home-armory').click();await page.locator('[data-class="lmg"]').click();
  await page.locator('[data-weapon="minigun"]').click();
  assert.equal(await page.locator('[data-weapon="minigun"]').getAttribute('aria-pressed'),'true');
  await page.screenshot({path:`${artifactDir}/minigun-selected.png`});
  await page.locator('#armory-home').click();await page.locator('#home-solo').click();
  await page.waitForFunction(()=>document.body.dataset.mode==='playing');
  evidence.before=await ammo();assert.deepEqual(evidence.before,{magazine:200,reserve:300});
  await page.keyboard.down('KeyF');try{await page.waitForTimeout(1200);}finally{await page.keyboard.up('KeyF');}
  evidence.afterFire=await ammo();assert.ok(evidence.afterFire.magazine<200&&evidence.afterFire.magazine>0,'held fire consumes finite magazine');
  assert.equal(evidence.afterFire.reserve,300);
  await page.keyboard.press('KeyR');
  await page.waitForFunction(()=>Number(document.getElementById('ammo-count').textContent)===200,undefined,{timeout:45000});
  evidence.afterReload=await ammo();assert.equal(evidence.afterReload.magazine+evidence.afterReload.reserve,evidence.afterFire.magazine+evidence.afterFire.reserve,'reload conserves rounds');
  await page.screenshot({path:`${artifactDir}/minigun-reloaded.png`});
  await page.locator('#home-button').click();await page.locator('#confirm-home').click();
  await page.waitForFunction(()=>document.body.dataset.mode==='home');
  page=await fixture.relaunch();await page.locator('#home-armory').click();
  assert.equal(await page.locator('[data-weapon="minigun"]').getAttribute('aria-pressed'),'true','relaunch retains equipped minigun');
  await page.screenshot({path:`${artifactDir}/minigun-retained.png`});
  fixture.clean();evidence.result='PASS';
  await writeFile(`${artifactDir}/native-minigun-evidence.json`,JSON.stringify(evidence,null,2));
  console.log('PASS offline Android minigun selection, 200+300 finite held fire, conserving reload and relaunch retention');
} catch(error) {
  evidence.result='INCOMPLETE';evidence.error=String(error);
  if(page)await page.screenshot({path:`${artifactDir}/failure.png`}).catch(()=>{});
  await writeFile(`${artifactDir}/native-minigun-evidence.json`,JSON.stringify(evidence,null,2));throw error;
} finally {await fixture.close();}

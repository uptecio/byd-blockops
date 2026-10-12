import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { persistentFixture, setupSolo, fightSolo, goHome, readProfile } from './helpers/progression-browser.js';
import { fixture, until } from './helpers/loot-browser.js';
import { openPowers, choosePowers } from './helpers/solo-powers-browser.js';

const artifactDir=resolve(process.env.ARTIFACT_DIR || 'artifacts/solo-powers-browser');
await mkdir(artifactDir,{recursive:true});
const legacy=process.env.LEGACY_WEBVIEW==='1';
const fixturePin='0427';
const off={invincible:false,unlimitedAmmo:false,superSpeed:false,speedMultiplier:2};
const assist={...off,invincible:true,unlimitedAmmo:true};
const saves=page=>page.evaluate(()=>Object.fromEntries(['block-ops-v1','block-ops-progression-v1','block-ops-progression-v1-backup','block-ops-zombies-v1'].map(key=>[key,localStorage.getItem(key)])));
const pause=async page=>{await page.locator('#pause-button').click();await page.waitForSelector('body[data-mode="paused"]');};
async function checkOff(page) {
  for(const id of ['invincible','ammo','speed'])assert.equal(await page.locator(`#solo-powers-${id}`).evaluate(el=>el.checked),false);
  assert.equal(await page.locator('#solo-powers-speed-multiplier').inputValue(),'2');
}

const f=await persistentFixture({legacy,artifactDir});
try {
  let page=f.page;
  await setupSolo(page);
  const beforeGate=await saves(page);
  await openPowers(page,{pin:fixturePin,firstSetup:true});await choosePowers(page,assist);
  assert.deepEqual(await saves(page),beforeGate,'opening/applying Home powers does not rewrite existing saves');
  // Pending selection survives ordinary Home map/skin/loadout changes.
  await page.locator('[data-map="harbor"]').click();await page.locator('[data-map="courtyard"]').click();
  await page.locator('[data-skin="shadow-ninja"]').click();
  await page.locator('#home-armory').click();await page.locator('[data-class="assault"]').click();
  await page.locator('[data-weapon="m4a1"]').click();await page.locator('#armory-home').click();
  await page.locator('#home-solo').click();await page.waitForSelector('body[data-mode="playing"]');
  assert.equal(await page.locator('#ammo-count').textContent(),'∞');
  await page.keyboard.down('KeyF');await page.waitForTimeout(4000);await page.keyboard.up('KeyF');
  assert.equal(await page.locator('#ammo-count').textContent(),'∞');
  assert.equal(await page.locator('#health-count').textContent(),'100');
  assert.equal(await page.locator('#reload-button').isDisabled(),true);
  assert.equal(await page.locator('.inventory-count').first().textContent(),'∞');
  await pause(page);await openPowers(page,{origin:'paused',pin:fixturePin});
  await page.locator('#solo-powers-ammo').click();await page.keyboard.press('Escape');
  assert.equal(await page.locator('body').getAttribute('data-mode'),'paused');
  await page.locator('#resume-button').click();assert.equal(await page.locator('#ammo-count').textContent(),'∞');
  await pause(page);await openPowers(page,{origin:'paused',pin:fixturePin});await choosePowers(page,off);
  assert.equal(await page.locator('body').getAttribute('data-mode'),'paused');
  await page.locator('#resume-button').click();assert.notEqual(await page.locator('#ammo-count').textContent(),'∞');
  await pause(page);await openPowers(page,{origin:'paused',pin:fixturePin});await choosePowers(page,assist);
  await page.locator('#pause-home').click();await page.locator('#cancel-home').click();
  assert.equal(await page.locator('body').getAttribute('data-mode'),'paused');
  await openPowers(page,{origin:'paused',pin:fixturePin});
  await page.evaluate(()=>window.pauseGame());
  assert.equal(await page.locator('#solo-powers-screen').isVisible(),false);
  assert.equal(await page.locator('body').getAttribute('data-mode'),'paused');
  await openPowers(page,{origin:'paused',pin:fixturePin});await page.locator('#solo-powers-cancel').click();
  assert.equal(await page.locator('body').getAttribute('data-mode'),'paused','Back allows a fresh gate without resuming');
  await page.locator('#resume-button').click();assert.equal(await page.locator('#ammo-count').textContent(),'∞');
  await goHome(page);await openPowers(page,{pin:fixturePin});await checkOff(page);await page.locator('#solo-powers-cancel').click();
  // Failed online join still discards prepared solo powers.
  await openPowers(page,{pin:fixturePin});await choosePowers(page,assist);
  await page.locator('#home-online').click();await page.locator('#room-code-input').fill('ZZZZZZ');await page.locator('#join-room').click();
  await until(async()=>/not found|does not exist|expired/i.test(await page.locator('#connection-status').textContent()),'nonexistent room rejected');
  await page.locator('#online-back').click();await openPowers(page,{pin:fixturePin});await checkOff(page);await page.locator('#solo-powers-cancel').click();
  // Earn an unlock from actual kills, not injected progression state.
  await setupSolo(page);await openPowers(page,{pin:fixturePin});await choosePowers(page,assist);
  const previousXP=(await readProfile(page)).lifetimeXP;
  await page.locator('#home-solo').click();await fightSolo(page,15,{artifactDir,label:'powered'});
  await page.waitForSelector('body[data-mode="results"]');
  assert.equal((await readProfile(page)).lifetimeXP-previousXP,225);
  await page.locator('#again-button').click();assert.notEqual(await page.locator('#ammo-count').textContent(),'∞');
  await goHome(page);await page.locator('[data-skin="crimson-ninja"]').click();
  const savedProfile=await readProfile(page),savedPin=await page.evaluate(()=>localStorage.getItem('block-ops-solo-powers-pin-v1'));
  page=await f.reopen();assert.deepEqual(await readProfile(page),savedProfile);
  assert.equal(await page.evaluate(()=>localStorage.getItem('block-ops-solo-powers-pin-v1')),savedPin);
  await openPowers(page,{pin:fixturePin});await checkOff(page);await page.locator('#solo-powers-cancel').click();
  // Hold only the crypto boundary; a real form submits, then native pause
  // invalidates it before the credential result is delivered.
  await page.evaluate(()=>{
    const derive=crypto.subtle.deriveBits.bind(crypto.subtle);
    crypto.subtle.deriveBits=async(...args)=>{const value=await derive(...args);await new Promise(resolve=>setTimeout(resolve,1500));return value;};
  });
  for(let i=0;i<5;i++)await page.locator('#home-secret-logo').click();
  await page.locator('#solo-powers-pin').fill(fixturePin);await page.locator('#solo-powers-pin-submit').click();
  await page.evaluate(()=>window.pauseGame());await page.waitForTimeout(1800);
  assert.equal(await page.locator('#solo-powers-screen').isVisible(),false);
  assert.equal(await page.locator('body').getAttribute('data-mode'),'home');
  await page.reload();await openPowers(page,{pin:fixturePin});await checkOff(page);await choosePowers(page,assist);
  await page.locator('#home-solo').click();await pause(page);await openPowers(page,{origin:'paused',pin:fixturePin});
  const beforeFatalProfile=await readProfile(page);
  await page.evaluate(()=>window.dispatchEvent(new ErrorEvent('error',{message:'Fixture fatal during powers',error:new Error('Fixture fatal during powers')})));
  assert.equal(await page.locator('#fatal-screen').isVisible(),true);assert.equal(await page.locator('#solo-powers-screen').isVisible(),false);
  await page.locator('#retry-button').click();await page.waitForSelector('body[data-mode="home"]');
  assert.deepEqual(await readProfile(page),beforeFatalProfile);assert.equal(await page.evaluate(()=>localStorage.getItem('block-ops-solo-powers-pin-v1')),savedPin);
  await openPowers(page,{pin:fixturePin});await checkOff(page);await page.locator('#solo-powers-cancel').click();
  await page.screenshot({path:`${artifactDir}/home-saved-unlock.png`});
  f.clean();
  console.log('PASS: real Home/Pause controls, fire, reset, cancelled departure, failed join, XP unlock and full browser restart');
} finally {await f.close();}

// Capability faults are confined to fresh disposable browser contexts.
for(const fault of ['crypto-absent','crypto-throws','storage-throws']) {
  const faults=await fixture({width:1024,height:600},{legacy});
  try {
    const page=faults.pages[0];
    await page.addInitScript(fault=>{
      if(fault==='crypto-absent')Object.defineProperty(window,'crypto',{value:undefined});
      if(fault==='crypto-throws')Object.defineProperty(window,'crypto',{get(){throw Error('fixture crypto denied');}});
      if(fault==='storage-throws')Object.defineProperty(window,'localStorage',{get(){throw Error('fixture storage denied');}});
    },fault);
    await page.goto(faults.base);
    for(let i=0;i<5;i++)await page.locator('#home-secret-logo').click();
    await page.waitForSelector('#solo-powers-screen:not([hidden])');
    assert.equal(await page.locator('#solo-powers-pin-submit').isDisabled(),true);
    await page.locator('#solo-powers-cancel').click();await page.locator('#home-solo').click();
    await page.waitForSelector('body[data-mode="playing"]');assert.equal(await page.locator('#fatal-screen').isVisible(),false);
    assert.notEqual(await page.locator('#ammo-count').textContent(),'∞');faults.clean();
    console.log(`PASS: ${fault} locks only secret feature; ordinary game starts`);
  } finally {await faults.close();}
}

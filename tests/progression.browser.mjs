import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { persistentFixture, setupSolo, fightSolo, goHome, readProfile } from './helpers/progression-browser.js';

const artifactDir=process.env.ARTIFACT_DIR || 'artifacts/xp-progression-browser';
await mkdir(artifactDir,{recursive:true});
const f=await persistentFixture({legacy:process.env.LEGACY_WEBVIEW==='1',artifactDir});
try {
  let page=f.page;
  await setupSolo(page);
  assert.equal((await readProfile(page)).lifetimeXP,0);
  await page.locator('#home-solo').click();
  await fightSolo(page,14,{artifactDir,label:'early-exit'});await goHome(page);
  assert.equal((await readProfile(page)).lifetimeXP,140,'early exit keeps only genuine kill XP');
  await page.locator('#home-solo').click();await fightSolo(page,1,{artifactDir,label:'first-unlock'});
  assert.equal((await readProfile(page)).lifetimeXP,150);
  await page.locator('#loadout-button').click();await page.locator('#armory-skin').selectOption('crimson-ninja');
  assert.match(await page.locator('#appearance-timing').textContent(),/Next respawn.*Crimson Ninja.*Wearing: Ranger/);
  assert.equal((await readProfile(page)).skinId,'crimson-ninja');
  await page.screenshot({path:`${artifactDir}/pending-first-unlock.png`});
  await page.locator('#armory-home').click();await page.locator('#confirm-home').click();
  page=await f.reopen();
  assert.equal((await readProfile(page)).lifetimeXP,150);assert.equal((await readProfile(page)).skinId,'crimson-ninja');
  assert.match(await page.locator('#character-preview').getAttribute('aria-label'),/Crimson Ninja/);
  await page.screenshot({path:`${artifactDir}/first-reopen.png`});
  await page.locator('#home-solo').click();await fightSolo(page,15,{artifactDir,label:'natural-win'});
  await page.waitForSelector('body[data-mode="results"]');
  assert.match(await page.locator('#results-progression').textContent(),/225 XP/);
  assert.equal((await readProfile(page)).lifetimeXP,375);
  await page.screenshot({path:`${artifactDir}/natural-win.png`});
  await page.locator('#results-loadout').click();await page.locator('[data-finish="crimson-red"]').click();
  assert.match(await page.locator('#weapon-preview').getAttribute('aria-label'),/Crimson Red/);
  await page.screenshot({path:`${artifactDir}/earned-gun-finish.png`});
  await page.locator('#armory-home').click();page=await f.reopen();
  const saved=await readProfile(page);assert.equal(saved.lifetimeXP,375);assert.equal(saved.finishId,'crimson-red');assert.equal(saved.skinId,'crimson-ninja');
  await page.screenshot({path:`${artifactDir}/second-reopen.png`});
  console.log('PASS genuine solo XP: 140 early exit + 10 unlock + 225 natural win = 375; skin/finish retained across two full persistent-browser restarts.');
  f.clean();
} finally {await f.close();}

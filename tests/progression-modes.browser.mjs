import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {persistentFixture,setupSolo,fightSolo,goHome,readProfile} from './helpers/progression-browser.js';
import {walkSolo} from './helpers/loot-browser.js';
import {startServer} from '../server/server.mjs';

const artifacts=process.env.ARTIFACT_DIR||'artifacts/xp-progression-modes';
await mkdir(artifacts,{recursive:true});
const legacy=process.env.LEGACY_WEBVIEW==='1';
const f=await persistentFixture({legacy,artifactDir:artifacts});
try {
  const page=f.page;await setupSolo(page);
  await page.locator('[data-mode-id="tdm"]').click();await page.locator('#home-solo').click();
  await walkSolo(page,'KeyD',6);await fightSolo(page,1,{artifactDir:artifacts,label:'tdm'});
  assert.match(await page.locator('#kills').textContent(),/^RED 1/);
  await goHome(page);assert.equal((await readProfile(page)).lifetimeXP,10);
  await page.locator('[data-mode-id="ctf"]').click();await page.locator('#home-solo').click();
  await walkSolo(page,'KeyD',6);await walkSolo(page,'KeyW',37);
  assert.match(await page.locator('#objective-status').textContent(),/BLUE FLAG: CARRIED/);
  await walkSolo(page,'KeyS',37);
  await page.waitForFunction(()=>document.getElementById('kills').textContent.startsWith('RED 1'));
  assert.equal((await readProfile(page)).lifetimeXP,60,'one real capture adds50, flag pickup adds0');
  await goHome(page);const saved=await readProfile(page);
  const other=await startServer({port:0,distDir:process.env.DIST_DIR||'dist'});
  try {
    await page.goto(`http://127.0.0.1:${other.port}`);await page.waitForSelector('body[data-mode="home"]');
    assert.equal((await readProfile(page)).lifetimeXP,0,'same browser, different origin starts separately');
    await page.goto(f.origin);await page.waitForSelector('body[data-mode="home"]');
    assert.deepEqual(await readProfile(page),saved,'return to original origin retains genuine XP');
  } finally {await other.close();}
  await page.screenshot({path:`${artifacts}/tdm-ctf-origin.png`});f.clean();
  console.log('PASS genuine solo TDM elimination, CTF capture and cross-origin isolation');
} finally {await f.close();}

for(const failure of ['denied','corrupt','future','quota']) {
  const f=await persistentFixture({legacy,artifactDir:`${artifacts}/${failure}`});
  try {
    const page=f.page;await setupSolo(page);
    if(failure==='denied')await page.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw Error('test: denied storage');}}));
    if(failure==='corrupt'||failure==='future')await page.evaluate(failure=>{
      localStorage.removeItem('block-ops-progression-v1-backup');
      localStorage.setItem('block-ops-progression-v1',failure==='corrupt'?'{broken':JSON.stringify({schemaVersion:99,lifetimeXP:0}));
    },failure);
    if(failure==='quota')await page.addInitScript(()=>{
      const set=Storage.prototype.setItem;window.__denyXPWrites=true;
      Storage.prototype.setItem=function(key,value){if(window.__denyXPWrites&&key.startsWith('block-ops-progression'))throw new DOMException('test: quota','QuotaExceededError');return set.call(this,key,value);};
    });
    await page.reload();await page.waitForSelector('body[data-mode="home"]');
    // Denying all storage also prevents the pre-reload difficulty/loadout from
    // being read. Reapply the real UI setup to keep this a one-Easy-bot route.
    await setupSolo(page);
    const before=failure==='denied'?null:await page.evaluate(()=>localStorage.getItem('block-ops-progression-v1'));
    await page.locator('#home-solo').click();await fightSolo(page,1,{label:failure});
    await goHome(page);
    assert.match(await page.locator('#home-progression').textContent(),/10 lifetime XP/,'real kill remains usable in temporary profile');
    assert.match(await page.locator('#progression-save-status').textContent(),/not saved|preserved|Temporary/i);
    if(before!==null)assert.equal(await page.evaluate(()=>localStorage.getItem('block-ops-progression-v1')),before,'failed/protected save is not overwritten');
    if(failure==='quota'){
      await page.evaluate(()=>{window.__denyXPWrites=false;});
      await page.locator('#home-armory').click();await page.locator('#armory-home').click();
      assert.equal((await readProfile(page)).lifetimeXP,10,'retry commits exactly the pending ten XP');
      assert.match(await page.locator('#progression-save-status').textContent(),/Saved on this device/);
    }
    await page.screenshot({path:`${artifacts}/${failure}.png`});f.clean();
    console.log(`PASS genuine earning with ${failure} save storage (${legacy?'legacy':'modern'})`);
  } finally {await f.close();}
}

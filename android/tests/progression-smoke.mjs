import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { nativeProgressionFixture } from './helpers/progression-native.js';
import { setupSolo, fightSolo, goHome, readProfile, visibleZombie, dragAim } from '../../tests/helpers/progression-browser.js';

const artifactDir=process.env.ANDROID_TEST_ARTIFACTS || 'artifacts/xp-native';
await mkdir(artifactDir,{recursive:true});
const apk=process.env.ANDROID_APK_PATH;assert.ok(apk,'Explicit candidate APK is required');
const f=await nativeProgressionFixture({artifactDir});
try {
  let page=await f.attach();
  const beforeVersion=await f.version();
  const resume=process.env.ANDROID_RESUME_CODE11==='1';
  assert.deepEqual(beforeVersion,resume?{code:11,name:'0.9.0'}:{code:10,name:'0.8.0'},'Use code10 for migration, or explicitly resume real code11 earning');
  await setupSolo(page);await page.locator('[data-skin="shadow-ninja"]').click();
  if(!resume&&!await page.evaluate(()=>localStorage.getItem('block-ops-zombies-v1'))) {
    // The old disposable image may have no best yet. Earn one on actual v0.8,
    // through its UI and normal death, before testing preservation on upgrade.
    await page.locator('[data-map="neon-city"]').click();await page.locator('[data-mode-id="zombies"]').click();await page.locator('#home-solo').click();
    await dragAim(page,Math.PI/.0026);let attempts=0,frames=0;const deadline=Date.now()+90000;
    while(Number.parseInt(await page.locator('#timer').textContent())<1) {
      assert.ok(Date.now()<deadline,'Earn one genuine old-version zombie kill');
      assert.equal(await page.locator('body').getAttribute('data-mode'),'playing');
      const target=await visibleZombie(page);
      if(frames++%5===0){console.log('V06 ZOMBIE VISION',frames,target,'health',await page.locator('#health-count').textContent(),'ammo',await page.locator('#ammo-count').textContent());await page.screenshot({path:`${artifactDir}/legacy-zombie-aim-${frames}.png`});}
      if(target){const focal=target.height/(2*Math.tan(75*Math.PI/360));await dragAim(page,Math.atan((target.x-target.width/2)/focal)/.0026,Math.atan((target.y-target.height/2)/focal)/.0026);
        await page.keyboard.down('KeyF');await page.waitForTimeout(180);await page.keyboard.up('KeyF');
      }else{if(++attempts%5===0)await dragAim(page,140);await page.waitForTimeout(160);}
    }
    await page.waitForFunction(()=>document.body.dataset.mode==='results',null,{timeout:90000});
    assert.ok(Number(await page.locator('#result-deaths').textContent())>=1);
    await page.screenshot({path:`${artifactDir}/genuine-v06-zombie-record.png`});
    await goHome(page);await setupSolo(page);
  }
  const legacy=await page.evaluate(()=>({settings:localStorage.getItem('block-ops-v1'),zombies:localStorage.getItem('block-ops-zombies-v1')}));
  assert.ok(legacy.settings);assert.ok(legacy.zombies,'genuine pre-XP zombie records exist before migration');
  if(!resume){
    await writeFile(`${artifactDir}/before-upgrade.json`,JSON.stringify({beforeVersion,legacy},null,2));
    const beforeProfile=await readProfile(page);
    await f.install(apk);page=await f.attach();assert.deepEqual(await f.version(),{code:11,name:'0.9.0'});
    assert.deepEqual(await page.evaluate(()=>({settings:localStorage.getItem('block-ops-v1'),zombies:localStorage.getItem('block-ops-zombies-v1')})),legacy);
    assert.deepEqual(await readProfile(page),beforeProfile,'all earned XP/cosmetics survive10→11');
    await writeFile(`${artifactDir}/migration-passed.json`,JSON.stringify({from:beforeVersion,to:await f.version(),legacy},null,2));
    console.log('PASS actual code10→11 migration: earned XP/cosmetics, settings and genuine zombie best preserved.');
  }
  const initialXP=(await readProfile(page)).lifetimeXP;
  await page.locator('#home-solo').click();await fightSolo(page,15,{artifactDir,label:'native-win'});
  assert.equal((await readProfile(page)).lifetimeXP,initialXP+225);await goHome(page);
  await page.locator('[data-skin="crimson-ninja"]').click();
  await page.locator('#home-solo').click();await fightSolo(page,13,{artifactDir,label:'native-extra-earnings'});
  assert.equal((await readProfile(page)).lifetimeXP,initialXP+355);
  await page.locator('#loadout-button').click();await page.locator('[data-finish="crimson-red"]').click();
  await page.locator('#armory-home').click();await page.locator('#confirm-home').click();
  const earned=await readProfile(page);await page.screenshot({path:`${artifactDir}/earned-home.png`});
  page=await f.relaunch();assert.deepEqual(await readProfile(page),earned);
  assert.match(await page.locator('#character-preview').getAttribute('aria-label'),/Crimson Ninja.*Crimson Red/);
  await page.locator('#home-solo').click();const backgroundProfile=await readProfile(page);await f.background();
  assert.equal(await page.evaluate(()=>document.hidden),true,'real native background visibility');
  await f.foreground();await page.waitForSelector('body[data-mode="paused"]');
  assert.equal(backgroundProfile.lifetimeXP,earned.lifetimeXP);
  assert.deepEqual(await readProfile(page),backgroundProfile,'background does not grant completion XP');
  page=await f.relaunch();assert.deepEqual(await readProfile(page),backgroundProfile);
  await f.install(apk);page=await f.attach();assert.deepEqual(await readProfile(page),backgroundProfile,'signed code11 replacement retains earned profile');
  assert.deepEqual(await f.version(),{code:11,name:'0.9.0'});await page.screenshot({path:`${artifactDir}/retained-after-install-r.png`});
  await writeFile(`${artifactDir}/native-progression-evidence.json`,JSON.stringify({migration:resume?'not performed: explicit candidate11 resume':'10→11 XP/cosmetics/settings/zombie records',replacement:'11→11 same-signed install -r',initialXP,earnedXP:355,profile:earned,version:await f.version()},null,2));
  f.clean();console.log('PASS native XP: 355 genuine new XP, Crimson Ninja/Crimson Red; force-stop/relaunch, real background/foreground and signed update-install retained.');
} finally {await f.close();}

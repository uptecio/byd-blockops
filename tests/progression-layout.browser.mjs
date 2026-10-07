import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { persistentFixture } from './helpers/progression-browser.js';

const artifacts=process.env.ARTIFACT_DIR || 'artifacts/xp-progression-layout';
await mkdir(artifacts,{recursive:true});
// Synthetic max-rank profiles are confined to catalogue/layout checks. The
// separate progression.browser gate earns every XP point through real play.
for(const legacy of [false,true])for(const viewport of [{width:854,height:480},{width:1200,height:700},{width:1280,height:720}]) {
  const label=`${legacy?'legacy':'modern'}-${viewport.width}`,f=await persistentFixture({legacy,viewport,artifactDir:`${artifacts}/layout-${label}`});
  try {
    const page=f.page;
    await page.evaluate(()=>localStorage.setItem('block-ops-progression-v1',JSON.stringify({schemaVersion:1,lifetimeXP:2147483647,skinId:'ranger',finishId:'standard',receipts:[]})));
    await page.reload();await page.waitForSelector('body[data-mode="home"]');
    assert.equal(await page.locator('[data-skin]').count(),16);assert.equal(await page.locator('[data-skin]:enabled').count(),16);
    assert.match(await page.locator('#home-progression').textContent(),/Level 17.*2,147,483,647.*All rewards unlocked/);
    for(const scale of [1,1.3]) {
      await page.locator('#home-settings').click();await page.locator('#control-size').fill(String(scale));await page.locator('#settings-done').click();
      await page.locator('[data-skin="void-guard"]').click();
      assert.match(await page.locator('#character-preview').getAttribute('aria-label'),/Void Guard/);
      for(const id of ['home-solo','home-armory','home-online','character-preview','home-progression']) {
        const box=await page.locator(`#${id}`).boundingBox();assert.ok(box&&box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width&&box.y+box.height<=viewport.height,`${id} fits ${label}`);
      }
      await page.screenshot({path:`${artifacts}/${label}-${scale}-home.png`});
      await page.locator('#home-armory').click();
      assert.equal(await page.locator('[data-finish]').count(),9);
      for(const finish of ['crimson-red','ice-blue','forest-camo','violet','orange','arctic-white','stealth-black','gold','standard']) {
        const control=page.locator(`[data-finish="${finish}"]`);await control.click();
        const bounds=await control.boundingBox();assert.ok(bounds.height>=44&&bounds.width>=44);
        assert.equal(await control.getAttribute('aria-pressed'),'true');
      }
      await page.locator('#armory-skin').selectOption('crimson-ninja');
      await page.locator('[data-finish="gold"]').click();
      assert.match(await page.locator('#weapon-preview').getAttribute('aria-label'),/Gold/);
      await page.screenshot({path:`${artifacts}/${label}-${scale}-armory.png`});
      await page.locator('#play-button').click();await page.waitForSelector('body[data-mode="playing"]');
      // Exercise layout of the shipped non-intercepting notice region; no XP credit is injected.
      await page.evaluate(()=>{document.getElementById('progression-toast').textContent='+1,000 XP · Unlocked: Crimson Ninja, Crimson Red + 2 more';});
      assert.equal(await page.locator('#progression-toast').evaluate(node=>getComputedStyle(node).pointerEvents),'none');
      const toast=await page.locator('#progression-toast').boundingBox();assert.ok(toast.y+toast.height<viewport.height/2-10,'XP notification stays above crosshair');
      for(const id of ['joystick','fire-button','jump-button','reload-button','loot-inventory']) {
        const visible=await page.locator(`#${id}`).evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});
        assert.equal(visible,true,`${id} receives input ${label}/${scale}`);
      }
      await page.locator('#home-button').click();await page.locator('#confirm-home').click();
    }
    await page.evaluate(()=>{const key='block-ops-progression-v1',raw=localStorage.getItem(key);localStorage.setItem(key+'-backup',raw);localStorage.setItem(key,JSON.stringify({...JSON.parse(raw),schemaVersion:99}));});
    await page.reload();await page.waitForSelector('body[data-mode="home"]');
    assert.match(await page.locator('#progression-save-status').textContent(),/newer save version is preserved/);
    await page.screenshot({path:`${artifacts}/${label}-protected-save.png`});f.clean();
    console.log(`PASS XP layout ${label}: max rank, 16 skins, 9 finishes, both control scales and protected-save warning`);
  } finally {await f.close();}
}

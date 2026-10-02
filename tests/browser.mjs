import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const server = spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: '4178' }, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 810 }, hasTouch: true });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:4178');
  await page.waitForSelector('#play-button', { timeout: 5000 });
  assert.equal(await page.locator('#selected-name').textContent(), 'M4A1');
  for (const id of ['assault', 'smg', 'shotgun', 'sniper', 'marksman', 'lmg', 'sidearm']) {
    await page.locator(`[data-class="${id}"]`).click();
    assert.equal(await page.locator('.weapon-card').count(), 4, `${id} offers four guns`);
  }
  await page.locator('[data-class="sniper"]').click();
  await page.locator('[data-weapon="awp"]').click();
  assert.equal(await page.locator('#selected-name').textContent(), 'AWP');
  await page.reload();
  await page.waitForSelector('#play-button');
  assert.equal(await page.locator('#selected-name').textContent(), 'AWP', 'loadout persists');
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/armory.png' });
  await page.locator('[data-class="assault"]').click();
  await page.locator('[data-weapon="m4a1"]').click();
  await page.locator('#play-button').click();
  await page.waitForSelector('body[data-mode="playing"]');
  assert.match(await page.locator('#hud-weapon').textContent(), /M4A1/);
  await page.keyboard.press('f');
  await page.waitForTimeout(300);
  assert.ok(Number(await page.locator('#ammo-count').textContent()) < 30, 'firing consumes ammo');
  await page.keyboard.press('r');
  await page.waitForTimeout(2700);
  assert.equal(await page.locator('#ammo-count').textContent(), '30', 'reload refills magazine');
  await page.locator('#pause-button').click();
  assert.equal(await page.locator('body').getAttribute('data-mode'), 'paused');
  const time = await page.locator('#timer').textContent();
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('#timer').textContent(), time, 'menus freeze the round');
  await page.locator('#resume-button').click();
  await page.screenshot({ path: 'artifacts/gameplay.png' });
  await page.locator('#loadout-button').click();
  await page.locator('[data-class="shotgun"]').click();
  await page.locator('[data-weapon="m870"]').click();
  await page.locator('#play-button').click();
  assert.match(await page.locator('#hud-weapon').textContent(), /M870/);
  await page.setViewportSize({ width: 960, height: 540 });
  await page.locator('#loadout-button').click();
  assert.equal(await page.locator('#play-button').isVisible(), true);
  const deployBounds = await page.locator('#play-button').boundingBox();
  assert.ok(deployBounds.y + deployBounds.height <= 540, 'deploy stays within short landscape screen');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no horizontal overflow');
  await page.screenshot({ path: 'artifacts/compact-armory.png' });
  assert.deepEqual(errors, [], 'no browser exceptions');
  console.log('Browser acceptance passed: 7 classes, persistence, firing, reload, pause, weapon swap, compact layout.');
} finally {
  await browser.close();
  server.kill();
}

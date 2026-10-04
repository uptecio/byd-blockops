import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startServer } from '../server/server.mjs';
import { emulateLegacyWebView } from './helpers/legacy-webview.js';

// Catches the photographed failure: Home works, but the first Solo HUD/bot
// update kills rendering and legacy CSS collapses all the gameplay controls.
const artifacts = process.env.BYD_ARTIFACTS || 'artifacts/byd-compatibility';
const server = await startServer({ port: 0, distDir: process.env.DIST_DIR || 'dist' });
const base = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, hasTouch: true });
  await emulateLegacyWebView(context);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.locator('[data-map="neon-city"]').click();
  await page.locator('[data-mode-id="ctf"]').click();
  await page.locator('[data-skin="shadow-ninja"]').click();
  await page.locator('#home-solo').tap();
  await page.waitForSelector('body[data-mode="playing"]');
  await page.waitForTimeout(400);
  assert.deepEqual(errors, [], 'Solo startup must not throw with older WebView capabilities');
  await page.waitForFunction(() => document.getElementById('timer').textContent !== '03:00', null, { timeout: 10000 });
  assert.match(await page.locator('#hud-mode').textContent(), /CAPTURE THE FLAG/);
  assert.equal(await page.locator('#fatal-screen').isHidden(), true);
  const state = await page.evaluate(() => {
    const box = id => { const r = document.getElementById(id).getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; };
    return { probe:window.__legacyProbe, hud:box('game-ui'), fire:box('fire-button'), move:box('joystick') };
  });
  assert.ok(state.probe.arenaDraws > 0, 'actual WebGL1 arena draw calls must occur');
  assert.deepEqual(state.probe.lost, []);
  assert.equal(state.hud.width, 1280); assert.equal(state.hud.height, 720);
  for (const control of [state.fire, state.move]) {
    assert.ok(control.width >= 44 && control.height >= 44);
    assert.ok(control.x >= 0 && control.y >= 0 && control.x + control.width <= 1280 && control.y + control.height <= 720);
  }
  const ammo = Number(await page.locator('#ammo-count').textContent());
  await page.locator('#fire-button').tap();
  await page.waitForFunction(ammo => Number(document.getElementById('ammo-count').textContent) < ammo, ammo);
  await mkdir(artifacts, { recursive:true });
  await page.screenshot({ path:`${artifacts}/legacy-neon-ctf.png` });
  await page.locator('#pause-button').tap();
  await page.waitForSelector('body[data-mode="paused"]');
  const pausedTime = await page.locator('#timer').textContent();
  await page.waitForTimeout(1100);
  assert.equal(await page.locator('#timer').textContent(), pausedTime);
  await page.locator('#pause-home').tap(); await page.locator('#confirm-home').tap();
  await page.waitForSelector('body[data-mode="home"]');
  assert.deepEqual(errors, []);
  console.log('Legacy WebView startup passed: exact photographed selection, WebGL1 draws, live clock, full-size HUD, real touch fire/pause/Home.');
} finally {
  await browser.close();
  await server.close();
}

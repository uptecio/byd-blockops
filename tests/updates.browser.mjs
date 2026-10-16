import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer } from '../server/server.mjs';

const server = await startServer({ port: 0, distDir: process.env.DIST_DIR || 'dist' });
const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (const native of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
    const errors = [], failures = [], github = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/github/.test(request.url())) github.push(request.url()); });
    page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) failures.push(response.url()); });
    if (native) await page.addInitScript(() => {
      window.updateCalls = [];
      window.BlockOpsUpdates = { homeState: value => window.updateCalls.push(['homeState', value]), check: () => window.updateCalls.push(['check']), open: () => window.updateCalls.push(['open']) };
    });
    await page.goto(`http://127.0.0.1:${server.port}`);
    await page.locator('#home-solo').waitFor();
    assert.equal(await page.locator('#home-updates').count(), 1, 'hidden-by-default updater controls exist');
    const visible = () => page.locator('#home-updates').isVisible();
    assert.equal(await visible(), native);
    if (native) {
      await page.evaluate(() => window.receiveBlockOpsUpdate({ revision: 1, phase: 'available', installedVersion: '0.10.0', availableVersion: '0.11.0', totalBytes: 200, downloadedBytes: 0, message: '<img src=x onerror=alert(1)> "\\\u2028\u2029', dismissed: false }));
      assert.equal(await page.locator('#update-status img').count(), 0);
      assert.match(await page.locator('#update-status').textContent(), /<img/);
      await page.locator('#update-open').click(); await page.locator('#update-check').click();
      assert.deepEqual((await page.evaluate(() => window.updateCalls)).slice(-2), [['open'], ['check']]);
      for (const [revision, phase, dismissed] of [[2, 'checking', false], [3, 'available', true], [4, 'error', false]]) {
        await page.evaluate(({ revision, phase, dismissed }) => window.receiveBlockOpsUpdate({ revision, phase, dismissed, installedVersion: '0.10.0', availableVersion: '0.11.0', totalBytes: 200, downloadedBytes: 0, message: phase }), { revision, phase, dismissed });
        assert.equal(await page.locator('#update-check').isDisabled(), phase === 'checking');
        assert.equal(await page.locator('#update-open').isVisible(), !dismissed);
      }
    }
    await page.locator('#home-settings').click(); assert.equal(await visible(), false);
    if (native) assert.deepEqual((await page.evaluate(() => window.updateCalls)).at(-1), ['homeState', 'hidden']);
    await page.locator('#close-settings').click(); assert.equal(await visible(), native);
    for (let tap = 0; tap < 5; tap++) await page.locator('#home-secret-logo').click();
    await page.locator('#solo-powers-screen').waitFor(); assert.equal(await visible(), false);
    await page.locator('#solo-powers-cancel').click(); assert.equal(await visible(), native);
    await page.locator('#home-online').click(); assert.equal(await visible(), false);
    await page.locator('#online-back').click(); assert.equal(await visible(), native);
    await page.locator('#home-solo').click(); assert.equal(await visible(), false);
    await page.locator('#pause-button').click(); assert.equal(await visible(), false);
    await page.locator('#pause-home').click(); await page.locator('#confirm-home').click(); assert.equal(await visible(), native);
    await page.locator('#home-range').click(); assert.equal(await visible(), false);
    assert.deepEqual(errors, []); assert.deepEqual(failures, []); assert.deepEqual(github, []);
    await page.close(); console.log(`PASS updates browser ${native ? 'mock bridge UI only' : 'ordinary browser'}: state, modes, literal text, no GitHub requests`);
  }
} finally { await browser.close(); await server.close(); }

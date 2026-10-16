import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer } from '../server/server.mjs';
import { emulateLegacyWebView } from './helpers/legacy-webview.js';

const server = await startServer({ port: 0, distDir: process.env.DIST_DIR || 'dist' });
const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (const legacy of [false, true]) for (const [width, height] of [[1440, 900], [1200, 700], [960, 540], [854, 480], [915, 412], [390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    if (legacy) await emulateLegacyWebView(context);
    await context.addInitScript(() => { window.BlockOpsUpdates = { homeState() {}, check() {}, open() {} }; });
    const page = await context.newPage(), errors = [], failures = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) failures.push(response.url()); });
    await page.goto(`http://127.0.0.1:${server.port}`);
    assert.equal(await page.locator('#home-updates').count(), 1, 'updater controls exist');
    await page.waitForFunction(() => typeof window.receiveBlockOpsUpdate === 'function');
    await page.evaluate(() => window.receiveBlockOpsUpdate({ revision: 1, phase: 'available', installedVersion: '0.10.0', availableVersion: '0.11.0', totalBytes: 200, downloadedBytes: 0, message: 'A new version is available.', dismissed: false }));
    for (const selector of ['#update-check', '#update-open']) {
      const bounds = await page.locator(selector).boundingBox();
      assert.ok(bounds && bounds.width >= 44 && bounds.height >= 44, `${selector} touch target ${width} legacy=${legacy}`);
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height, `${selector} fits ${width} legacy=${legacy}`);
      for (const other of ['#home-solo', '#home-online', '#home-range', '#home-settings', '#home-armory']) {
        const b = await page.locator(other).boundingBox();
        if (width > 650) assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= width && b.y + b.height <= height, `${other} remains in view ${width}`);
        assert.ok(bounds.x + bounds.width <= b.x || b.x + b.width <= bounds.x || bounds.y + bounds.height <= b.y || b.y + b.height <= bounds.y, `${selector} overlaps ${other}`);
      }
      assert.ok(await page.locator(selector).evaluate(el => { const b = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); }));
    }
    if (height === 412) {
      await page.locator('[data-map="space-station"]').click();
      assert.equal(await page.locator('[data-map="space-station"]').getAttribute('aria-pressed'), 'true', 'all maps stay reachable in the compact scrolling catalogue');
      const solo = await page.locator('#home-solo').boundingBox(), footer = await page.locator('#home-screen .app-footer').boundingBox();
      assert.ok(solo.y + solo.height <= footer.y, 'compact play controls do not overlap the footer');
    }
    assert.deepEqual(errors, []); assert.deepEqual(failures, []);
    await context.close(); console.log(`PASS updates layout ${width}x${height} legacy=${legacy} (mock UI only)`);
  }
} finally { await browser.close(); await server.close(); }

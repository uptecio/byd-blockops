import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { startServer } from '../server/server.mjs';

// These regressions catch missing legacy CSS fallbacks that collapse the HUD,
// remove the joystick's touch area, or put navigation behind another panel.
// Strip unsupported declarations from the HTTP response only; shipped files
// and the real game, input handlers, and rendering loop remain unchanged.
const distDir = process.env.DIST_DIR || 'dist';
const stylesheet = await readFile(process.env.LAYOUT_CSS_FILE || resolve(distDir, 'styles.css'), 'utf8');
const profiles = [
  { name: 'legacy layout', inset: false, math: false },
  { name: 'without inset', inset: false, math: true },
  { name: 'modern layout', inset: true, math: true },
];
const viewports = [{ width: 1200, height: 700 }, { width: 1280, height: 720 }, { width: 854, height: 480 }];
const cssFor = profile => stylesheet.replace(/(^|[;{])\s*([-\w]+)\s*:\s*([^;{}]+)(?=;|})/g, (declaration, boundary, property, value) => {
  const unsupported = (!profile.inset && property === 'inset') || (!profile.math && /\b(?:min|max|clamp)\s*\(/.test(value));
  return unsupported ? boundary : declaration;
});

async function fullScreen(page, selector, viewport, label) {
  const bounds = await page.locator(selector).boundingBox();
  assert.ok(bounds, `${label}: ${selector} is visible`);
  for (const [key, expected] of Object.entries({ x: 0, y: 0, width: viewport.width, height: viewport.height })) {
    assert.ok(Math.abs(bounds[key] - expected) <= 1, `${label}: ${selector} ${key} expected ${expected}, got ${bounds[key]}`);
  }
}

async function touchTarget(page, selector, viewport, label) {
  const bounds = await page.locator(selector).boundingBox();
  assert.ok(bounds, `${label}: ${selector} is visible`);
  assert.ok(bounds.width >= 44 && bounds.height >= 44, `${label}: ${selector} retains a 44px touch target, got ${JSON.stringify(bounds)}`);
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1,
    `${label}: ${selector} fits the viewport, got ${JSON.stringify(bounds)}`);
  assert.ok(await page.locator(selector).evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
  }), `${label}: ${selector} receives input at its center`);
  return bounds;
}

async function separatedHud(page, label) {
  const selectors = ['.health-panel', '.score-panel', '.hud-actions'];
  const bounds = await Promise.all(selectors.map(selector => page.locator(selector).boundingBox()));
  for (let first = 0; first < bounds.length; first++) for (let second = first + 1; second < bounds.length; second++) {
    const a = bounds[first], b = bounds[second];
    assert.ok(a && b, `${label}: HUD panels are visible`);
    assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y,
      `${label}: ${selectors[first]} and ${selectors[second]} do not overlap`);
  }
}

const server = await startServer({ port: 0, distDir });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const profile of profiles) for (const viewport of viewports) {
    const label = `${profile.name} ${viewport.width}×${viewport.height}`;
    const page = await browser.newPage({ viewport, hasTouch: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/styles.css', route => route.fulfill({ status: 200, contentType: 'text/css', body: cssFor(profile) }));
    try {
      await page.goto(`http://127.0.0.1:${server.port}`);
      await page.waitForSelector('body[data-mode="home"]');
      await page.locator('[data-mode-id="ctf"]').click();
      await page.locator('#home-solo').click();
      await page.waitForSelector('body[data-mode="playing"]');
      for (const selector of ['#arena', '#game-ui', '#aim-zone', '#damage-flash']) await fullScreen(page, selector, viewport, label);
      await separatedHud(page, label);
      for (const selector of ['#home-button', '#loadout-button', '#pause-button', '#joystick', '#fire-button', '#zoom-button', '#jump-button', '#reload-button', '#knife-button', '#grenade-type-button', '#throw-button']) {
        await touchTarget(page, selector, viewport, label);
      }

      const joystick = await page.locator('#joystick').boundingBox();
      await page.mouse.move(joystick.x + joystick.width / 2, joystick.y + joystick.height / 2);
      await page.mouse.down();
      await page.mouse.move(joystick.x + joystick.width / 2 + 20, joystick.y + joystick.height / 2);
      assert.notEqual(await page.locator('#joystick-knob').evaluate(element => element.style.transform), '', `${label}: joystick receives its drag`);
      await page.mouse.up();
      const ammo = Number(await page.locator('#ammo-count').textContent());
      await page.locator('#fire-button').click();
      await page.waitForFunction(initial => Number(document.getElementById('ammo-count').textContent) < initial, ammo);

      await page.locator('#pause-button').click();
      await fullScreen(page, '#pause-screen', viewport, label);
      await touchTarget(page, '#resume-button', viewport, label);
      await page.locator('#resume-button').click();
      await page.waitForSelector('body[data-mode="playing"]');

      await page.locator('#loadout-button').click();
      await fullScreen(page, '#armory', viewport, label);
      await page.locator('[data-class="sniper"]').click();
      await page.locator('[data-weapon="awp"]').click();
      await page.locator('#play-button').click();
      await page.waitForSelector('body[data-mode="playing"]');
      await page.locator('#zoom-button').click();
      await page.locator('#scope-overlay').waitFor({ state: 'visible' });
      await fullScreen(page, '#scope-overlay', viewport, label);

      await page.locator('#home-button').click();
      await fullScreen(page, '#confirm-home-screen', viewport, label);
      await touchTarget(page, '#cancel-home', viewport, label);
      await page.locator('#cancel-home').click();
      await page.waitForSelector('body[data-mode="playing"]');
      await page.locator('#home-button').click();
      await touchTarget(page, '#confirm-home', viewport, label);
      await page.locator('#confirm-home').click();
      await page.waitForSelector('body[data-mode="home"]');
      await fullScreen(page, '#home-screen', viewport, label);
      assert.deepEqual(errors, [], `${label}: no browser errors`);
      console.log(`PASS ${label}: full-screen surfaces, HUD separation, touch controls, and navigation`);
    } finally {
      await page.close();
    }
  }
} finally {
  if (browser) await browser.close();
  await server.close();
}

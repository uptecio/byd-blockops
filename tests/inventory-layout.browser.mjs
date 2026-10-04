import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// A layout fixture: real shipped HTML/CSS with representative loot injected.
// No game bundle runs here; gameplay and aim interception are tested separately.
// Catches an unbounded/wrapping inventory, missing legacy geometry, HUD overlap,
// clipped labels, and slots covered by the aim surface or other controls.
const sourceDir = process.env.DIST_DIR;
const html = await readFile(resolve(sourceDir || '.', 'index.html'), 'utf8');
const stylesheet = await readFile(process.env.LAYOUT_CSS_FILE || resolve(sourceDir || 'src', 'styles.css'), 'utf8');
const runDir = resolve('artifacts/inventory-layout', new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid);
await mkdir(runDir, { recursive: true });
const profiles = [
  { name: 'modern', legacy: false, safe: false },
  { name: 'legacy', legacy: true, safe: false },
  { name: 'safe-area', legacy: false, safe: true },
  { name: 'legacy-safe-area', legacy: true, safe: true },
];
const viewports = [{ width: 1280, height: 720 }, { width: 1200, height: 700 }, { width: 854, height: 480 }];
const cases = profiles.flatMap(profile => viewports.flatMap(viewport => [1, 1.3].map(scale => ({ profile, viewport, scale }))));
const selectedCases = process.env.LAYOUT_FOCUSED === '1' ? cases.slice(0, 1) : cases;
const cssFor = profile => {
  let css = stylesheet;
  if (profile.safe) css = css.replace(/env\(safe-area-inset-(top|left|right|bottom)(?:\s*,\s*[^)]+)?\)/g,
    (_, edge) => ({ top: '18px', left: '24px', right: '24px', bottom: '12px' })[edge]);
  if (profile.legacy) css = css.replace(/(^|[;{])\s*([-\w]+)\s*:\s*([^;{}]+)(?=;|})/g,
    (declaration, boundary, property, value) => property === 'inset' || /\b(?:min|max|clamp)\s*\(/.test(value) ? boundary : declaration);
  return css;
};
let activeCss = stylesheet;
const server = createServer((request, response) => {
  if (request.url === '/styles.css') {
    response.writeHead(200, { 'Content-Type': 'text/css' });
    response.end(activeCss);
  } else if (request.url === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ''));
  } else {
    response.writeHead(404);
    response.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const separated = (a, b) => a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1 || a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1;
async function bounds(page, selector, label) {
  assert.equal(await page.locator(selector).count(), 1, `${label}: ${selector} exists in the shipped HUD`);
  const box = await page.locator(selector).boundingBox();
  assert.ok(box, `${label}: ${selector} has visible layout`);
  return box;
}
async function clickable(page, selector, label) {
  const box = await bounds(page, selector, label);
  assert.ok(box.width >= 44 && box.height >= 44, `${label}: ${selector} is at least 44px, got ${JSON.stringify(box)}`);
  assert.ok(await page.locator(selector).evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  }), `${label}: ${selector} receives its center hit`);
}
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const { profile, viewport, scale } of selectedCases) {
    const label = `${profile.name}-${viewport.width}x${viewport.height}-scale-${scale}`;
    activeCss = cssFor(profile);
    const page = await browser.newPage({ viewport, hasTouch: true });
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.evaluate(scale => {
        document.querySelectorAll('.screen,.modal-screen').forEach(element => { element.hidden = true; });
        document.body.dataset.mode = 'playing';
        document.getElementById('game-ui').hidden = false;
        document.getElementById('game-ui').style.setProperty('--control-scale', scale);
        const objective = document.getElementById('objective-status');
        objective.hidden = false;
        objective.textContent = 'RED FLAG: HOME · BLUE FLAG: CARRIED';
        const scoreboard = document.getElementById('online-scoreboard');
        scoreboard.hidden = false;
        scoreboard.innerHTML = Array.from({ length: 8 }, (_, index) => `<div><span>Player ${index + 1}</span><b>${8 - index}</b></div>`).join('');
        for (const id of ['knife-button', 'throw-button']) document.getElementById(id).disabled = false;
        const slots = document.getElementById('inventory-slots');
        if (!slots) return;
        const items = [
          ['gun', 'gun:m4a1', 'M4A1', '30 / 470', 'HELD'],
          ['knife', 'knife', 'Knife', '', ''],
          ['grenade', 'grenade:frag', 'Explosive', '2 / 3', 'THROW'],
          ['grenade', 'grenade:smoke', 'Smoke', '1 / 3', ''],
          ['grenade', 'grenade:flash', 'Flashbang', '3 / 3', ''],
          ['gun', 'gun:deagle', 'Desert Eagle', '7 / 140', ''],
          ['gun', 'gun:remington', 'Remington 870', '8 / 80', ''],
        ];
        while (items.length < 32) items.push(['gun', `gun:fixture-${items.length}`, `Rifle ${items.length + 1}`, '30 / 470', '']);
        slots.innerHTML = items.map(([kind, key, name, count, state], index) => `<button type="button" class="inventory-slot" data-inventory-kind="${kind}" data-inventory-key="${key}" aria-pressed="${state !== ''}"><span class="inventory-number">${index + 1}</span><span class="inventory-name">${name}</span><span class="inventory-count">${count}</span><span class="inventory-status">${state}</span></button>`).join('');
        slots.addEventListener('click', event => {
          const slot = event.target.closest('.inventory-slot');
          if (slot) window.__layoutClickedKey = slot.dataset.inventoryKey;
        });
      }, scale);
      const inventory = await bounds(page, '#loot-inventory', label);
      const health = await bounds(page, '.health-panel', label);
      assert.ok(inventory.x >= 0 && inventory.x <= 60 && inventory.y >= health.y + health.height,
        `${label}: loot sits upper-left below health, got ${JSON.stringify({ inventory, health })}`);
      assert.ok(inventory.width >= 260 && inventory.width <= 400 && inventory.x + inventory.width < viewport.width / 2,
        `${label}: inventory is bounded to the left side, got ${JSON.stringify(inventory)}`);
      assert.ok(inventory.height <= 104 && inventory.y + inventory.height < viewport.height / 2,
        `${label}: inventory stays above the aim center`);
      for (const selector of ['.health-panel', '.score-panel', '.hud-actions', '#objective-status', '#online-scoreboard', '#reticle', '#joystick', '.combat-controls', '.equipment-controls', '.ammo-panel']) {
        assert.ok(separated(inventory, await bounds(page, selector, label)), `${label}: loot does not overlap ${selector}`);
      }
      const scoreboard = await bounds(page, '#online-scoreboard', label);
      for (const selector of ['.health-panel', '.score-panel', '.hud-actions', '.equipment-controls', '.combat-controls', '#objective-status', '#reticle', '#joystick', '.ammo-panel']) {
        assert.ok(separated(scoreboard, await bounds(page, selector, label)), `${label}: leaderboard does not overlap ${selector}`);
      }
      assert.ok(await page.locator('#online-scoreboard').evaluate(element => element.scrollHeight <= element.clientHeight + 1),
        `${label}: all eight leaderboard rows are visible without inaccessible native scrolling`);
      assert.equal(await page.locator('.inventory-slot').count(), 32);
      const metrics = await page.locator('#inventory-slots').evaluate(element => {
        const children = Array.from(element.children);
        return {
          clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
          clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
          rowTops: children.map(child => child.getBoundingClientRect().y),
          namesFit: children.every(child => {
            const name = child.querySelector('.inventory-name');
            return name.scrollWidth <= name.clientWidth && parseFloat(getComputedStyle(name).fontSize) >= 12;
          }),
        };
      });
      assert.ok(metrics.scrollWidth > metrics.clientWidth * 4, `${label}: 32 entries overflow horizontally`);
      assert.ok(metrics.scrollHeight <= metrics.clientHeight + 1 && metrics.rowTops.every(top => Math.abs(top - metrics.rowTops[0]) < 1), `${label}: loot stays in a single row`);
      assert.ok(metrics.namesFit, `${label}: loot names remain legible and unclipped`);
      for (const key of ['gun:m4a1', 'knife', 'grenade:frag']) {
        const selector = `[data-inventory-key="${key}"]`;
        await clickable(page, selector, label);
        await page.locator(selector).click();
        assert.equal(await page.evaluate(() => window.__layoutClickedKey), key, `${label}: ${key} receives a real click`);
      }
      assert.deepEqual(await page.locator('.inventory-number').allTextContents(), Array.from({ length: 32 }, (_, index) => String(index + 1)), `${label}: every slot has a visible number`);
      await page.screenshot({ path: resolve(runDir, `${label}.png`) });
      await page.locator('#inventory-slots').evaluate(element => { element.scrollLeft = element.scrollWidth; });
      const last = '.inventory-slot:last-child';
      await clickable(page, last, label);
      const lastBox = await bounds(page, last, label);
      const rowBox = await bounds(page, '#inventory-slots', label);
      assert.ok(lastBox.x >= rowBox.x && lastBox.x + lastBox.width <= rowBox.x + rowBox.width + 1, `${label}: sideways scrolling fully reveals the last item`);
      await page.locator(last).click();
      assert.equal(await page.evaluate(() => window.__layoutClickedKey), 'gun:fixture-31', `${label}: the last item is selectable after scrolling`);
      console.log(`PASS ${label}: bounded loot row, 32 entries, legible labels, clickable targets, separated HUD`);
    } catch (error) {
      await page.screenshot({ path: resolve(runDir, `${label}-failure.png`) });
      throw error;
    } finally {
      await page.close();
    }
  }
  console.log(`Inventory layout evidence: ${runDir}`);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}

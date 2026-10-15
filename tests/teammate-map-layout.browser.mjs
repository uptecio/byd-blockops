import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// Catches maps covering controls/loot/leaderboards, legacy WebView geometry
// disappearing, and a large map pushing its close control out of view.
const html = await readFile(resolve('index.html'), 'utf8');
const stylesheet = await readFile(resolve('src/styles.css'), 'utf8');
const runDir = resolve('artifacts/teammate-map-layout', `${Date.now()}-${process.pid}`);
await mkdir(runDir, { recursive: true });
const profiles = [
  { name: 'modern', legacy: false, safe: false },
  { name: 'legacy', legacy: true, safe: false },
  { name: 'safe-area', legacy: false, safe: true },
  { name: 'legacy-safe-area', legacy: true, safe: true },
];
const viewports = [{ width: 1280, height: 720 }, { width: 1200, height: 700 }, { width: 854, height: 480 }, { width: 651, height: 480 }, { width: 390, height: 844 }];
const cases = profiles.flatMap(profile => viewports.flatMap(viewport => [1, 1.3].map(scale => ({ profile, viewport, scale }))));
let activeCss;
const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': request.url === '/styles.css' ? 'text/css' : 'text/html' });
  response.end(request.url === '/styles.css' ? activeCss : html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ''));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const separated = (a, b) => a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1 || a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1;
const bounds = async (page, selector) => {
  const box = await page.locator(selector).boundingBox();
  assert.ok(box, `${selector} has visible layout`);
  return box;
};
const inViewport = (box, viewport) => box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1;
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const { profile, viewport, scale } of process.env.LAYOUT_FOCUSED === '1' ? cases.slice(0, 1) : cases) {
    const label = `${profile.name}-${viewport.width}x${viewport.height}-${scale}`;
    activeCss = stylesheet;
    if (profile.safe) activeCss = activeCss.replace(/env\(safe-area-inset-(top|left|right|bottom)(?:\s*,\s*[^)]+)?\)/g, (_, edge) => ({ top: '18px', left: '24px', right: '24px', bottom: '12px' })[edge]);
    if (profile.legacy) activeCss = activeCss.replace(/(^|[;{])\s*([-\w]+)\s*:\s*([^;{}]+)(?=;|})/g, (declaration, boundary, property, value) => property === 'inset' || /\b(?:min|max|clamp)\s*\(/.test(value) ? boundary : declaration);
    const page = await browser.newPage({ viewport, hasTouch: true });
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.evaluate(scale => {
        document.querySelectorAll('.screen,.modal-screen').forEach(element => { element.hidden = true; });
        const ui = document.getElementById('game-ui');
        ui.hidden = false;
        ui.dataset.teamMap = 'true';
        ui.style.setProperty('--control-scale', scale);
        document.getElementById('teammate-map-button').hidden = false;
        document.getElementById('teammate-map-title').textContent = 'Cargo Yard';
        document.getElementById('teammate-map-notice').textContent = 'ONLINE LIVE · You can still be attacked.';
        document.querySelector('.score-panel').classList.add('team-score');
        document.getElementById('kills').textContent = 'RED 99 · BLUE 99';
        document.querySelector('.score-target').textContent = ' / 3 CAPTURES';
        document.getElementById('hud-mode').textContent = 'ONLINE / CAPTURE THE FLAG / RED';
        const objective = document.getElementById('objective-status');
        objective.hidden = false;
        objective.textContent = 'RED FLAG: HOME · BLUE FLAG: CARRIED';
        const scoreboard = document.getElementById('online-scoreboard');
        scoreboard.hidden = false;
        scoreboard.innerHTML = Array.from({ length: 8 }, (_, index) => `<div><span>Player ${index + 1}</span><b>${8 - index}</b></div>`).join('');
        document.getElementById('inventory-slots').innerHTML = '<button class="inventory-slot"><span class="inventory-name">M4A1</span></button><button class="inventory-slot"><span class="inventory-name">Knife</span></button>';
        for (const id of ['knife-button', 'throw-button']) document.getElementById(id).disabled = false;
      }, scale);
      const map = await bounds(page, '#teammate-map-button');
      const canvas = await bounds(page, '#teammate-minimap');
      const actions = await bounds(page, '.hud-actions');
      assert.ok(inViewport(map, viewport), `${label}: minimap fits viewport: ${JSON.stringify(map)}`);
      assert.ok(map.x + map.width > viewport.width * .8 && map.y >= actions.y + actions.height, `${label}: minimap is top-right below HUD actions`);
      assert.ok(Math.abs(canvas.width - canvas.height) < 1 && canvas.width >= 80, `${label}: minimap is a legible square`);
      for (const selector of ['.health-panel', '.score-panel', '.hud-actions', '#loot-inventory', '#objective-status', '#online-scoreboard', '#reticle', '#joystick', '.combat-controls', '.equipment-controls', '.ammo-panel']) {
        assert.ok(separated(map, await bounds(page, selector)), `${label}: map does not overlap ${selector}`);
      }
      const scoreboard = await bounds(page, '#online-scoreboard');
      assert.ok(inViewport(scoreboard, viewport), `${label}: leaderboard fits viewport`);
      for (const selector of ['#loot-inventory', '.health-panel', '.score-panel', '.hud-actions', '.equipment-controls', '.combat-controls', '#objective-status', '#reticle', '#joystick', '.ammo-panel']) {
        assert.ok(separated(scoreboard, await bounds(page, selector)), `${label}: leaderboard does not overlap ${selector}`);
      }
      assert.ok(await page.locator('#online-scoreboard').evaluate(element => element.scrollHeight <= element.clientHeight + 1), `${label}: eight leaderboard rows remain visible`);
      const loot = await bounds(page, '#loot-inventory');
      assert.ok(loot.x < 60 && loot.y >= (await bounds(page, '.health-panel')).y + (await bounds(page, '.health-panel')).height, `${label}: loot stays top-left below health`);
      const equipment = await bounds(page, '.equipment-controls');
      for (const selector of ['#loot-inventory', '#objective-status', '#reticle', '.combat-controls']) {
        assert.ok(separated(equipment, await bounds(page, selector)), `${label}: equipment does not overlap ${selector}`);
      }
      const ammo = await bounds(page, '.ammo-panel');
      for (const selector of ['#joystick', '.move-control .control-label', '.combat-controls']) assert.ok(separated(ammo, await bounds(page, selector)), `${label}: ammo does not overlap ${selector}`);
      const health = await bounds(page, '.health-panel');
      assert.ok(separated(health, await bounds(page, '.score-panel')), `${label}: team score does not overlap health`);
      assert.ok(separated(await bounds(page, '.hud-actions'), await bounds(page, '.score-panel')), `${label}: team score does not overlap HUD actions`);
      for (const selector of ['#knife-button', '#grenade-type-button', '#throw-button', '#jump-button', '#fire-button', '#reload-button', '#zoom-button']) {
        const target = await bounds(page, selector);
        assert.ok(target.width >= 44 && target.height >= 44, `${label}: ${selector} retains a 44px touch target`);
      }
      assert.ok(await page.locator('#teammate-map-button').evaluate(element => {
        const box = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      }), `${label}: map receives touch through aim surface`);
      assert.equal(await page.locator('#teammate-map-button').evaluate(element => getComputedStyle(element).touchAction), 'none');
      await page.screenshot({ path: resolve(runDir, `${label}-hud.png`) });
      await page.locator('#teammate-map-screen').evaluate(element => { element.hidden = false; });
      const large = await bounds(page, '#teammate-map-large');
      const close = await bounds(page, '#teammate-map-close');
      assert.ok(inViewport(large, viewport) && Math.abs(large.width - large.height) < 1 && large.width >= 240, `${label}: large map fits as square`);
      assert.ok(inViewport(close, viewport) && close.width >= 44 && close.height >= 44, `${label}: close is visible touch target`);
      assert.ok(separated(large, close), `${label}: large map does not cover close`);
      assert.ok(await page.locator('.teammate-map-dialog').evaluate(element => element.scrollHeight <= element.clientHeight + 1), `${label}: dialog needs no scrolling`);
      await page.locator('#teammate-map-close').click();
      await page.screenshot({ path: resolve(runDir, `${label}-dialog.png`) });
      console.log(`PASS ${label}`);
    } catch (error) {
      await page.screenshot({ path: resolve(runDir, `${label}-failure.png`) });
      throw error;
    } finally { await page.close(); }
  }
  console.log(`Teammate map layout evidence: ${runDir}`);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}

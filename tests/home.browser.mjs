import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { startServer } from '../server/server.mjs';
import { build } from 'esbuild';
import { WebSocketServer } from 'ws';

const server = await startServer({ port: 0, distDir: process.env.DIST_DIR || 'dist' });
const pendingServer = new WebSocketServer({ host: '127.0.0.1', port: 0 });
await new Promise(resolve => pendingServer.once('listening', resolve));
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 700 }, hasTouch: true });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const base = `http://127.0.0.1:${server.port}`;
const artifacts = 'artifacts/loot-review/home';
try {
  // Exercise the real result renderer against public snapshots independently
  // of networking, including a frozen result whose winner left the room.
  const resultFixture = await browser.newPage();
  resultFixture.on('pageerror', error => errors.push(error.message));
  await resultFixture.setContent('<h2 id="result-title"></h2><span id="result-mode"></span><span id="result-kills"></span><span id="result-deaths"></span>');
  const resultBundle = await build({ stdin: { contents: 'import { renderMatchResults } from "./src/match-ui.js"; window.renderResultFixture = renderMatchResults;', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });
  await resultFixture.addScriptTag({ content: resultBundle.outputFiles[0].text });
  const renderResult = async view => {
    await resultFixture.evaluate(view => window.renderResultFixture(view, 'guest'), view);
    return resultFixture.locator('#result-title').textContent();
  };
  const departedWinner = { modeId: 'ffa', winnerId: 'departed', winnerTeamId: null, winnerName: 'Original Host', players: [{ id: 'guest', name: 'Friend', teamId: null, kills: 1, deaths: 2 }] };
  assert.equal(await renderResult(departedWinner), 'ORIGINAL HOST WINS.', 'a departed winner keeps the authoritative outcome and frozen name');
  assert.equal(await renderResult({ ...departedWinner, winnerName: null }), 'PLAYER WINS.', 'a missing winner name cannot change a win into a draw');
  assert.equal(await renderResult({ ...departedWinner, winnerName: null, players: [...departedWinner.players, { id: 'departed', name: 'Host', teamId: null, kills: 3, deaths: 0 }] }), 'HOST WINS.', 'current roster supplies a name when no frozen name is available');
  assert.equal(await renderResult({ ...departedWinner, players: [...departedWinner.players, { id: 'departed', name: 'Changed Name', teamId: null, kills: 3, deaths: 0 }] }), 'ORIGINAL HOST WINS.', 'frozen winning name takes precedence over current roster');
  assert.equal(await renderResult({ ...departedWinner, winnerId: 'guest', winnerName: 'Friend' }), 'YOU WON.', 'own winner ID controls the personal win label');
  assert.equal(await renderResult({ ...departedWinner, winnerId: null, winnerName: null }), 'DRAW.', 'only null winning IDs represent a draw');
  assert.equal(await renderResult({ ...departedWinner, modeId: 'tdm', winnerId: null, winnerName: null, winnerTeamId: 'blue' }), 'BLUE TEAM WINS.', 'team outcome uses the authoritative winning team');
  await resultFixture.close();
  await page.goto(base);
  await page.waitForSelector('body[data-mode="home"]', { timeout: 5000 });
  assert.equal(await page.locator('[data-map]').count(), 8, 'all eight bundled maps can be selected');
  assert.equal(await page.locator('[data-mode-id]').count(), 3, 'all three match modes are separate from navigation');
  assert.equal(await page.locator('[data-skin]').count(), 8, 'all eight skins are unlocked');
  await page.waitForFunction(() => document.getElementById('character-preview').width > 1);
  await page.locator('[data-map="space-station"]').click();
  await page.locator('[data-mode-id="ctf"]').click();
  await page.locator('[data-skin="space-guard"]').click();
  await page.locator('#home-armory').click();
  assert.match(await page.locator('#armory .app-footer').textContent(), /v0\.4\.2 LOOT INVENTORY/, 'visible build identity distinguishes the inventory browser release');
  await page.locator('[data-class="sniper"]').click();
  await page.locator('[data-weapon="awp"]').click();
  await page.locator('#armory-home').click();
  await page.reload();
  await page.waitForSelector('body[data-mode="home"]');
  for (const selector of ['[data-map="space-station"]', '[data-mode-id="ctf"]', '[data-skin="space-guard"]']) assert.equal(await page.locator(selector).getAttribute('aria-pressed'), 'true', 'selection survives armory and reload');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('block-ops-v1')));
  assert.equal(saved.weaponId, 'awp');
  assert.deepEqual(saved.selection, { mapId: 'space-station', modeId: 'ctf', skinId: 'space-guard', weaponId: 'awp' });
  await mkdir(artifacts, { recursive: true });
  for (const size of [{ width: 1200, height: 700 }, { width: 960, height: 540 }, { width: 854, height: 480 }, { width: 853, height: 480 }]) {
    await page.setViewportSize(size);
    await page.screenshot({ path: `${artifacts}/home-${size.width}.png` });
    const footer = await page.locator('#home-screen .app-footer').boundingBox();
    for (const id of ['home-solo', 'home-online', 'home-armory', 'home-settings', 'character-preview']) {
      const bounds = await page.locator('#' + id).boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= size.width && bounds.y + bounds.height <= size.height, `${id} fits ${size.width}×${size.height}`);
      if (id !== 'character-preview') {
        assert.ok(bounds.width >= 44 && bounds.height >= 44, `${id} retains a usable touch target`);
        assert.ok(bounds.y + bounds.height <= footer.y, `${id} does not overlap parked-play footer`);
      }
    }
    assert.ok(footer.y + footer.height <= size.height, 'parked-play footer fits viewport');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${artifacts}/home-${size.width}.png` });
  }
  await page.setViewportSize({ width: 1200, height: 700 });
  for (const id of ['courtyard', 'dust-town', 'neon-city', 'snow-base', 'jungle-ruins', 'harbor', 'desert-fort', 'space-station']) {
    await page.locator(`[data-map="${id}"]`).click();
    await page.screenshot({ path: `${artifacts}/map-${id}.png` });
    await page.locator('#home-solo').click();
    await page.waitForSelector('body[data-mode="playing"]');
    if (['dust-town', 'neon-city', 'space-station'].includes(id)) {
      await page.keyboard.down('KeyD'); await page.waitForTimeout(1400); await page.keyboard.up('KeyD');
    }
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${artifacts}/arena-${id}.png` });
    await page.locator('#home-button').click();
    await page.locator('#confirm-home').click();
    await page.waitForSelector('body[data-mode="home"]');
  }
  for (const id of ['ranger', 'desert-ops', 'arctic-scout', 'jungle-scout', 'neon-runner', 'shadow-ninja', 'robo-unit', 'space-guard']) {
    await page.locator(`[data-skin="${id}"]`).click();
    await page.waitForTimeout(100);
    await page.screenshot({ path: `${artifacts}/skin-${id}.png` });
  }
  await page.locator('#home-solo').click();
  await page.waitForSelector('body[data-mode="playing"]');
  assert.match(await page.locator('#hud-mode').textContent(), /CAPTURE|FLAG/i);
  assert.match(await page.locator('#objective-status').textContent(), /RED|BLUE/i);
  assert.equal(await page.locator('#hud-weapon').textContent(), 'AWP');
  // Use automatic fire so an uncleared held trigger would keep spending ammo.
  await page.locator('#loadout-button').click();
  await page.locator('[data-class="assault"]').click();
  await page.locator('[data-weapon="m4a1"]').click();
  await page.locator('#play-button').click();
  const loadedAmmo = Number(await page.locator('#ammo-count').textContent());
  // Observe the first shot's HUD before pausing: simulation can spend a round
  // between HUD ticks. Pause in that mutation's microtask so the held automatic
  // trigger cannot spend another round between the baseline and Home action.
  await page.evaluate(ammo => {
    const count = document.getElementById('ammo-count');
    const observer = new MutationObserver(() => {
      if (Number(count.textContent) >= ammo) return;
      observer.disconnect(); document.getElementById('home-button').click();
    });
    observer.observe(count, { childList: true });
  }, loadedAmmo);
  await page.keyboard.down('KeyF');
  await page.waitForSelector('body[data-mode="confirm-home"]');
  const clock = await page.locator('#timer').textContent();
  await page.waitForTimeout(1100);
  assert.equal(await page.locator('#timer').textContent(), clock, 'solo confirmation pauses time');
  const ammo = await page.locator('#ammo-count').textContent();
  await page.locator('#cancel-home').click();
  await page.waitForSelector('body[data-mode="playing"]');
  await page.waitForTimeout(800);
  assert.equal(await page.locator('#ammo-count').textContent(), ammo, 'cancel clears held input');
  await page.keyboard.up('KeyF'); // Hold through Cancel: keyup cannot mask stuck fire.
  await page.locator('#pause-button').click();
  await page.locator('#pause-home').click();
  await page.locator('#cancel-home').click();
  assert.equal(await page.locator('body').getAttribute('data-mode'), 'paused', 'cancel restores paused origin');
  // Native background suspension may survive foregrounding, but a confirmed
  // Home followed by an explicit foreground fresh round is a new intent.
  await page.evaluate(() => window.pauseGame());
  await page.locator('#pause-home').click();
  await page.locator('#confirm-home').click();
  await page.waitForSelector('body[data-mode="home"]');
  // Controlled hidden-document signal: programmatic background deployment
  // must not grant controls, and restoring visibility is not Resume.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.getElementById('home-solo').click();
    delete document.hidden;
  });
  assert.equal(await page.locator('body').getAttribute('data-mode'), 'paused', 'background fresh-solo action remains paused after foregrounding');
  await page.locator('#pause-home').click(); await page.locator('#confirm-home').click();
  await page.waitForSelector('body[data-mode="home"]');
  await page.locator('#home-solo').click();
  assert.equal(await page.locator('body').getAttribute('data-mode'), 'playing', 'explicit foreground fresh solo starts after native suspension and confirmed Home');
  await page.locator('#home-button').click(); await page.locator('#confirm-home').click();
  await page.waitForSelector('body[data-mode="home"]');
  await page.locator('#home-online').click();
  await page.locator('.server-settings').evaluate(element => { element.open = true; });
  await page.locator('#server-address').fill(`http://127.0.0.1:${pendingServer.address().port}`);
  const connectedSocket = new Promise(resolve => pendingServer.once('connection', resolve));
  await page.locator('#create-room').click(); await connectedSocket;
  await page.locator('#online-back').click();
  await page.waitForSelector('body[data-mode="home"]');
  await page.waitForTimeout(300);
  assert.equal(pendingServer.clients.size, 0, 'returning Home cancels an unwelcomed connection rather than leaving a hidden room request');
  await page.evaluate(() => localStorage.setItem('block-ops-v1', JSON.stringify({ weaponId: 'invalid', selection: { mapId: 'invalid', modeId: 'invalid', skinId: 'invalid', weaponId: 'invalid' }, settings: { bots: 1 } })));
  await page.reload();
  await page.waitForSelector('body[data-mode="home"]');
  for (const selector of ['[data-map="courtyard"]', '[data-mode-id="ffa"]', '[data-skin="ranger"]']) assert.equal(await page.locator(selector).getAttribute('aria-pressed'), 'true', 'corrupt IDs use defaults');
  await page.locator('#home-armory').click();
  assert.equal(await page.locator('#selected-name').textContent(), 'M4A1');
  assert.deepEqual(errors, [], 'no page exceptions');
  console.log('Home browser passed: catalogues, previews, persistence/fallback, armory, configured solo, confirmation/input, compact bounds and 28 screenshots.');
} finally { await browser.close(); await server.close(); await new Promise(resolve => pendingServer.close(resolve)); }

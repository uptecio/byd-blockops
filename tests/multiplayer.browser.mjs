import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { startServer } from '../server/server.mjs';

const hosted = process.env.TEST_GAME_URL;
// Speed up only the local server's real simulation for timeout transitions,
// after verifying its normal live clock. Keep browser input and sockets real.
let simulationRate = 1;
const nativeInterval = globalThis.setInterval;
globalThis.setInterval = (callback, delay, ...args) => nativeInterval(() => { for (let i = 0; i < (delay === 1000 / 30 ? simulationRate : 1); i++) callback(...args); }, delay);
let server;
try { server = hosted ? null : await startServer({ port: 4186, distDir: process.env.DIST_DIR || 'dist' }); }
finally { globalThis.setInterval = nativeInterval; }
const base = hosted || 'http://127.0.0.1:4186';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const contexts = await Promise.all([browser.newContext({ viewport: { width: 1200, height: 700 } }), browser.newContext({ viewport: { width: 1200, height: 700 } })]);
const pages = await Promise.all(contexts.map(context => context.newPage()));
const errors = [], snapshots = [null, null];
pages.forEach((page, index) => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => socket.on('framereceived', frame => {
    try { const message = JSON.parse(String(frame.payload)); if (message.room) snapshots[index] = message.room; } catch {}
  }));
});
const waitFor = async (predicate, message, timeout = 12000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 60)); }
  assert.fail(message);
};
try {
  for (let i = 0; i < 2; i++) {
    const page = pages[i];
    await page.goto(base);
    if (i === 0) {
      await page.locator('[data-map="dust-town"]').click();
      await page.locator('[data-skin="shadow-ninja"]').click();
    }
    await page.locator('#home-online').click();
    await page.waitForSelector('body[data-mode="lobby"]');
    await page.locator('#player-name').fill(i === 0 ? 'Host' : 'Friend');
    await page.locator('.server-settings').evaluate(element => { element.open = true; });
    await page.locator('#server-address').fill(base);
  }
  await pages[0].locator('#create-room').click();
  await pages[0].waitForSelector('#room-lobby:not([hidden])');
  const code = await pages[0].locator('#room-code').textContent();
  assert.match(code, /^[A-Z0-9]{6}$/);
  assert.equal(await pages[0].locator('#start-online').isDisabled(), true, 'cannot start alone');
  assert.equal(snapshots[0].mapId, 'dust-town', 'create forwards selected Home map');
  assert.equal(snapshots[0].players[0].skinId, 'shadow-ninja', 'create forwards selected Home skin');
  await pages[0].locator('#room-skin').selectOption('robo-unit');
  await waitFor(() => snapshots[0].players[0].skinId === 'robo-unit', 'lobby skin selection reaches authority');
  await pages[0].locator('#room-loadout').click();
  await pages[0].locator('[data-weapon="ak47"]').click();
  await pages[0].locator('#play-button').click();
  await waitFor(() => snapshots[0].players.find(player => player.name === 'Host').weaponId === 'ak47', 'lobby loadout changes reach server before starting');
  await pages[1].locator('#room-code-input').fill(code);
  await pages[1].locator('#join-room').click();
  await waitFor(async () => (await pages[0].locator('#room-roster .roster-player').count()) === 2, 'two real players reach lobby');
  assert.equal(await pages[1].locator('#start-online').isDisabled(), true, 'only host starts');
  assert.equal(await pages[1].locator('#room-map').isDisabled(), true, 'guest cannot configure room');
  await pages[0].locator('#room-map').selectOption('neon-city');
  await waitFor(async () => snapshots.every(room => room.mapId === 'neon-city') && await pages[1].locator('#room-map').inputValue() === 'neon-city', 'guests see authoritative host map');
  await pages[0].locator('#room-map').selectOption('courtyard');
  await waitFor(() => snapshots.every(room => room.mapId === 'courtyard'), 'host restores map before combat');
  assert.equal(await pages[0].evaluate(() => JSON.parse(localStorage.getItem('block-ops-v1')).selection.mapId), 'courtyard', 'host room map persists locally');
  await mkdir('artifacts', { recursive: true });
  await pages[0].screenshot({ path: 'artifacts/online-lobby.png' });
  await pages[1].locator('#room-loadout').click();
  await pages[1].locator('#armory .settings-open').click();
  assert.equal(await pages[1].locator('#settings-screen').isVisible(), true);
  // Exercise the exact boundary MainActivity.onPause calls, while the guest
  // has no arena yet. Headless Chromium does not deliver real tab visibility.
  await pages[1].evaluate(() => window.pauseGame());
  await pages[0].locator('#start-online').click();
  await pages[0].waitForSelector('body[data-mode="playing"]');
  await waitFor(() => snapshots.every(snapshot => snapshot && snapshot.phase === 'playing' && snapshot.players.length === 2), 'both clients share the running match');
  assert.equal(await pages[1].locator('body').getAttribute('data-mode'), 'paused', 'native background suspension survives remote start');
  assert.equal(await pages[1].locator('#settings-screen').isHidden(), true, 'host start closes obsolete guest settings without enabling controls');
  // Android onResume only resumes rendering; it never calls game Resume.
  await pages[1].bringToFront();
  await pages[1].evaluate(() => window.dispatchEvent(new Event('focus')));
  const suspendedGuest = { ...snapshots[1].players.find(player => player.name === 'Friend') };
  const suspendedTime = snapshots[0].timeLeft;
  await pages[1].keyboard.down('KeyW'); await pages[1].keyboard.down('KeyF');
  try { await waitFor(() => snapshots[0].timeLeft < suspendedTime - 1, 'shared match continues while the foreground guest awaits Resume'); }
  finally { await pages[1].keyboard.up('KeyW'); await pages[1].keyboard.up('KeyF'); }
  const foregroundGuest = snapshots[0].players.find(player => player.name === 'Friend');
  assert.equal(await pages[1].locator('body').getAttribute('data-mode'), 'paused', 'foregrounding does not implicitly resume the remotely started arena');
  assert.ok(Math.hypot(foregroundGuest.x - suspendedGuest.x, foregroundGuest.z - suspendedGuest.z) < .05, 'background-started guest stays motionless until explicit Resume');
  assert.equal(foregroundGuest.ammo, suspendedGuest.ammo, 'background-started guest cannot fire before explicit Resume');
  await mkdir('.superpowers/sdd/2026-10-02-home-maps-skins-modes/screenshots', { recursive: true });
  await pages[1].screenshot({ path: '.superpowers/sdd/2026-10-02-home-maps-skins-modes/screenshots/background-remote-paused.png' });
  await pages[1].locator('#resume-button').click();
  await pages[1].waitForSelector('body[data-mode="playing"]');
  await pages[1].keyboard.press('KeyF');
  await waitFor(() => snapshots[0].players.find(player => player.name === 'Friend').ammo < suspendedGuest.ammo, 'explicit Resume restores guest controls for a fresh input');
  assert.equal(await pages[0].locator('#room-map').isDisabled(), true, 'host settings lock in play');
  assert.equal(snapshots[0].players.find(player => player.name === 'Host').ammo + snapshots[0].players.find(player => player.name === 'Host').reserve, 500);
  const before = snapshots[0].players.find(player => player.name === 'Host').z;
  await pages[0].keyboard.down('KeyW');
  await pages[0].waitForTimeout(550);
  await pages[0].keyboard.up('KeyW');
  await waitFor(() => Math.abs(snapshots[1].players.find(player => player.name === 'Host').z - before) > .4, 'other client sees server-owned movement');
  await pages[0].keyboard.press('KeyF');
  await waitFor(() => snapshots[1].players.find(player => player.name === 'Host').ammo < 30, 'shots consume ammo on shared server');
  await waitFor(() => snapshots[1].players.every(player => player.protectedRemaining === 0), 'initial spawn protection expires');
  await pages[0].keyboard.down('KeyF');
  try { await waitFor(() => snapshots[1].players.find(player => player.name === 'Friend').deaths >= 1, 'real player takes damage and is eliminated by the host'); }
  finally { await pages[0].keyboard.up('KeyF'); }
  await waitFor(() => snapshots.every(room => room.players.find(player => player.name === 'Host').kills === 1), 'both independent clients converge on attacker kill credit');
  await waitFor(() => snapshots[1].players.find(player => player.name === 'Friend').health === 100, 'eliminated real player respawns');
  await pages[0].keyboard.down('KeyW');
  await pages[0].keyboard.down('KeyF');
  await pages[0].locator('#home-button').click();
  await pages[0].keyboard.up('KeyW'); await pages[0].keyboard.up('KeyF');
  await pages[0].waitForTimeout(250);
  const stopped = { ...snapshots[0].players.find(player => player.name === 'Host') };
  const confirmTime = snapshots[1].timeLeft;
  const confirmDisplayTime = await pages[0].locator('#timer').textContent();
  await waitFor(() => snapshots[1].timeLeft < confirmTime - 1, 'online Home confirmation keeps shared clock live');
  await waitFor(async () => await pages[0].locator('#timer').textContent() !== confirmDisplayTime, 'online HUD clock continues updating under Home confirmation');
  const inConfirmation = snapshots[1].players.find(player => player.name === 'Host');
  assert.ok(Math.hypot(inConfirmation.x - stopped.x, inConfirmation.z - stopped.z) < .05, 'Home confirmation stops held movement');
  assert.equal(inConfirmation.ammo, stopped.ammo, 'Home confirmation stops held fire');
  await pages[0].locator('#cancel-home').click();
  await pages[0].waitForSelector('body[data-mode="playing"]');
  await pages[0].waitForTimeout(400);
  assert.equal(snapshots[1].players.find(player => player.name === 'Host').ammo, stopped.ammo, 'cancel cannot revive held fire');
  await pages[0].locator('#pause-button').click();
  const pausedTime = snapshots[0].timeLeft;
  await waitFor(() => snapshots[1].timeLeft < pausedTime - 1, 'one player menu does not pause the shared match');
  assert.equal(await pages[0].locator('body').getAttribute('data-mode'), 'paused');
  assert.match(await pages[0].locator('.pause-dialog p').textContent(), /other players|continues/i);
  await pages[0].locator('#resume-button').click();
  await pages[0].locator('#loadout-button').click();
  await pages[0].locator('[data-class="sniper"]').click(); await pages[0].locator('[data-weapon="awp"]').click();
  await pages[0].locator('#play-button').click();
  await waitFor(() => snapshots[1].players.find(player => player.name === 'Host').weaponId === 'awp', 'loadout replicates to other player');
  await pages[0].screenshot({ path: 'artifacts/online-gameplay.png' });
  await pages[0].locator('#loadout-button').click(); await pages[0].locator('#online-button').click();
  await pages[0].locator('#room-skin').selectOption('space-guard');
  await waitFor(() => snapshots.every(room => {
    const player = room.players.find(player => player.name === 'Host');
    return player.skinId === 'robo-unit' && player.pendingSkinId === 'space-guard';
  }), 'in-play skin choice stays pending without changing the active avatar');
  await pages[0].locator('#start-online').click();
  await pages[0].waitForSelector('body[data-mode="playing"]');
  if (server) {
    await pages[1].locator('#pause-button').click();
    await pages[1].locator('#pause-screen .settings-open').click();
    simulationRate = 240;
    for (const page of pages) await page.waitForSelector('body[data-mode="results"]');
    simulationRate = 1;
    assert.equal(await pages[1].locator('#settings-screen').isHidden(), true, 'remote end closes settings');
    assert.equal(await pages[0].locator('#result-title').textContent(), 'YOU WON.', 'FFA winner is identified by ID');
    await pages[0].locator('#results-home').click(); await pages[0].locator('#confirm-home').click();
    await pages[0].waitForSelector('body[data-mode="home"]');
    await waitFor(() => snapshots[1].players.length === 1, 'winning host leaves completed room');
    assert.equal(snapshots[1].winnerName, 'Host', 'authoritative winner name survives departure');
    await pages[0].locator('#home-online').click();
    await pages[0].locator('#room-code-input').fill(code); await pages[0].locator('#join-room').click();
    await pages[0].waitForSelector('body[data-mode="results"]');
    assert.equal(await pages[0].locator('#result-title').textContent(), 'HOST WINS.', 'late join displays the departed winner instead of draw');
    await pages[1].locator('#results-home').click(); await pages[1].locator('#confirm-home').click();
    await pages[1].waitForSelector('body[data-mode="home"]');
    await waitFor(() => snapshots[0].players.length === 1 && snapshots[0].hostId === snapshots[0].players[0].id, 'remaining client inherits host before next-round configuration');
    await pages[1].locator('#home-online').click();
    await pages[1].locator('#room-code-input').fill(code); await pages[1].locator('#join-room').click();
    await pages[1].waitForSelector('body[data-mode="results"]');
    assert.equal(await pages[1].locator('#result-title').textContent(), 'HOST WINS.');
    for (const page of pages) await page.locator('#again-button').click();
    await pages[0].locator('#room-map').selectOption('dust-town');
    await pages[0].locator('#room-mode').selectOption('tdm');
    await waitFor(() => snapshots.every(room => room.mapId === 'dust-town' && room.modeId === 'tdm'), 'host changes map and mode between rounds');
    await pages[1].locator('#online-back').click();
    assert.equal(await pages[1].locator('#confirm-home-screen').isVisible(), true);
    await pages[0].locator('#start-online').click();
    for (const page of pages) await page.waitForSelector('body[data-mode="playing"]');
    assert.equal(await pages[1].locator('#confirm-home-screen').isHidden(), true, 'remote start invalidates old Home confirmation');
    await pages[1].evaluate(() => document.getElementById('cancel-home').click());
    assert.equal(await pages[1].locator('body').getAttribute('data-mode'), 'playing', 'stale cancel cannot restore prior lobby');
    assert.match(await pages[0].locator('#kills').textContent(), /RED.*BLUE/);
    assert.match(await pages[1].locator('#hud-mode').textContent(), /TEAM DEATHMATCH.*BLUE/);
    assert.equal(await pages[0].locator('#online-scoreboard [data-team]').count(), 2, 'scoreboard preserves readable team markers');
    await pages[0].locator('#pause-button').click();
    await pages[0].locator('#pause-screen .settings-open').click();
    await pages[1].locator('#home-button').click();
    simulationRate = 240;
    for (const page of pages) await page.waitForSelector('body[data-mode="results"]');
    simulationRate = 1;
    assert.equal(await pages[0].locator('#settings-screen').isHidden(), true);
    assert.equal(await pages[1].locator('#confirm-home-screen').isHidden(), true, 'remote end invalidates Home confirmation');
    await pages[1].evaluate(() => { document.getElementById('cancel-home').click(); document.getElementById('confirm-home').click(); });
    assert.equal(await pages[1].locator('body').getAttribute('data-mode'), 'results', 'stale Home callbacks cannot leave or resume ended round');
    assert.equal(await pages[1].locator('#result-title').textContent(), 'DRAW.', 'timeout team tie shows draw');
    for (const page of pages) await page.locator('#again-button').click();
    await pages[0].locator('#room-map').selectOption('space-station');
    await pages[0].locator('#room-mode').selectOption('ctf');
    await waitFor(() => snapshots.every(room => room.modeId === 'ctf' && room.mapId === 'space-station'), 'host selects CTF for next round');
    await pages[1].locator('#room-loadout').click();
    await pages[1].locator('#armory .settings-open').click();
    await pages[0].locator('#start-online').click();
    for (const page of pages) await page.waitForSelector('body[data-mode="playing"]');
    assert.equal(await pages[1].locator('#settings-screen').isHidden(), true, 'ordinary local settings do not latch background suspension on remote start');
    assert.match(await pages[1].locator('#objective-status').textContent(), /RED FLAG: HOME.*BLUE FLAG: HOME/);
    await pages[0].setViewportSize({ width: 960, height: 540 });
    for (const id of ['home-button', 'pause-button', 'loadout-button', 'objective-status', 'joystick', 'fire-button', 'ammo-panel']) {
      const locator = id === 'ammo-panel' ? pages[0].locator('.ammo-panel') : pages[0].locator('#' + id);
      const box = await locator.boundingBox();
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 960 && box.y + box.height <= 540, `${id} fits compact CTF HUD`);
    }
    await mkdir('.superpowers/sdd/2026-10-02-home-maps-skins-modes/screenshots', { recursive: true });
    await pages[0].screenshot({ path: '.superpowers/sdd/2026-10-02-home-maps-skins-modes/screenshots/online-ctf-960.png' });
    // Walk both real clients through the open central chamber, then inspect
    // nearby peer names and badges rather than relying on distant spawn views.
    const ownPlayer = index => snapshots[index].players.find(player => player.name === (index === 0 ? 'Host' : 'Friend'));
    const face = async (index, yaw) => {
      const dx = (ownPlayer(index).yaw - yaw) / .0026;
      await pages[index].mouse.move(420, 280); await pages[index].mouse.down();
      await pages[index].mouse.move(420 + dx, 280); await pages[index].mouse.up();
      await waitFor(() => Math.abs(ownPlayer(index).yaw - yaw) < .05, 'real look drag aligns the peer inspection camera');
    };
    for (let index = 0; index < 2; index++) {
      await face(index, 0);
      const key = ownPlayer(index).x < 3.5 ? 'KeyD' : 'KeyA';
      await pages[index].keyboard.down(key);
      try { await waitFor(() => key === 'KeyD' ? ownPlayer(index).x >= 3.25 : ownPlayer(index).x <= 3.75, 'real strafe reaches the open central route'); }
      finally { await pages[index].keyboard.up(key); }
      await pages[index].keyboard.down(index === 0 ? 'KeyW' : 'KeyS');
      try { await waitFor(() => index === 0 ? ownPlayer(index).z <= 5.2 : ownPlayer(index).z >= -5.2, 'real movement approaches a visible opposing peer'); }
      finally { await pages[index].keyboard.up(index === 0 ? 'KeyW' : 'KeyS'); }
    }
    await face(1, Math.PI);
    await pages[0].keyboard.down('KeyW');
    try { await waitFor(() => ownPlayer(0).z <= .6, 'real movement brings names and team badges into a close view'); }
    finally { await pages[0].keyboard.up('KeyW'); }
    await pages[0].waitForTimeout(200);
    assert.ok(Math.hypot(ownPlayer(0).x - ownPlayer(1).x, ownPlayer(0).z - ownPlayer(1).z) < 6, 'peers are close enough for readable labels and team badges');
    await pages[0].screenshot({ path: '.superpowers/sdd/2026-10-02-home-maps-skins-modes/screenshots/online-peer-blue-960.png' });
    await pages[1].screenshot({ path: '.superpowers/sdd/2026-10-02-home-maps-skins-modes/screenshots/online-peer-red-1200.png' });
  }
  await pages[0].locator('#home-button').click();
  await pages[0].locator('#confirm-home').click();
  await pages[0].waitForSelector('body[data-mode="home"]');
  await waitFor(() => snapshots[1].players.length === 1 && snapshots[1].hostId === snapshots[1].players[0].id, 'Home leave transfers host exactly once');
  await pages[0].locator('#home-solo').click();
  await pages[0].waitForSelector('body[data-mode="playing"]');
  assert.match(await pages[0].locator('#hud-mode').textContent(), /SOLO/);
  assert.equal(Number(await pages[0].locator('#ammo-count').textContent()) + Number(await pages[0].locator('#reserve-count').textContent()), 500, 'solo works after leaving online');
  if (server) {
    await pages[0].locator('#home-button').click(); await pages[0].locator('#confirm-home').click();
    await pages[0].locator('#home-online').click();
    await pages[0].locator('#room-code-input').fill(code); await pages[0].locator('#join-room').click();
    await pages[0].waitForSelector('body[data-mode="playing"]');
    await pages[0].locator('#home-button').click();
    await pages[1].locator('#pause-button').click(); await pages[1].locator('#pause-screen .settings-open').click();
    await server.close();
    for (const page of pages) {
      await page.waitForSelector('body[data-mode="lobby"]');
      assert.equal(await page.locator('#confirm-home-screen').isHidden(), true, 'disconnect invalidates confirmation');
      assert.equal(await page.locator('#settings-screen').isHidden(), true, 'disconnect closes settings');
      assert.match(await page.locator('#connection-status').textContent(), /Connection lost/);
      await page.evaluate(() => { document.getElementById('cancel-home').click(); document.getElementById('confirm-home').click(); });
      assert.equal(await page.locator('body').getAttribute('data-mode'), 'lobby', 'stale callbacks retain disconnect destination');
    }
  }
  assert.deepEqual(errors, []);
  console.log(`Multiplayer browser passed: two real clients, movement/shots/ammo, authoritative settings/skins, Home cancel/confirm/host transfer, live clock, native background remote-start suspension until explicit Resume, remote overlay invalidation, departed winner, team/flag HUD and peer screenshots. ${base}`);
} finally { await browser.close(); if (server) await server.close(); }

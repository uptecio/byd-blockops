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
try { server = hosted ? null : await startServer({ port: 0, distDir: process.env.DIST_DIR || 'dist' }); }
finally { globalThis.setInterval = nativeInterval; }
const base = hosted || `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const contexts = await Promise.all([browser.newContext({ viewport: { width: 1200, height: 700 } }), browser.newContext({ viewport: { width: 1200, height: 700 } })]);
const pages = await Promise.all(contexts.map(context => context.newPage()));
// Test-local access to the real wire, only to issue the normal ping barrier.
// No production state, input packets or simulation positions are injected.
await Promise.all(pages.map(page => page.addInitScript(() => {
  const NativeWebSocket = window.WebSocket;
  window.WebSocket = class extends NativeWebSocket {
    constructor(...args) { super(...args); window.__testRoomSocket = this; }
    send(data) {
      const packet = JSON.parse(data);
      if (packet.type === 'input') window.__testLastInput = packet;
      super.send(data);
    }
  };
})));
const errors = [], snapshots = [null, null], sent = [[], []];
pages.forEach((page, index) => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => {
    socket.on('framesent', frame => sent[index].push(JSON.parse(String(frame.payload))));
    socket.on('framereceived', frame => {
      try { const message = JSON.parse(String(frame.payload)); if (message.room) snapshots[index] = message.room; } catch {}
    });
  });
});
const waitFor = async (predicate, message, timeout = 12000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 60)); }
  assert.fail(message);
};
const roomAfterInputBarrier = page => page.evaluate(() => new Promise((resolve, reject) => {
  const socket = window.__testRoomSocket, marker = `input-barrier-${performance.now()}`;
  let acknowledged = false;
  const timer = setTimeout(() => { socket.removeEventListener('message', receive); reject(new Error('Input ordering barrier timed out')); }, 12000);
  function receive(event) {
    const packet = JSON.parse(event.data);
    if (packet.type === 'pong' && packet.at === marker) acknowledged = true;
    else if (acknowledged && packet.room) {
      clearTimeout(timer); socket.removeEventListener('message', receive); resolve(packet.room);
    }
  }
  socket.addEventListener('message', receive);
  socket.send(JSON.stringify({ type: 'ping', at: marker }));
}));
try {
  // A regular remote start retains the guest's intentional menu; a native
  // backgrounded start closes the obsolete overlay into explicit pause.
  for (const scenario of ['ordinary', 'background', 'home-confirmation']) {
    const suspended = scenario === 'background', homeConfirmation = scenario === 'home-confirmation';
    snapshots.fill(null);
    for (let i = 0; i < 2; i++) {
      await pages[i].goto(base); await pages[i].locator('#home-online').click();
      await pages[i].locator('.server-settings').evaluate(element => { element.open = true; });
      await pages[i].locator('#server-address').fill(base);
    }
    await pages[0].locator('#create-room').click(); await pages[0].locator('#room-lobby:not([hidden])').waitFor();
    const menuCode = await pages[0].locator('#room-code').textContent();
    await pages[1].locator('#room-code-input').fill(menuCode); await pages[1].locator('#join-room').click();
    await waitFor(() => snapshots.every(room => room?.code === menuCode && room.players.length === 2), 'menu-start peers join');
    if (homeConfirmation) await pages[1].locator('#online-back').click();
    else { await pages[1].locator('#room-loadout').click(); await pages[1].locator('#armory .settings-open').click(); }
    if (suspended) await pages[1].evaluate(() => window.pauseGame());
    await pages[0].locator('#start-online').click();
    await waitFor(() => snapshots.every(room => room?.code === menuCode && room.phase === 'playing'), 'menu-start peers receive new round');
    assert.equal(await pages[1].locator('body').getAttribute('data-mode'), homeConfirmation ? 'playing' : suspended ? 'paused' : 'armory', `remote start ${scenario} resolves the correct screen`);
    assert.equal(await pages[1].locator('#settings-screen').isHidden(), suspended || homeConfirmation, 'ordinary open settings remain while obsolete overlays close');
    if (homeConfirmation) {
      assert.equal(await pages[1].locator('#confirm-home-screen').isHidden(), true, 'remote start invalidates old Home confirmation');
      await pages[1].evaluate(() => { document.querySelector('#cancel-home').click(); document.querySelector('#confirm-home').click(); });
      assert.equal(await pages[1].locator('body').getAttribute('data-mode'), 'playing', 'stale Home actions cannot leave or restore the previous lobby');
    } else {
      const own = { ...snapshots[1].players.find(player => player.id !== snapshots[1].hostId) }, clock = snapshots[1].timeLeft;
      await pages[1].keyboard.down('KeyW'); await pages[1].keyboard.down('KeyF');
      try { await waitFor(() => snapshots[1].timeLeft < clock - .4, 'shared clock advances with guest menu suspended'); }
      finally { await pages[1].keyboard.up('KeyW'); await pages[1].keyboard.up('KeyF'); }
      const still = snapshots[1].players.find(player => player.id === own.id);
      assert.equal(still.ammo, own.ammo); assert.equal(still.x, own.x); assert.equal(still.z, own.z);
      if (suspended) await pages[1].locator('#resume-button').click();
      else { await pages[1].locator('#settings-done').click(); await pages[1].locator('#play-button').click(); }
    }
    for (const page of pages) { await page.locator('#home-button').click(); await page.locator('#confirm-home').click(); await page.waitForSelector('body[data-mode="home"]'); }
    console.log(`PASS remote start ${homeConfirmation ? 'invalidates stale Home confirmation' : suspended ? 'background suspension closes overlays and waits for Resume' : 'ordinary menu remains open and neutral'}`);
  }
  if (process.argv.includes('--menus')) { assert.deepEqual(errors, []); console.log('Remote-start menu regressions passed.'); }
  else {
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
  await waitFor(() => sent[0].findLast(packet => packet.type === 'loadout')?.weaponId === 'ak47', 'lobby selection sends the normal future-loadout request');
  await roomAfterInputBarrier(pages[0]);
  await pages[1].locator('#room-code-input').fill(code);
  await pages[1].locator('#join-room').click();
  await waitFor(async () => (await pages[0].locator('#room-roster .roster-player').count()) === 2, 'two real players reach lobby');
  assert.equal(await pages[1].locator('#start-online').isDisabled(), true, 'only host starts');
  assert.equal(await pages[1].locator('#room-map').isDisabled(), true, 'guest cannot configure room');
  const guestSelection = await pages[1].evaluate(() => JSON.parse(localStorage.getItem('block-ops-v1'))?.selection || null);
  await pages[1].locator('#room-loadout').click();
  await pages[1].locator('[data-class="sniper"]').click();
  await pages[0].locator('#room-map').selectOption('neon-city');
  await pages[0].locator('#room-mode').selectOption('ctf');
  await waitFor(async () => snapshots.every(room => room.mapId === 'neon-city') && await pages[1].locator('#room-map').inputValue() === 'neon-city', 'guests see authoritative host map');
  await waitFor(async () => await pages[1].locator('#armory-map').textContent() === 'NEON CITY'
    && await pages[1].locator('#armory-mode').textContent() === 'CAPTURE THE FLAG · ONLINE FRIENDS'
    && await pages[1].locator('#session-target').textContent() === '3 CAPTURES', 'guest Armory labels follow authoritative host changes while open');
  assert.equal(await pages[1].locator('body').getAttribute('data-mode'), 'armory');
  assert.equal(await pages[1].locator('[data-class="sniper"]').getAttribute('aria-pressed'), 'true', 'room updates preserve the open loadout menu');
  assert.deepEqual(await pages[1].evaluate(() => JSON.parse(localStorage.getItem('block-ops-v1'))?.selection || null), guestSelection, 'room updates preserve independent guest Home choices');
  await pages[1].locator('#play-button').click();
  await pages[0].locator('#room-map').selectOption('courtyard');
  await pages[0].locator('#room-mode').selectOption('ffa');
  await waitFor(() => snapshots.every(room => room.mapId === 'courtyard' && room.modeId === 'ffa'), 'host restores map and mode before combat');
  assert.equal(await pages[0].evaluate(() => JSON.parse(localStorage.getItem('block-ops-v1')).selection.mapId), 'courtyard', 'host room map persists locally');
  await mkdir('artifacts/loot-review', { recursive: true });
  await pages[0].screenshot({ path: 'artifacts/loot-review/online-lobby.png' });
  await pages[1].locator('#room-loadout').click();
  await pages[1].locator('#armory .settings-open').click();
  assert.equal(await pages[1].locator('#settings-screen').isVisible(), true);
  // Exercise the exact boundary MainActivity.onPause calls, while the guest
  // has no arena yet. Headless Chromium does not deliver real tab visibility.
  await pages[1].evaluate(() => window.pauseGame());
  await pages[0].locator('#start-online').click();
  await pages[0].waitForSelector('body[data-mode="playing"]');
  await waitFor(() => snapshots.every(snapshot => snapshot && snapshot.phase === 'playing' && snapshot.players.length === 2), 'both clients share the running match');
  assert.equal(snapshots[0].players.find(player => player.name === 'Host').weaponId, 'ak47', 'ordered lobby loadout becomes the original gun when the round starts');
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
  await pages[1].screenshot({ path: 'artifacts/loot-review/background-remote-paused.png' });
  await pages[1].locator('#resume-button').click();
  await pages[1].waitForSelector('body[data-mode="playing"]');
  // This checks resumed input, not combat. Aim away through the real look
  // control: the newly approved lethal headshot must not kill the still-
  // untouched host before its independent initial-ammo assertion.
  const guestAim = snapshots[1].players.find(player => player.name === 'Friend').yaw;
  await pages[1].mouse.move(420, 280); await pages[1].mouse.down();
  await pages[1].mouse.move(420 + (guestAim - Math.PI / 2) / .0026, 280); await pages[1].mouse.up();
  await waitFor(() => Math.abs(snapshots[1].players.find(player => player.name === 'Friend').yaw - Math.PI / 2) < .05, 'resumed guest aims harmless input shot away from the host');
  await pages[1].keyboard.press('KeyF');
  await waitFor(() => snapshots[0].players.find(player => player.name === 'Friend').ammo < suspendedGuest.ammo, 'explicit Resume restores guest controls for a fresh input');
  assert.equal(await pages[0].locator('#room-map').isDisabled(), true, 'host settings lock in play');
  assert.equal(snapshots[0].players.find(player => player.name === 'Host').ammo + snapshots[0].players.find(player => player.name === 'Host').reserve, 500, `Host initial ammo/life: ${JSON.stringify(snapshots[0].players.find(player => player.name === 'Host'))}`);
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
  const beforeHeld = { ...snapshots[0].players.find(player => player.name === 'Host') };
  await pages[0].keyboard.down('KeyW');
  await pages[0].keyboard.down('KeyF');
  await waitFor(() => {
    const host = snapshots[0].players.find(player => player.name === 'Host');
    return Math.abs(host.z - beforeHeld.z) > .1 && host.ammo < beforeHeld.ammo;
  }, 'held movement and fire reach the authority before Home');
  await pages[0].locator('#home-button').click();
  assert.deepEqual(await pages[0].evaluate(() => {
    const { x, y, fire, firePressed } = window.__testLastInput; return { x, y, fire, firePressed };
  }), { x: 0, y: 0, fire: false, firePressed: false }, 'Home sends neutral input while the keys remain held');
  // WebSocket processing is ordered: this pong follows the real neutral
  // input; the next state follows the pong. A fixed delay can read old state
  // on a public connection and cannot order two independent peer streams.
  const stoppedRoom = await roomAfterInputBarrier(pages[0]);
  const stopped = { ...stoppedRoom.players.find(player => player.name === 'Host') };
  const confirmTime = stoppedRoom.timeLeft;
  const confirmDisplayTime = await pages[0].locator('#timer').textContent();
  await waitFor(() => snapshots[1].timeLeft < confirmTime - 1, 'online Home confirmation keeps shared clock live');
  await waitFor(async () => await pages[0].locator('#timer').textContent() !== confirmDisplayTime, 'online HUD clock continues updating under Home confirmation');
  const inConfirmation = snapshots[1].players.find(player => player.name === 'Host');
  assert.ok(Math.hypot(inConfirmation.x - stopped.x, inConfirmation.z - stopped.z) < .05, 'Home confirmation stops held movement');
  assert.equal(inConfirmation.ammo, stopped.ammo, 'Home confirmation stops held fire');
  await pages[0].locator('#cancel-home').click();
  await pages[0].waitForSelector('body[data-mode="playing"]');
  const cancelTime = snapshots[1].timeLeft;
  await waitFor(() => snapshots[1].timeLeft < cancelTime - 1, 'peer observes continued play after Cancel');
  assert.equal(snapshots[1].players.find(player => player.name === 'Host').ammo, stopped.ammo, 'cancel cannot revive held fire');
  const afterCancel = snapshots[1].players.find(player => player.name === 'Host');
  assert.ok(Math.hypot(afterCancel.x - stopped.x, afterCancel.z - stopped.z) < .05, 'cancel cannot revive held movement');
  await pages[0].keyboard.up('KeyW'); await pages[0].keyboard.up('KeyF');
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
  await pages[0].screenshot({ path: 'artifacts/loot-review/online-gameplay.png' });
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
    // Limit acceleration so a single synchronous timer turn does not emit
    // enough larger protocol-3 snapshots to manufacture socket backpressure.
    simulationRate = 30;
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
    simulationRate = 30;
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
    await pages[0].waitForSelector('body[data-mode="playing"]');
    await waitFor(() => snapshots.every(room => room.phase === 'playing' && room.modeId === 'ctf'), 'both peers receive selected CTF round');
    assert.equal(await pages[1].locator('body').getAttribute('data-mode'), 'armory', 'ordinary remote start retains the intentional Armory menu');
    assert.equal(await pages[1].locator('#settings-screen').isVisible(), true, 'ordinary remote start retains open local settings');
    const menuGuest = { ...snapshots[1].players.find(player => player.name === 'Friend') }, menuTime = snapshots[1].timeLeft;
    await pages[1].keyboard.down('KeyW'); await pages[1].keyboard.down('KeyF');
    try { await waitFor(() => snapshots[1].timeLeft < menuTime - .4, 'CTF clock continues while ordinary guest menu remains neutral'); }
    finally { await pages[1].keyboard.up('KeyW'); await pages[1].keyboard.up('KeyF'); }
    const neutralGuest = snapshots[1].players.find(player => player.name === 'Friend');
    assert.equal(neutralGuest.x, menuGuest.x); assert.equal(neutralGuest.z, menuGuest.z); assert.equal(neutralGuest.ammo, menuGuest.ammo);
    await pages[1].locator('#settings-done').click(); await pages[1].locator('#play-button').click();
    await pages[1].waitForSelector('body[data-mode="playing"]');
    assert.equal(await pages[1].locator('#settings-screen').isHidden(), true, 'explicit foreground Return works without a background latch');
    assert.match(await pages[1].locator('#objective-status').textContent(), /RED FLAG: HOME.*BLUE FLAG: HOME/);
    await pages[0].setViewportSize({ width: 960, height: 540 });
    for (const id of ['home-button', 'pause-button', 'loadout-button', 'objective-status', 'joystick', 'fire-button', 'ammo-panel']) {
      const locator = id === 'ammo-panel' ? pages[0].locator('.ammo-panel') : pages[0].locator('#' + id);
      const box = await locator.boundingBox();
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 960 && box.y + box.height <= 540, `${id} fits compact CTF HUD`);
    }
    await pages[0].screenshot({ path: 'artifacts/loot-review/online-ctf-960.png' });
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
    await pages[0].screenshot({ path: 'artifacts/loot-review/online-peer-blue-960.png' });
    await pages[1].screenshot({ path: 'artifacts/loot-review/online-peer-red-1200.png' });
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
  }
} finally { await browser.close(); if (server) await server.close(); }

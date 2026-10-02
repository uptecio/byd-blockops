import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { startServer } from '../server/server.mjs';

const hosted = process.env.TEST_GAME_URL;
const server = hosted ? null : await startServer({ port: 4186 });
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
    await page.locator('#online-button').click();
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
  await pages[0].locator('#room-loadout').click();
  await pages[0].locator('[data-weapon="ak47"]').click();
  await pages[0].locator('#play-button').click();
  await waitFor(() => snapshots[0].players.find(player => player.name === 'Host').weaponId === 'ak47', 'lobby loadout changes reach server before starting');
  await pages[1].locator('#room-code-input').fill(code);
  await pages[1].locator('#join-room').click();
  await waitFor(async () => (await pages[0].locator('#room-roster .roster-player').count()) === 2, 'two real players reach lobby');
  assert.equal(await pages[1].locator('#start-online').isDisabled(), true, 'only host starts');
  await mkdir('artifacts', { recursive: true });
  await pages[0].screenshot({ path: 'artifacts/online-lobby.png' });
  await pages[1].locator('#room-loadout').click();
  await pages[1].locator('#armory .settings-open').click();
  assert.equal(await pages[1].locator('#settings-screen').isVisible(), true);
  await pages[0].locator('#start-online').click();
  for (const page of pages) await page.waitForSelector('body[data-mode="playing"]');
  assert.equal(await pages[1].locator('#settings-screen').isHidden(), true, 'host start closes obsolete guest settings before enabling controls');
  await waitFor(() => snapshots.every(snapshot => snapshot && snapshot.phase === 'playing' && snapshot.players.length === 2), 'both clients share the running match');
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
  assert.equal(snapshots[0].players.find(player => player.name === 'Host').kills, 1);
  await waitFor(() => snapshots[1].players.find(player => player.name === 'Friend').health === 100, 'eliminated real player respawns');
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
  await pages[1].close();
  await waitFor(() => snapshots[0].players.length === 1, 'disconnected player removed');
  await pages[0].locator('#pause-button').click(); await pages[0].locator('#quit-button').click();
  await pages[0].locator('#play-button').click();
  await pages[0].waitForSelector('body[data-mode="playing"]');
  assert.match(await pages[0].locator('#hud-mode').textContent(), /SOLO/);
  assert.equal(Number(await pages[0].locator('#ammo-count').textContent()) + Number(await pages[0].locator('#reserve-count').textContent()), 500, 'solo works after leaving online');
  assert.deepEqual(errors, []);
  console.log(`Multiplayer browser passed: two real players, room code, host start, movement/shots, 500 ammo, live menu timer, weapon replication, disconnect. ${base}`);
} finally { await browser.close(); if (server) await server.close(); }

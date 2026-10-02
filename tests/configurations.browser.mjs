import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer } from '../server/server.mjs';

// Catch ignored selections, wrong team/spawn assignment, stale room snapshots,
// incorrect mode HUD, and inputs retained after a Home transition.
const maps = ['courtyard', 'dust-town', 'neon-city', 'snow-base', 'jungle-ruins', 'harbor', 'desert-fort', 'space-station'];
const modes = [
  { id: 'ffa', label: 'FREE FOR ALL', target: '15', team: null },
  { id: 'tdm', label: 'TEAM DEATHMATCH', target: '30', team: 'red' },
  { id: 'ctf', label: 'CAPTURE THE FLAG', target: '3 CAPTURES', team: 'red' },
];
const server = await startServer({ port: 0, distDir: process.env.DIST_DIR || 'dist' });
const base = `http://127.0.0.1:${server.port}`;
let browser;
const errors = [];
const until = async (predicate, label) => {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  assert.fail(label);
};
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const contexts = await Promise.all([browser.newContext({ viewport: { width: 1200, height: 700 } }), browser.newContext({ viewport: { width: 1200, height: 700 } })]);
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const rooms = [null, null];
  pages.forEach((page, index) => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('websocket', socket => socket.on('framereceived', frame => {
      const packet = JSON.parse(String(frame.payload));
      if (packet.room) rooms[index] = packet.room;
    }));
  });
  const home = page => page.waitForSelector('body[data-mode="home"]');
  const hud = async (page, mode, online) => {
    await page.waitForSelector('body[data-mode="playing"]');
    assert.match(await page.locator('#hud-mode').textContent(), new RegExp(`${online ? 'ONLINE' : 'SOLO'} / ${mode.label}`));
    if (mode.team) assert.match(await page.locator('#hud-mode').textContent(), /RED/);
    assert.equal((await page.locator('.score-target').textContent()).trim(), `/ ${mode.target}`);
    assert.equal(Number(await page.locator('#ammo-count').textContent()) + Number(await page.locator('#reserve-count').textContent()), 500);
    assert.match(await page.locator('#timer').textContent(), /^(03:00|02:5\d)$/);
    if (mode.id === 'ctf') assert.match(await page.locator('#objective-status').textContent(), /RED FLAG: HOME.*BLUE FLAG: HOME/);
    else assert.equal(await page.locator('#objective-status').isHidden(), true);
  };
  const leave = async page => {
    await page.locator('#home-button').click();
    await page.locator('#confirm-home').click();
    await home(page);
  };
  for (const mapId of maps) for (const mode of modes) {
    const host = pages[0], guest = pages[1];
    await host.goto(base); await home(host);
    await host.locator(`[data-map="${mapId}"]`).click();
    await host.locator(`[data-mode-id="${mode.id}"]`).click();
    await host.locator('[data-skin="space-guard"]').click();
    await host.locator('#home-solo').click();
    await hud(host, mode, false);
    const loadedAmmo = Number(await host.locator('#ammo-count').textContent());
    // Pause atomically with the first truthful HUD shot. Reading between HUD
    // ticks can otherwise compare a pre-shot count against post-resume display.
    await host.evaluate(ammo => {
      const count = document.getElementById('ammo-count');
      const observer = new MutationObserver(() => {
        if (Number(count.textContent) >= ammo) return;
        observer.disconnect(); document.getElementById('home-button').click();
      });
      observer.observe(count, { childList: true });
    }, loadedAmmo);
    await host.keyboard.down('KeyF');
    await host.waitForSelector('body[data-mode="confirm-home"]');
    const ammo = await host.locator('#ammo-count').textContent();
    await host.locator('#cancel-home').click();
    await host.waitForSelector('body[data-mode="playing"]');
    await host.waitForTimeout(200);
    assert.equal(await host.locator('#ammo-count').textContent(), ammo, 'cancel clears held fire');
    await host.keyboard.up('KeyF');
    await leave(host);
    const saved = await host.evaluate(() => JSON.parse(localStorage.getItem('block-ops-v1')).selection);
    assert.deepEqual(saved, { mapId, modeId: mode.id, skinId: 'space-guard', weaponId: 'm4a1' });

    rooms.fill(null);
    for (let index = 0; index < 2; index++) {
      const page = pages[index];
      if (index) { await page.goto(base); await home(page); await page.locator('[data-skin="robo-unit"]').click(); }
      await page.locator('#home-online').click();
      await page.locator('#player-name').fill(index ? 'MatrixGuest' : 'MatrixHost');
      await page.locator('.server-settings').evaluate(element => { element.open = true; });
      await page.locator('#server-address').fill(base);
    }
    await host.locator('#create-room').click();
    await until(() => rooms[0]?.phase === 'lobby' && rooms[0]?.players.length === 1, 'host creates a fresh lobby');
    const code = rooms[0].code;
    assert.equal(rooms[0].mapId, mapId); assert.equal(rooms[0].modeId, mode.id);
    await guest.locator('#room-code-input').fill(code); await guest.locator('#join-room').click();
    await until(() => rooms.every(room => room?.code === code && room.players.length === 2), 'both clients observe current room');
    assert.equal(await guest.locator('#start-online').isDisabled(), true);
    await host.locator('#start-online').click();
    await until(() => rooms.every(room => room?.code === code && room.phase === 'playing'), 'both clients start selected configuration');
    await hud(host, mode, true);
    const room = rooms[0], own = room.players.find(player => player.name === 'MatrixHost'), friend = room.players.find(player => player.name === 'MatrixGuest');
    assert.equal(room.mapId, mapId); assert.equal(room.modeId, mode.id);
    assert.equal(own.skinId, 'space-guard'); assert.equal(friend.skinId, 'robo-unit');
    assert.equal(own.teamId, mode.team); assert.equal(friend.teamId, mode.id === 'ffa' ? null : 'blue');
    const spawnPoints = mapId === 'courtyard' && !mode.team
      ? [[0, 15], [0, -7], [-2, -2], [3, 2], [0, -17], [12, 4], [-12, 4], [12, -5], [-12, -4], [0, 8]]
      : (mapId === 'courtyard' ? [-6, -3, 0, 3, 6] : [-8, -4, 0, 4, 8]).flatMap(x => [[x, 19], [x, -19]]);
    for (const player of [own, friend]) {
      assert.ok(spawnPoints.some(([x, z]) => player.x === x && player.z === z), `${mapId}/${mode.id}: ${player.name} starts at a defined spawn (${player.x},${player.z})`);
    }
    if (mode.team) {
      assert.equal(own.z, 19, 'Red host spawns at southern edge');
      assert.equal(friend.z, -19, 'Blue guest spawns at northern edge');
    }
    await leave(host); await leave(guest);
    console.log(`Configuration passed: ${mapId}/${mode.id}, solo + two browser peers.`);
  }
  assert.deepEqual(errors, [], 'no JavaScript exceptions');
} finally {
  if (browser) await browser.close();
  await server.close();
}

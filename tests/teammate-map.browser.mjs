import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fixture, until, observer } from './helpers/loot-browser.js';
import { observeGame, touchControls } from './helpers/traversal-browser.js';

// Real UI/controls and passive heap/socket/pixel reads: catches missing friendly
// markers, stale maps, enemy disclosure, and map menus retaining live input.
const maps = ['courtyard', 'dust-town', 'neon-city', 'snow-base', 'jungle-ruins', 'harbor', 'desert-fort', 'space-station'];
const f = await fixture({ width: 1200, height: 700 }, { legacy: process.env.LEGACY_WEBVIEW === '1' });
const page = f.pages[0];
const output = `artifacts/teammate-map-browser/${Date.now()}`;
await mkdir(output, { recursive: true });
const leave = async p => {
  await p.locator('#home-button').click(); await p.locator('#confirm-home').click();
  await p.waitForSelector('body[data-mode="home"]');
};
const markerNear = (p, selector, x, z, colour) => p.locator(selector).evaluate((canvas, { x, z, colour }) => {
  // All authored arenas have hand-checked bounds [-22,22].
  const scale = (canvas.width - 24) / 44;
  const px = 12 + (x + 22) * scale, py = 12 + (z + 22) * scale;
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  for (let y = Math.max(0, Math.floor(py - 9)); y < Math.min(canvas.height, py + 10); y++) {
    for (let x = Math.max(0, Math.floor(px - 9)); x < Math.min(canvas.width, px + 10); x++) {
      const offset = (y * canvas.width + x) * 4;
      if (colour.every((v, index) => data[offset + index] === v)) return true;
    }
  }
  return false;
}, { x, z, colour });
try {
  await page.goto(f.base);
  await page.locator('#home-settings').click();
  await page.locator('#bots').fill('3'); await page.locator('#difficulty').selectOption('easy');
  await page.locator('#sound').uncheck(); await page.locator('#settings-done').click();
  for (const mapId of maps) {
    await page.locator(`[data-map="${mapId}"]`).click();
    await page.locator(`[data-mode-id="${mapId === 'courtyard' ? 'tdm' : 'ctf'}"]`).click();
    await page.locator('#home-solo').click(); await page.waitForSelector('body[data-mode="playing"]');
    assert.equal(await page.locator('#teammate-map-button').isVisible(), true, 'team rounds expose a tappable minimap');
    await page.locator('#teammate-map-button').tap();
    await page.waitForSelector('body[data-mode="team-map"]');
    const observation = await observeGame(page);
    try {
      const state = await observation.read();
      assert.equal(state.active, false, 'large solo map pauses simulation');
      assert.equal(state.mapId, mapId);
      const label = await page.locator('#teammate-map-large').getAttribute('aria-label');
      assert.match(label, /teammate/i, 'large map describes friendly markers');
      const friend = state.actors.find(a => a.id !== 'local' && !a.enemy && a.alive);
      assert.ok(friend, 'real solo round contains a friendly bot');
      assert.ok(await markerNear(page, '#teammate-map-large', friend.x, friend.z, [85, 184, 255]), 'blue marker matches actual bot position');
      assert.ok(await markerNear(page, '#teammate-map-large', state.player.x, state.player.z, [255, 228, 92]), 'yellow arrow matches actual self position');
      const clock = await page.locator('#timer').textContent();
      await page.waitForTimeout(1100);
      assert.equal(await page.locator('#timer').textContent(), clock, 'solo clock stays frozen');
      assert.deepEqual((await observation.read()).actors, state.actors, 'bots freeze with the solo map open');
      if (mapId === 'courtyard') await page.screenshot({ path: `${output}/large-solo.png` });
    } finally { await observation.close(); }
    await page.locator('#teammate-map-close').tap(); await page.waitForSelector('body[data-mode="playing"]');
    await leave(page);
    assert.equal(await page.locator('#teammate-map-screen').isHidden(), true, 'Home removes old map');
  }
  console.log('PASS all eight solo team maps, friendly bot/self pixel positions and pause');

  for (const modeId of ['ffa', 'zombies']) {
    await page.locator(`[data-mode-id="${modeId}"]`).click();
    await page.locator('#home-solo').click(); await page.waitForSelector('body[data-mode="playing"]');
    assert.equal(await page.locator('#teammate-map-button').isHidden(), true, 'non-team modes never mislabel enemies as friends');
    await leave(page);
  }
  await page.locator('[data-map="courtyard"]').click(); await page.locator('[data-mode-id="tdm"]').click();
  await page.locator('#home-solo').click(); await page.waitForSelector('body[data-mode="playing"]');
  const controls = await touchControls(page);
  try {
    const fire = await controls.point('#fire-button', 11), stick = await controls.point('#joystick', 12);
    await controls.send('touchStart', [fire, stick]);
    await controls.send('touchMove', [fire, { ...stick, x: stick.x + 24 }]);
    await page.waitForTimeout(180);
    await page.locator('#teammate-map-button').click();
    await page.waitForSelector('body[data-mode="team-map"]');
    const ammunition = await page.locator('#ammo-count').textContent();
    assert.equal(await page.locator('#joystick-knob').evaluate(e => e.style.transform), '', 'map clears held movement');
    await page.locator('#teammate-map-close').click();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#ammo-count').textContent(), ammunition, 'closing map does not restart held fire');
    await controls.send('touchEnd');
    await page.locator('#teammate-map-button').tap();
    await page.evaluate(() => window.pauseGame());
    await page.waitForSelector('body[data-mode="paused"]');
    assert.equal(await page.locator('#teammate-map-screen').isHidden(), true, 'native/background pause dismisses map');
    await page.locator('#resume-button').click();
    await page.locator('#teammate-map-button').tap(); await page.keyboard.press('Escape');
    await page.waitForSelector('body[data-mode="paused"]');
    await page.locator('#resume-button').click(); await leave(page);
  } finally { await controls.close(); }
  console.log('PASS held touch cleanup, background pause, Escape, and clean resume');

  // Three real browsers: host/friend red, enemy blue. No test writes to game state.
  for (const [mapId, modeId] of [['courtyard', 'tdm'], ['harbor', 'ctf']]) {
  for (const packets of f.packets) packets.length = 0;
  const enemyContext = await f.browser.newContext({ viewport: { width: 1200, height: 700 }, hasTouch: true });
  const enemy = await enemyContext.newPage();
  const enemyErrors = [];
  enemy.on('pageerror', error => enemyErrors.push(error.message));
  const friend = f.pages[1], hostPeer = observer(f, 0), friendPeer = observer(f, 1);
  const sent = [];
  page.on('websocket', socket => socket.on('framesent', frame => sent.push(JSON.parse(String(frame.payload)))));
  for (const [p, name] of [[page, 'MapHost'], [enemy, 'EnemyOnly'], [friend, 'MapFriend']]) {
    await p.goto(f.base); await p.locator(`[data-map="${mapId}"]`).click();
    await p.locator(`[data-mode-id="${modeId}"]`).click();
    await p.locator('#home-online').click(); await p.locator('#player-name').fill(name);
    await p.locator('.server-settings').evaluate(e => { e.open = true; });
    await p.locator('#server-address').fill(f.base);
  }
  await page.locator('#create-room').click(); await page.locator('#room-lobby:not([hidden])').waitFor();
  const code = await page.locator('#room-code').textContent();
  for (const p of [enemy, friend]) {
    await p.locator('#room-code-input').fill(code); await p.locator('#join-room').click();
    await p.locator('#room-lobby:not([hidden])').waitFor();
  }
  await until(async () => await page.locator('#room-roster .roster-player').count() === 3, 'three real participants joined');
  await page.locator('#start-online').click();
  await Promise.all([page, enemy, friend].map(p => p.waitForSelector('body[data-mode="playing"]')));
  await until(() => hostPeer.player && friendPeer.player, 'live snapshots');
  assert.equal(hostPeer.player.teamId, friendPeer.player.teamId, 'third entrant really is a teammate');
  await page.locator('#teammate-map-button').tap();
  await page.waitForSelector('body[data-mode="team-map"]');
  assert.match(await page.locator('#teammate-map-notice').textContent(), /live|attacked/i);
  await until(async () => (await page.locator('#teammate-map-large').getAttribute('aria-label')).includes('MapFriend'), 'friendly name appears');
  assert.doesNotMatch(await page.locator('#teammate-map-large').getAttribute('aria-label'), /EnemyOnly/, 'enemy name is not exposed on map');
  const time = hostPeer.room.timeLeft, start = { x: friendPeer.player.x, z: friendPeer.player.z };
  const sendIndex = sent.length;
  await friend.keyboard.down('KeyD');
  try {
    await until(() => Math.hypot(friendPeer.player.x - start.x, friendPeer.player.z - start.z) > 2, 'friend moves while host studies map');
  } finally { await friend.keyboard.up('KeyD'); }
  await until(() => hostPeer.room.timeLeft < time - 1, 'online clock continues while map is open');
  await until(async () => {
    const actor = hostPeer.room.players.find(p => p.id === friendPeer.id);
    return markerNear(page, '#teammate-map-large', actor.x, actor.z, [85, 184, 255]);
  }, 'large online map tracks moving teammate');
  assert.ok(sent.slice(sendIndex).filter(p => p.type === 'input').every(p => !p.x && !p.y && !p.fire && !p.firePressed && !p.jump), 'online map emits only neutral controls');
  await page.screenshot({ path: `${output}/large-online-${modeId}.png` });
  await leave(friend);
  await until(async () => !(await page.locator('#teammate-map-large').getAttribute('aria-label')).includes('MapFriend'), 'departed teammate is removed');
  await page.locator('#teammate-map-close').tap();
  await page.waitForSelector('body[data-mode="playing"]'); await page.screenshot({ path: `${output}/small-online-${modeId}.png` });
  await leave(page); await leave(enemy);
  assert.deepEqual(enemyErrors, [], 'third participant has no runtime errors');
  await enemyContext.close();
  console.log(`PASS ${modeId} live online teammate map on ${mapId}`);
  }
  await page.locator('#home-solo').click(); await page.waitForSelector('body[data-mode="playing"]');
  await page.locator('#teammate-map-button').tap();
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#teammate-map-close').evaluate(e => e === document.activeElement), true, 'Tab stays in map dialog');
  await page.locator('#arena').evaluate(canvas => {
    const context = canvas.getContext('webgl2') || canvas.getContext('webgl');
    context.getExtension('WEBGL_lose_context').loseContext();
  });
  await page.waitForSelector('body[data-mode="fatal"]');
  assert.equal(await page.locator('#teammate-map-screen').isHidden(), true, 'graphics failure removes map');
  await page.evaluate(() => { document.getElementById('teammate-map-close').click(); window.pauseGame(); });
  assert.equal(await page.locator('body').getAttribute('data-mode'), 'fatal', 'stale map close cannot resume a failed round');
  f.clean();
  console.log(`PASS live online teammates, no enemy labels, departure, neutral input; screenshots ${output}`);
} finally { await f.close(); }

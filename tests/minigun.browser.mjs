import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fixture, equip, onlinePair, moveTo, lookTo, lookAt, until } from './helpers/loot-browser.js';
import { persistentFixture, goHome } from './helpers/progression-browser.js';
import { observeGame, touchControls } from './helpers/traversal-browser.js';

// Catches missing catalog/UI integration, single-shot touch handling, free ammo
// on reload/equip, forgotten saved selection, narrow spread, and rejected or
// divergent online minigun damage/drop/pickup state. All changes use real UI;
// heap/socket observations are read-only and servers belong to this test.
const artifacts = process.env.ARTIFACT_DIR || 'artifacts/minigun-browser';
const legacy = process.env.LEGACY_WEBVIEW === '1';
const variant = legacy ? 'legacy' : 'modern';
await mkdir(artifacts, { recursive: true });
const ammo = async page => ({ loaded: Number(await page.locator('#ammo-count').textContent()), reserve: Number(await page.locator('#reserve-count').textContent()) });

async function selectHome(page, id = 'minigun', classId = 'lmg') {
  await page.locator('#home-armory').tap();
  await page.locator(`[data-class="${classId}"]`).tap();
  assert.equal(await page.locator(`[data-weapon="${id}"]`).count(), 1, `${id} is selectable in its real Armory class`);
  await page.locator(`[data-weapon="${id}"]`).tap();
  if (id === 'minigun') {
    assert.equal(await page.locator('#selected-name').textContent(), 'Minigun');
    assert.match(await page.locator(`[data-weapon="${id}"]`).textContent(), /AUTOMATIC.*200 ROUNDS/);
  }
  await page.locator('#armory-home').tap();
}

async function boundedControls(page) {
  const { width, height } = page.viewportSize();
  for (const selector of ['#fire-button', '#reload-button', '#loadout-button']) {
    const box = await page.locator(selector).boundingBox();
    assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1, `${selector} is fully reachable at ${width}x${height}`);
  }
}

async function heldTouch(page, peer) {
  const controls = await touchControls(page);
  const before = await ammo(page), start = await page.evaluate(() => window.__lootObservation.seconds);
  try {
    await controls.send('touchStart', [await controls.point('#fire-button', 71)]);
    await page.waitForFunction(start => window.__lootObservation.seconds - start >= .65, start, { timeout: 15000 });
  } finally { await controls.send('touchEnd'); await controls.close(); }
  const after = await ammo(page);
  assert.ok(before.loaded - after.loaded >= 10, `held touchscreen FIRE rapidly consumes rounds: ${before.loaded} → ${after.loaded}`);
  assert.equal(after.reserve, before.reserve, 'firing consumes loaded rounds only');
  if (peer) {
    // Online HUD prediction can reconcile after release. Wait on advancing
    // authoritative snapshots, not a wall-clock delay or a frozen client.
    let stock, since;
    await until(() => {
      const current = peer.player.ammo;
      if (current !== stock) { stock = current; since = peer.room.timeLeft; }
      return stock > 0 && since - peer.room.timeLeft >= .5;
    }, 'released touch FIRE stops authoritative ammo across advancing snapshots', 15000);
    await until(async () => (await ammo(page)).loaded === peer.player.ammo, 'released HUD reconciles with authoritative ammo');
    const settled = await ammo(page);
    await page.waitForTimeout(200);
    assert.deepEqual(await ammo(page), settled, 'releasing touch FIRE stops reconciled online consumption');
    return settled;
  }
  await page.waitForTimeout(250);
  const settled = await ammo(page);
  await page.waitForTimeout(350);
  assert.deepEqual(await ammo(page), settled, 'releasing touch FIRE stops consumption');
  return settled;
}

const solo = await persistentFixture({ legacy, viewport: { width: 1024, height: 600 }, artifactDir: `${artifacts}/profile-${variant}` });
try {
  let page = solo.page;
  await page.locator('#home-settings').tap(); await page.locator('#bots').fill('1');
  await page.locator('#difficulty').selectOption('easy'); await page.locator('#sound').uncheck();
  await page.locator('#settings-done').tap();
  await selectHome(page);
  await page.reload(); await page.waitForSelector('body[data-mode="home"]');
  await page.locator('#home-armory').tap();
  assert.equal(await page.locator('[data-weapon="minigun"]').getAttribute('aria-pressed'), 'true', 'saved minigun survives page reload');
  await page.locator('#armory-home').tap();
  page = await solo.reopen();
  await page.locator('#home-armory').tap();
  assert.equal(await page.locator('[data-weapon="minigun"]').getAttribute('aria-pressed'), 'true', 'saved minigun survives browser context reopen');
  await page.locator('#armory-home').tap();
  for (const mode of ['ffa', 'tdm', 'ctf', 'zombies']) {
    await page.locator(`[data-mode-id="${mode}"]`).tap(); await page.locator('#home-solo').tap();
    await page.waitForSelector('body[data-mode="playing"]');
    assert.equal(await page.locator('#hud-weapon').textContent(), 'Minigun', `${mode} deploys selected minigun`);
    assert.deepEqual(await ammo(page), { loaded: 200, reserve: 300 }, `${mode} starts with 500 actual rounds`);
    await boundedControls(page);
    const observation = await observeGame(page);
    try { assert.equal((await observation.read()).weaponVisible, true, `${mode} renders the held weapon`); }
    finally { await observation.close(); }
    const after = await heldTouch(page);
    if (mode === 'ffa') {
      await page.screenshot({ path: `${artifacts}/minigun-held-1024-${variant}.png` });
      await page.locator('#reload-button').tap();
      await until(async () => (await ammo(page)).loaded === 200, 'actual minigun reload completes', 25000);
      assert.deepEqual(await ammo(page), { loaded: 200, reserve: after.loaded + after.reserve - 200 }, 'reload conserves all remaining rounds');
      await equip(page, 'lmg', 'minigun');
      assert.equal((await ammo(page)).loaded, 200, 'in-match LMG Armory accepts minigun');
    }
    if (mode === 'zombies') {
      await page.setViewportSize({ width: 854, height: 480 });
      await boundedControls(page); await heldTouch(page);
      await page.screenshot({ path: `${artifacts}/minigun-held-854-${variant}.png` });
    }
    await goHome(page);
    console.log(`PASS minigun real Solo ${mode}: 200+300, held touch FIRE and release`);
  }
  if (legacy) {
    const probe = await page.evaluate(() => window.__legacyProbe);
    assert.ok(probe.arenaDraws > 0, 'capability-masked WebGL1 renderer draws the minigun matches');
    assert.deepEqual(probe.lost, [], 'capability masking does not lose game contexts');
  }
  solo.clean();
} catch (error) { await solo.page.screenshot({ path: `${artifacts}/solo-failure-${variant}.png` }).catch(() => {}); throw error; }
finally { await solo.close(); }

if (!process.argv.includes('--solo')) {
  const online = await fixture({ width: 1024, height: 600 }, { legacy });
  try {
    for (const page of online.pages) { await page.goto(online.base); await selectHome(page); }
    const peers = await onlinePair(online), [page, targetPage] = online.pages, [peer, target] = peers;
    assert.notEqual(peer.id, target.id, 'independent browser contexts have distinct online identities');
    await until(() => peers.every(p => p.player.weaponId === 'minigun' && p.player.ammo === 200 && p.player.reserve === 300), 'server accepts named minigun loadouts for both independent peers');
    await lookTo(page, peer, 0, .6);
    const shotsBefore = peer.events('shot').length;
    await heldTouch(page, peer);
    const shots = peer.events('shot').slice(shotsBefore).filter(event => event.playerId === peer.id);
    assert.ok(shots.length >= 10, 'authoritative rapid gunfire reaches both clients');
    const directions = shots.map(shot => { const dx = shot.to.x - shot.from.x, dy = shot.to.y - shot.from.y, dz = shot.to.z - shot.from.z, length = Math.hypot(dx, dy, dz); return { x: dx / length, y: dy / length }; });
    assert.ok(Math.max(...directions.map(d => d.x)) - Math.min(...directions.map(d => d.x)) > .025, 'real minigun rays show broad horizontal spread');
    await until(() => target.events('shot').filter(e => e.playerId === peer.id).length >= shots.length, 'independent opponent sees rapid minigun shots');
    await moveTo(page, peer, 0, 8); await moveTo(targetPage, target, 0, 5);
    await lookAt(page, peer, target);
    const victimLife = target.player.lifeId, victimStock = { ammo: target.player.ammo, reserve: target.player.reserve };
    await page.keyboard.down('KeyF');
    try { await until(() => peers.every(p => p.events('kill').some(e => e.playerId === peer.id && e.targetId === target.id)), 'real minigun fire eliminates opponent on both independent peers', 20000); }
    finally { await page.keyboard.up('KeyF'); }
    assert.ok(peers.every(p => p.events('hit').some(e => e.playerId === peer.id && e.targetId === target.id)), 'both peers observe actual minigun damage');
    let drop;
    await until(() => {
      drop = peer.room.gear.loot.find(item => item.source === 'drop' && item.item.weaponId === 'minigun');
      return drop && target.room.gear.loot.some(item => item.id === drop.id);
    }, 'victim minigun drop is visible on both independent peers');
    assert.deepEqual({ ammo: drop.item.ammo, reserve: drop.item.reserve }, victimStock, 'death drop carries victim actual ammo');
    assert.ok(target.player.lifeId >= victimLife, 'victim lifecycle remains authoritative');
    await equip(page, 'smg', 'mp5');
    await moveTo(page, peer, drop.x, drop.z);
    await until(() => peer.equipment.owned.some(gun => gun.weaponId === 'minigun'), 'real walking collects dropped minigun');
    await until(() => peers.every(p => p.events('pickup').some(e => e.playerId === peer.id && e.itemId === drop.id)), 'both peers observe the same minigun pickup');
    await equip(page, 'lmg', 'minigun');
    assert.deepEqual(await ammo(page), { loaded: victimStock.ammo, reserve: victimStock.reserve }, 'equipping loot preserves its actual ammunition');
    await lookTo(page, peer, 0, .6); const preserved = await heldTouch(page, peer);
    await equip(page, 'lmg', 'm249'); await equip(page, 'lmg', 'minigun');
    assert.deepEqual(await ammo(page), preserved, 'switching away and back preserves spent minigun ammo');
    await until(() => peer.player.ammo === preserved.loaded && peer.player.reserve === preserved.reserve, 'HUD preserved ammo agrees with server');
    await writeFile(`${artifacts}/online-proof-${variant}.json`, JSON.stringify({ peerIds: peers.map(p => p.id), shots, drop, preserved, kills: peer.events('kill') }, null, 2));
    await page.screenshot({ path: `${artifacts}/minigun-online-${variant}.png` });
    online.clean(); console.log('PASS minigun independent online peers: rapid spread, damage, death drop, loot pickup, ammo-preserving equip');
  } catch (error) { await online.pages[0].screenshot({ path: `${artifacts}/online-failure-${variant}.png` }).catch(() => {}); throw error; }
  finally { await online.close(); }
}

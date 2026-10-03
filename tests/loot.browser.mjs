import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fixture, freshSolo, emptyControls, soloLoot, equip, walkSolo, onlinePair, moveTo, lookTo, lookAt, deadSnapshot, until, selectGrenade } from './helpers/loot-browser.js';

const f = await fixture();
try {
  await freshSolo(f.pages[0], f.base);
  await emptyControls(f.pages[0]);
  console.log('PASS new match exposes disabled loot controls before collecting equipment');
  const page = f.pages[0];
  await soloLoot(page);
  assert.equal(await page.locator('#hud-weapon').textContent(), 'M4A1', 'automatic pickups never equip a gun');
  await page.locator('#loadout-button').click();
  await page.locator('[data-equipment-tab="carried"]').click();
  assert.ok(await page.locator('[data-carried-weapon]').count() > 1, 'walking also collected a distinct gun');
  await page.locator('#armory-cancel').click();
  await page.locator('#resume-button').click();
  await page.locator('#knife-button').click();
  await page.waitForFunction(() => document.querySelector('#fire-button small').textContent === 'SLASH');
  await page.locator('#knife-button').click();
  await equip(page, 'smg', 'mp5');
  await page.locator('#loadout-button').click();
  await page.locator('[data-equipment-tab="armory"]').click();
  await page.locator('[data-class="assault"]').click();
  await page.waitForFunction(() => document.querySelector('[data-weapon="m4a1"]').getAttribute('aria-disabled') === 'true');
  assert.equal(await page.locator('[data-weapon="m4a1"]').getAttribute('aria-disabled'), 'true', 'first actual replacement locks the original gun');
  assert.match(await page.locator('[data-weapon="m4a1"]').textContent(), /Find this gun as loot/);
  await page.locator('#armory-cancel').click();
  await page.locator('#resume-button').click();
  // Recover the original gun in the rear left lane at (-10,18).
  // Keep x=-3 through z=19 to pass the tree at (-8,17), then
  // approach from the end lane above the building at (-15,14).
  await walkSolo(page, 'KeyS', 19, 6);
  await walkSolo(page, 'KeyA', 7, 6);
  await walkSolo(page, 'KeyW', 1, 6);
  await page.locator('#loadout-button').click();
  await page.locator('[data-equipment-tab="carried"]').click();
  await page.locator('[data-carried-weapon="m4a1"]').waitFor();
  await page.locator('[data-carried-weapon="m4a1"]').click();
  await page.locator('#play-button').click();
  await page.waitForFunction(() => document.querySelector('#hud-weapon').textContent === 'M4A1');
  assert.equal(await page.locator('#hud-weapon').textContent(), 'M4A1', 'loot recovers the locked original gun');
  console.log('PASS solo authored pickups, no auto equip, mixed capacity, knife toggle, original gun lock/recovery');
  await page.locator('#home-button').click(); await page.locator('#confirm-home').click();
  await page.locator('#home-solo').click(); await emptyControls(page);
  console.log('PASS fresh round resets collected equipment');
  await resources(page);
  if (!process.argv.includes('--solo')) await online(f);
  f.clean();
} finally { await f.close(); }

async function online(f) {
  const peers = await onlinePair(f);
  await moveTo(f.pages[0], peers[0], 0, 0); await moveTo(f.pages[0], peers[0], -5, 0);
  await moveTo(f.pages[1], peers[1], 0, 0); await moveTo(f.pages[1], peers[1], -1, 0);
  await Promise.all([f.pages[0].keyboard.down('KeyD'), f.pages[1].keyboard.down('KeyA')]);
  try { await until(() => peers.every(peer => peer.events('pickup').some(event => event.itemId === 'map:courtyard:knife:1')), 'both peers observe contested knife pickup'); }
  finally { await Promise.all([f.pages[0].keyboard.up('KeyD'), f.pages[1].keyboard.up('KeyA')]); }
  const events = peers.map(peer => peer.events('pickup').filter(event => event.itemId === 'map:courtyard:knife:1'));
  assert.equal(events[0].length, 1); assert.deepEqual(events[0], events[1], 'both clients agree on exactly one contested award');
  assert.equal(peers.filter(peer => peer.equipment.knife).length, 1, 'only one independent inventory owns contested knife');
  const index = peers[0].equipment.knife ? 0 : 1, other = 1 - index;
  const page = f.pages[index], targetPage = f.pages[other], peer = peers[index], target = peers[other];
  await moveTo(targetPage, target, -3, 0);
  assert.equal(target.equipment.knife, false, 'walking over consumed slot grants no duplicate');
  await moveTo(page, peer, -2, 10);
  await moveTo(page, peer, -6, 12);
  await moveTo(page, peer, 6, 12);
  await until(() => Object.values(peer.equipment.grenades).reduce((a, b) => a + b, 0) === 3, 'real walks collect one of each grenade');
  assert.deepEqual(peer.equipment.grenades, { frag: 1, smoke: 1, flash: 1 });
  assert.equal(peer.equipment.activeGunId, 'm4a1', 'online pickups preserve equipped gun');
  await moveTo(page, peer, 0, 8); await moveTo(targetPage, target, 0, -4);
  await lookTo(targetPage, target, Math.PI);
  await mkdir('artifacts/loot-review', { recursive: true });
  await targetPage.screenshot({ path: 'artifacts/loot-review/peer-visible-before-effects-1200.png' });
  const evidence = {};
  for (const type of ['flash', 'smoke', 'frag']) {
    await lookTo(page, peer, 0);
    await selectGrenade(page, type);
    const before = peer.equipment.grenades[type];
    await page.locator('#throw-button').click();
    await until(() => peers.every(p => p.events('grenade-throw').some(event => event.grenadeType === type)), `both peers see ${type} throw`);
    await until(() => peers.every(p => p.room.gear.projectiles.some(projectile => projectile.grenadeType === type)), `both peers see live ${type} projectile`);
    assert.equal(peer.equipment.grenades[type], before - 1, `${type} consumes exactly one grenade`);
    await until(() => peers.every(p => p.events('grenade-burst').some(event => event.grenadeType === type)), `both peers see ${type} effect`);
    const burst = peers.map(p => p.events('grenade-burst').find(event => event.grenadeType === type));
    assert.deepEqual(burst[0], burst[1], `${type} effects agree across independent sockets`);
    evidence[type] = burst[0];
    if (type === 'flash') {
      await until(() => target.player.flashRemaining > 0, 'flash visibly impairs opponent');
      await targetPage.screenshot({ path: 'artifacts/loot-review/flash-impairment-1200.png' });
      await until(() => target.player.flashRemaining === 0, 'flash recovers within its bounded duration', 5000);
      await targetPage.screenshot({ path: 'artifacts/loot-review/flash-recovered-1200.png' });
    } else if (type === 'smoke') {
      await until(() => peers.every(p => p.room.gear.smokes.length === 1), 'smoke persists on both peers');
      await targetPage.screenshot({ path: 'artifacts/loot-review/smoke-concealment-1200.png' });
      await until(() => peers.every(p => p.room.gear.smokes.length === 0), 'smoke expires and restores clear view', 11000);
      await targetPage.screenshot({ path: 'artifacts/loot-review/smoke-recovered-1200.png' });
    }
  }
  assert.deepEqual(peer.equipment.grenades, { frag: 0, smoke: 0, flash: 0 });
  // Collect another authored grenade to prove death drops unspent equipment.
  await moveTo(page, peer, -2, 10);
  await until(() => peer.equipment.grenades.flash === 1, 'respawned authored flash can be collected again', 25000);
  await moveTo(page, peer, 0, 0); await moveTo(targetPage, target, 0, -.8);
  const dx = target.player.x - peer.player.x, dz = target.player.z - peer.player.z;
  await lookTo(page, peer, Math.atan2(-dx, -dz), Math.atan2(target.player.y + 1.07 - (peer.player.y + 1.65), Math.hypot(dx, dz)));
  await lookAt(targetPage, target, peer);
  await page.locator('#knife-button').click();
  await until(() => peer.player.heldItem === 'knife', 'knife selection reaches server');
  const targetHealth = target.player.health;
  await page.locator('#fire-button').click();
  await until(() => target.player.health === targetHealth - 50, 'real close torso-aim Slash applies exactly one 50 damage knife hit');
  const oldLife = peer.player.lifeId, activeGun = peer.equipment.activeGunId;
  await lookAt(targetPage, target, peer);
  const drops = new Map(), dead = [];
  assert.equal(peer.player.health, 100, 'Headshot victim starts at full health');
  const shotsBefore = target.events('shot').filter(event => event.playerId === target.id).length;
  await targetPage.keyboard.press('KeyF');
  try {
    await until(() => {
      for (let i = 0; i < peers.length; i++) dead[i] ||= deadSnapshot(f.packets[i], peer.id, oldLife);
      return dead.every(Boolean) && dead.length === peers.length;
    }, 'one real-control headshot eliminates the full-health knife holder');
  } catch (error) {
    console.error('Death observation diagnostic:', JSON.stringify(peers.map((p, i) => ({
      player: p.player,
      deathSnapshots: f.packets[i].filter(packet => packet.room?.players.some(player => player.id === peer.id && player.lifeId === oldLife && player.health === 0)).length,
      opponentShots: p.events('shot').filter(event => event.playerId === target.id).length,
      opponentHits: p.events('hit').filter(event => event.playerId === target.id && event.targetId === peer.id).length,
      throws: p.events('grenade-throw').length,
    }))));
    throw error;
  } finally { await targetPage.keyboard.up('KeyF'); }
  assert.equal(target.events('shot').filter(event => event.playerId === target.id).length, shotsBefore + 1, 'One M4A1 shot suffices for the approved headshot kill');
  for (const messages of f.packets) for (const packet of messages) for (const item of packet.room?.gear?.loot || []) if (item.source === 'drop') drops.set(item.id, item);
  const deaths = dead.map(packet => packet.room.players.find(player => player.id === peer.id));
  for (const player of deaths) {
    assert.equal(player.lifeId, oldLife, 'each independent stream captures the same old life');
    assert.equal(player.health, 0); assert.equal(player.ammo, 0); assert.equal(player.reserve, 0);
    assert.equal(player.heldItem, 'gun', 'public dead state no longer holds the collected knife');
  }
  const deadEnvelope = dead[index].equipment;
  assert.equal(deadEnvelope.playerId, peer.id, 'private stock belongs only to holder');
  assert.equal(deadEnvelope.lifeId, oldLife, 'dead stock binds the captured public death life');
  assert.deepEqual(deadEnvelope.equipment.owned, [], 'captured dead collected inventory clears');
  assert.equal(deadEnvelope.equipment.knife, false);
  assert.deepEqual(deadEnvelope.equipment.grenades, { frag: 0, smoke: 0, flash: 0 });
  for (const p of peers) {
    assert.ok(p.events('shot').some(event => event.playerId === target.id), 'both peers observe actual opponent gunfire');
    assert.ok(p.events('hit').some(event => event.playerId === target.id && event.targetId === peer.id), 'both peers observe actual opponent damage');
  }
  const kills = peers.map(p => p.events('kill').filter(event => event.playerId === target.id && event.targetId === peer.id));
  assert.equal(kills[0].length, 1); assert.deepEqual(kills[0], kills[1], 'both peers agree on exactly one gun elimination');
  assert.equal([...drops.values()].filter(drop => drop.item.kind === 'gun' && drop.item.weaponId === activeGun).length, 1, 'knife holder drops remembered active gun exactly once');
  assert.equal([...drops.values()].filter(drop => drop.item.kind === 'grenade' && drop.item.grenadeType === 'flash').length, 1, 'death drops exactly one unspent grenade');
  await until(() => peers.every(p => p.room.players.some(player => player.id === peer.id && player.lifeId > oldLife && player.health === 100)), 'both peers observe collected player respawn in a newer life');
  assert.equal(peer.packet.equipment.playerId, peer.id);
  assert.equal(peer.packet.equipment.lifeId, peer.player.lifeId, 'restored stock binds the newer public respawn life');
  assert.deepEqual(peer.equipment.owned.map(gun => gun.weaponId), ['m4a1']);
  assert.equal(peer.equipment.owned[0].ammo + peer.equipment.owned[0].reserve, 500);
  assert.deepEqual(peer.equipment.grenades, { frag: 0, smoke: 0, flash: 0 });
  assert.equal(peer.equipment.startingGunRemoved, false);
  evidence.death = { oldLife, publicDeaths: deaths, cleared: deadEnvelope, kills: kills[0], drops: [...drops.values()], restored: peer.equipment };
  await writeFile('artifacts/loot-review/peer-proof.json', JSON.stringify(evidence, null, 2));
  console.log('PASS independent peers: contested loot, three projectiles/effects, flash recovery, smoke expiry, 50 damage knife, one death drop/reset');
}

async function resources(page) {
  const samples = [];
  for (let cycle = 0; cycle < 3; cycle++) {
    for (const [map, skin] of [['dust-town', 'robo-unit'], ['neon-city', 'space-guard'], ['courtyard', 'ranger']]) {
      await page.locator('#home-button').click(); await page.locator('#confirm-home').click();
      await page.locator(`[data-map="${map}"]`).click(); await page.locator(`[data-skin="${skin}"]`).click();
      await page.locator('#home-solo').click(); await page.waitForSelector('body[data-mode="playing"]');
      for (const [classId, id] of [['assault', 'ak47'], ['sniper', 'awp'], ['smg', 'mp5']]) await equip(page, classId, id);
    }
    await page.waitForTimeout(150);
    samples.push(await page.evaluate(() => structuredClone(window.__lootObservation)));
  }
  for (const kind of ['Buffer', 'Texture', 'Program', 'Shader', 'Framebuffer', 'Renderbuffer']) {
    const growth = (samples[2].live[kind] || 0) - (samples[0].live[kind] || 0);
    assert.ok(growth <= (kind === 'Buffer' ? 128 : 16), `repeated map/skin/weapon transitions bound live WebGL ${kind}: ${JSON.stringify(samples.map(s => s.live[kind]))}`);
  }
  await writeFile('artifacts/loot-review/resources.json', JSON.stringify({ renderer: 'Chromium ANGLE SwiftShader software renderer; not physical BYD performance', cycles: 3, mapsPerCycle: 3, equipmentChangesPerCycle: 9, samples }, null, 2));
  console.log(`PASS repeated map/skin/weapon resource cleanup: ${JSON.stringify(samples.map(s => s.live))}`);
}

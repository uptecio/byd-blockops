import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fixture, freshSolo, emptyControls, soloLoot, equip, walkSolo, onlinePair, moveTo, lookTo, until, selectGrenade } from './helpers/loot-browser.js';

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
  // Return along the central lane; the skipped duplicate original gun remains at (-2,12).
  await walkSolo(page, 'KeyS', 12, 6);
  await walkSolo(page, 'KeyD', 2, 6);
  await walkSolo(page, 'KeyW', 2, 6);
  await walkSolo(page, 'KeyA', 2, 6);
  await walkSolo(page, 'KeyS', 2, 6);
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
  await moveTo(page, peer, 0, 0); await moveTo(targetPage, target, 0, -1.3);
  await lookTo(page, peer, 0); await lookTo(targetPage, target, Math.PI);
  await page.locator('#knife-button').click();
  await until(() => peer.player.heldItem === 'knife', 'knife selection reaches server');
  const targetHealth = target.player.health;
  await page.locator('#fire-button').click();
  await until(() => target.player.health === targetHealth - 50, 'real Slash applies exactly one 50 damage knife hit');
  const oldLife = peer.player.lifeId, activeGun = peer.equipment.activeGunId;
  const drops = new Map();
  await targetPage.keyboard.down('KeyF');
  try {
    await until(() => {
      for (const packet of f.packets[other]) for (const item of packet.room?.gear?.loot || []) if (item.source === 'drop') drops.set(item.id, item);
      return peers.every(p => p.room.players.find(player => player.id === peer.id).health === 0);
    }, 'opponent gun eliminates knife holder');
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
  for (const messages of f.packets) for (const packet of messages) for (const item of packet.room?.gear?.loot || []) if (item.source === 'drop') drops.set(item.id, item);
  assert.deepEqual(peer.equipment.owned, [], 'dead collected inventory clears');
  assert.equal(peer.equipment.knife, false);
  assert.equal([...drops.values()].filter(drop => drop.item.kind === 'gun' && drop.item.weaponId === activeGun).length, 1, 'knife holder drops remembered active gun exactly once');
  assert.equal([...drops.values()].filter(drop => drop.item.kind === 'grenade' && drop.item.grenadeType === 'flash').length, 1, 'death drops exactly one unspent grenade');
  await until(() => peer.player.lifeId > oldLife && peer.player.health === 100, 'collected player respawns');
  assert.deepEqual(peer.equipment.owned.map(gun => gun.weaponId), ['m4a1']);
  assert.equal(peer.equipment.owned[0].ammo + peer.equipment.owned[0].reserve, 500);
  assert.deepEqual(peer.equipment.grenades, { frag: 0, smoke: 0, flash: 0 });
  assert.equal(peer.equipment.startingGunRemoved, false);
  evidence.death = { drops: [...drops.values()], restored: peer.equipment };
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

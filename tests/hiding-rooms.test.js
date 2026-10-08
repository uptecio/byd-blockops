import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/rooms.js';
import { getWeapon } from '../src/weapons.js';
import { tickMode } from '../src/modes.js';
import { createSpatialWorld, solidBounds } from '../src/spatial.js';
import * as THREE from 'three';

function fixture(modeId = 'ffa') {
  const manager = new RoomManager({ random: () => .5 }), room = manager.create('a', 'A', 'm4a1', { modeId });
  manager.join('b', room.code, 'B'); manager.start('a');
  const a = room.players.get('a'), b = room.players.get('b'), spot = room.map.hideSpots[0];
  for (const player of [a, b]) Object.assign(player, spot.entry, { protectedRemaining: 0, grounded: true, supportId: 'ground' });
  const packet = (p = a, seq = 1, kind = 'enter', spotId = spot.id) => ({ type: 'hide-action', seq, kind, spotId, roundId: room.roundId, lifeId: p.lifeId });
  return { manager, room, a, b, spot, packet };
}
const input = (p, extra = {}) => ({ type: 'input', lifeId: p.lifeId, x: 0, y: 0, yaw: 0, pitch: 0, fire: false, firePressed: false, ...extra });

test('authoritative simultaneous entry has one winner and retries cannot apply or change another action', () => {
  const f = fixture(), { manager, room, a, b, spot, packet } = f;
  const first = manager.hideAction(a.id, packet()), other = manager.hideAction(b.id, packet(b));
  assert.equal(first.ok, true); assert.equal(other.ok, false); assert.equal(other.reason, 'Occupied');
  assert.deepEqual(manager.hideAction(a.id, packet()), first);
  assert.equal(manager.hideAction(a.id, packet(a, 1, 'exit')).ok, false);
  assert.equal(room.hidingState.occupants.size, 1); assert.equal(a.hiddenSpotId, spot.id);
  assert.equal(manager.snapshot(room).players.find(p => p.id === a.id).hiddenSpotId, spot.id);
  manager.join('late', room.code, 'Late'); assert.equal(manager.snapshot(room).players.find(p => p.id === a.id).hiddenSpotId, spot.id);
  for (const change of [{ seq: 0 }, { lifeId: a.lifeId - 1 }, { roundId: 'old-round' }, { spotId: 'foreign' }, { x: 12 }, { health: 10 }]) {
    assert.equal(manager.hideAction(a.id, { ...packet(a, 2), ...change }).ok, false);
    assert.equal(a.hiddenSpotId, spot.id);
  }
  assert.equal(manager.hideAction(a.id, packet(a, 2, 'exit')).ok, true);
  assert.equal(manager.hideAction(a.id, packet(a, 1)).ok, false); assert.equal(a.hiddenSpotId, null);
});

test('hidden movement is frozen, look and reload work, and Fire exits before dry reload or supply gates', () => {
  for (const condition of ['dry', 'reload', 'supply']) {
    const { manager, room, a, spot, packet } = fixture();
    manager.hideAction(a.id, packet());
    manager.input(a.id, input(a, { x: 1, y: 1, jump: true, yaw: .4 })); manager.tick(.05);
    assert.equal(a.x, spot.occupant.x); assert.equal(a.z, spot.occupant.z); assert.equal(a.y, spot.occupant.y); assert.equal(a.yaw, .4);
    const gun = a.equipment.owned.get(a.weaponId);
    if (condition === 'dry') gun.ammo = gun.reserve = 0;
    if (condition === 'reload') { gun.ammo = 1; manager.input(a.id, input(a, { reload: true })); manager.tick(.01); assert.ok(gun.reloadRemaining > 0); }
    if (condition === 'supply') { a.health = 30; a.equipment.supplies.health = 1; assert.equal(manager.equipmentAction(a.id, { type: 'equipment-action', seq: 1, lifeId: a.lifeId, kind: 'use-supply', supplyType: 'health' }).ok, true); }
    const ammo = gun.ammo;
    manager.input(a.id, input(a, { fire: true, firePressed: true }));
    assert.equal(a.hiddenSpotId, null, 'input receipt exposes immediately'); assert.equal(a.x, spot.exit.x); assert.equal(a.z, spot.exit.z);
    manager.tick(.01); assert.equal(gun.ammo, ammo, condition); assert.equal(room.hidingState.occupants.size, 0);
  }
});

test('queued Fire followed by Hide in the same tick cannot originate a concealed shot', () => {
  const { manager, room, a, spot, packet } = fixture();
  manager.input(a.id, input(a, { firePressed: true })); manager.hideAction(a.id, packet()); manager.tick(.01);
  assert.equal(a.hiddenSpotId, null);
  const shot = room.events.find(event => event.type === 'shot'); assert.ok(shot); assert.equal(shot.from.x, spot.exit.x); assert.equal(shot.from.z, spot.exit.z);
});

test('throw actions expose synchronously before supplies and ammo, but selection and invalid identity do not', () => {
  for (const condition of ['valid', 'empty', 'supply']) {
    const { manager, room, a, spot, packet } = fixture(); manager.hideAction(a.id, packet());
    const throwAction = { type: 'equipment-action', seq: 2, lifeId: a.lifeId, kind: 'throw', grenadeType: 'frag' };
    if (condition !== 'empty') a.equipment.grenades.frag = 1;
    if (condition === 'supply') { a.health = 30; a.equipment.supplies.health = 1;
      assert.equal(manager.equipmentAction(a.id, { type: 'equipment-action', seq: 1, lifeId: a.lifeId, kind: 'use-supply', supplyType: 'health' }).ok, true); }
    assert.equal(manager.equipmentAction(a.id, { ...throwAction, lifeId: 0 }).ok, false); assert.equal(a.hiddenSpotId, spot.id);
    const result = manager.equipmentAction(a.id, throwAction); assert.equal(a.hiddenSpotId, null);
    assert.equal(result.ok, condition === 'valid'); assert.equal(room.gearCombatState.projectiles.length, condition === 'valid' ? 1 : 0);
    if (condition === 'valid') { const g = room.gearCombatState.projectiles[0]; assert.ok(Math.abs(Math.hypot(g.x - spot.exit.x, g.z - spot.exit.z) - .45) < 1e-8); }
  }
});

test('spot gun damage excludes headshot bonus, ejects on armour, and dedupes lethal XP/loot', () => {
  const { manager, room, a, b, spot, packet } = fixture();
  manager.hideAction(a.id, packet());
  const dx = spot.entry.x - spot.occupant.x, dz = spot.entry.z - spot.occupant.z, length = Math.hypot(dx, dz);
  Object.assign(b, { x: spot.occupant.x - dx / length * 2, z: spot.occupant.z - dz / length * 2, yaw: Math.atan2(-dx, -dz) });
  const spatial = createSpatialWorld({ ...room.map, solids: room.map.solids.filter(s => spot.shellIds.includes(s.id)) });
  room.physics = { spatial, solids: spatial.solids, wallBoxes: spatial.solids.map(s => { const q = solidBounds(s); return new THREE.Box3(new THREE.Vector3(q.min.x, q.min.y, q.min.z), new THREE.Vector3(q.max.x, q.max.y, q.max.z)); }) };
  a.armour = 100; manager.shoot(room, b, getWeapon('m4a1')); assert.equal(a.health, 100); assert.equal(a.armour, 100 - getWeapon('m4a1').damage); assert.equal(a.hiddenSpotId, null);
  manager.hideAction(a.id, packet(a, 2)); a.armour = 0; a.health = 1;
  manager.shoot(room, b, getWeapon('m4a1')); manager.shoot(room, b, getWeapon('m4a1'));
  assert.equal(b.kills, 1); assert.equal(b.progression.eliminations, 1); assert.equal(room.hidingState.occupants.size, 0);
  assert.ok(room.lootState.drops.length > 0); assert.ok(room.lootState.drops.every(d => Math.hypot(d.x - spot.exit.x, d.z - spot.exit.z) < .36));
});

test('hidden and rooftop flag carriers drop at safe support on departure; spawn and rematch clear occupancy', () => {
  for (const hide of [false, true]) {
    const { manager, room, a, spot, packet } = fixture('ctf');
    Object.assign(a, room.map.bases.blue); tickMode(room.modeState, .01, manager.actors(room));
    if (hide) { Object.assign(a, spot.entry); manager.hideAction(a.id, packet()); }
    else Object.assign(a, room.map.traversal.roofs[0].point);
    manager.leave(a.id); assert.equal(room.hidingState.occupants.size, 0);
    const flag = room.modeState.flags.blue; assert.equal(flag.status, 'dropped'); assert.equal(flag.y, hide ? 0 : 2.2);
    if (hide) assert.equal(flag.x, spot.exit.x);
  }
  const { manager, room, a, spot, packet } = fixture(); manager.hideAction(a.id, packet());
  manager.spawn(room, a); assert.equal(a.hiddenSpotId, null); assert.equal(room.hidingState.occupants.size, 0);
  Object.assign(a, spot.entry); manager.hideAction(a.id, packet(a, 2)); room.phase = 'ended'; manager.start(a.id);
  assert.equal(a.hiddenSpotId, null); assert.equal(room.hidingState.occupants.size, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/rooms.js';
import { pickupEquipment } from '../src/equipment.js';

function pair(modeId = 'ffa') {
  const manager = new RoomManager({ random: () => .5 });
  const room = manager.create('p1', 'Host', 'ak47', { modeId });
  manager.join('p2', room.code, 'Guest', 'g17'); manager.start('p1');
  return { manager, room, a: room.players.get('p1'), b: room.players.get('p2') };
}
const action = (p, seq, fields) => ({ type: 'equipment-action', lifeId: p.lifeId, seq, ...fields });
const put = (p, x, z) => Object.assign(p, { x, z, y: 0, yaw: 0, pitch: 0, protectedRemaining: 0 });

test('duplicate equipment action cannot alter inventory', () => {
  const { manager, a } = pair();
  const packet = action(a, 1, { kind: 'equip-gun', weaponId: 'mp5', source: 'armory' });
  assert.equal(manager.equipmentAction('p1', packet).ok, true);
  const once = manager.equipmentSnapshot('p1');
  assert.equal(manager.equipmentAction('p1', packet).ok, false);
  assert.deepEqual(manager.equipmentSnapshot('p1'), once);
  assert.equal(manager.equipmentAction('p1', action(a, 2, { kind: 'equip-gun', weaponId: 'ak47', source: 'armory' })).reason, 'Find this gun as loot');
  pickupEquipment(a.equipment, { kind: 'gun', weaponId: 'ak47', ammo: 3, reserve: 7 });
  assert.equal(manager.equipmentAction('p1', action(a, 3, { kind: 'equip-gun', weaponId: 'ak47', source: 'inventory' })).ok, true);
  manager.equipmentAction('p1', action(a, 4, { kind: 'equip-gun', weaponId: 'mp5', source: 'armory' }));
  manager.equipmentAction('p1', action(a, 5, { kind: 'equip-gun', weaponId: 'ak47', source: 'inventory' }));
  assert.equal(a.equipment.owned.get('ak47').ammo, 3);
});

test('life guards, shared sequence and loadout restrictions survive death and round transitions', () => {
  const { manager, room, a } = pair();
  assert.throws(() => manager.setLoadout('p1', 'mp5'), /round|progress/i);
  const old = action(a, 1, { kind: 'equip-gun', weaponId: 'mp5', source: 'armory' });
  manager.equipmentAction('p1', old);
  assert.equal(manager.equipmentAction('p1', action(a, 1, { kind: 'select-grenade', grenadeType: 'flash' })).ok, false);
  manager.eliminate(room, 'p2', a); const dead = manager.equipmentSnapshot('p1');
  assert.equal(manager.equipmentAction('p1', action(a, 2, { kind: 'equip-gun', weaponId: 'g17', source: 'armory' })).ok, false);
  assert.deepEqual(manager.equipmentSnapshot('p1'), dead);
  manager.tick(2.6);
  assert.equal(manager.equipmentAction('p1', { ...old, seq: 99 }).ok, false);
  assert.equal(a.equipment.activeGunId, 'ak47');
  assert.equal(manager.equipmentAction('p1', action(a, 1, { kind: 'select-grenade', grenadeType: 'flash' })).ok, false);
  manager.tick(180); manager.setLoadout('p1', 'g17'); manager.start('p1');
  assert.equal(a.equipment.startingGunId, 'g17');
  assert.equal(manager.equipmentAction('p1', action(a, 1, { kind: 'select-grenade', grenadeType: 'flash' })).ok, false);
});

test('one contested pickup and exactly one active-gun death drop with a valid empty dead inventory', () => {
  const { manager, room, a, b } = pair();
  const slot = room.lootState.slots.find(s => s.item.kind === 'knife');
  put(a, slot.x, slot.z); put(b, slot.x, slot.z); manager.tick(1 / 30);
  assert.equal(a.equipment.knife, true); const secondPickupGranted = b.equipment.knife;
  assert.equal(secondPickupGranted, false);
  pickupEquipment(a.equipment, { kind: 'grenade', grenadeType: 'frag' });
  manager.equipmentAction('p1', action(a, 1, { kind: 'held-item', heldItem: 'knife' }));
  manager.eliminate(room, 'p2', a); manager.eliminate(room, 'p2', a);
  assert.equal(room.lootState.drops.length, 2); assert.equal(b.kills, 1); assert.equal(a.deaths, 1);
  const publicPlayer = manager.snapshot(room).players.find(p => p.id === a.id);
  assert.equal(publicPlayer.ammo, 0); assert.equal(publicPlayer.reserve, 0); assert.equal(publicPlayer.reloadRemaining, 0);
  assert.deepEqual(manager.equipmentSnapshot('p1').equipment.owned, []);
});

test('late starter coverage includes all captured loadouts and never active armory choices', () => {
  const { manager, room, a } = pair();
  manager.equipmentAction(a.id, action(a, 1, { kind: 'equip-gun', weaponId: 'mp5', source: 'armory' }));
  const ids = ['awp', 'm4a1', 'p90', 'scar', 'mp7', 'famas'];
  for (const [i, id] of ids.entries()) manager.join(`late${i}`, room.code, 'Late', id);
  for (const p of room.players.values()) assert.ok(room.lootState.slots.some(s => s.item.weaponId === p.equipment.startingGunId));
  manager.tick(180); manager.start(a.id); assert.equal(a.equipment.startingGunId, 'ak47');
});

test('posthumous effects in a later life credit one elimination without replaying a throw', () => {
  const { manager, room, a, b } = pair(); put(a, 0, 5); put(b, 0, 0);
  pickupEquipment(a.equipment, { kind: 'grenade', grenadeType: 'frag' });
  manager.equipmentAction(a.id, action(a, 1, { kind: 'throw', grenadeType: 'frag' }));
  const p = room.gearCombatState.projectiles[0];
  Object.assign(p, { x: 0, y: 1.6, z: 0, vx: 0, vy: 0, vz: 0, fuseRemaining: .05 });
  const oldLife = a.lifeId;
  b.health = 50; manager.eliminate(room, b.id, a); a.respawnRemaining = .01; manager.tick(.1);
  assert.ok(a.lifeId > oldLife); assert.equal(room.gearCombatState.projectiles.length, 0);
  assert.equal(a.kills, 1); assert.equal(b.health, 0); assert.equal(b.deaths, 1);
  assert.equal(room.lootState.drops.length, 2);
  manager.tick(1 / 30); assert.equal(a.kills, 1);
});

test('knife respects teams and protection and elimination drops CTF flags', () => {
  const { manager, room, a, b } = pair('ctf'); manager.join('ally', room.code, 'Ally');
  const ally = room.players.get('ally'); put(a, 0, -18); put(b, 0, -19); put(ally, 5, 0);
  manager.tick(1 / 30); assert.equal(room.modeState.flags.blue.carrierId, a.id);
  put(ally, 0, -18.5);
  pickupEquipment(a.equipment, { kind: 'knife' }); manager.equipmentAction(a.id, action(a, 1, { kind: 'held-item', heldItem: 'knife' }));
  b.protectedRemaining = 1; manager.input(a.id, { x: 0, y: 0, yaw: 0, pitch: 0, lifeId: a.lifeId, firePressed: true }); manager.tick(1 / 30);
  assert.equal(b.health, 100); assert.equal(ally.health, 100);
  manager.tick(.65); b.protectedRemaining = 0;
  manager.input(a.id, { x: 0, y: 0, yaw: 0, pitch: 0, lifeId: a.lifeId, firePressed: true }); manager.tick(1 / 30);
  assert.equal(b.health, 50); assert.equal(ally.health, 100);
  manager.eliminate(room, b.id, a); assert.equal(room.modeState.flags.blue.status, 'dropped');
});

test('old-life fire edges cannot fire after respawn and departure creates no loot or harmful effects', () => {
  const { manager, room, a, b } = pair(); const oldLife = a.lifeId;
  manager.eliminate(room, b.id, a); manager.tick(2.6); const ammo = a.equipment.owned.get('ak47').ammo;
  manager.input(a.id, { x: 0, y: 0, yaw: 0, pitch: 0, lifeId: oldLife, firePressed: true, fire: true }); manager.tick(1 / 30);
  assert.equal(a.equipment.owned.get('ak47').ammo, ammo);
  pickupEquipment(a.equipment, { kind: 'grenade', grenadeType: 'frag' }); manager.equipmentAction(a.id, action(a, 1, { kind: 'throw', grenadeType: 'frag' }));
  Object.assign(room.gearCombatState.projectiles[0], { x: b.x, y: 1.6, z: b.z, vx: 0, vy: 0, vz: 0, fuseRemaining: .01 }); b.protectedRemaining = 0;
  const drops = room.lootState.drops.length; manager.leave(a.id); manager.tick(1 / 30);
  assert.equal(room.lootState.drops.length, drops); assert.equal(b.health, 100);
});

test('connection life identities and action ordering survive leaving for another room', () => {
  const { manager, a } = pair();
  manager.equipmentAction(a.id, action(a, 10, { kind: 'select-grenade', grenadeType: 'smoke' }));
  const delayed = action(a, 11, { kind: 'equip-gun', weaponId: 'mp5', source: 'armory' });
  manager.leave(a.id); const next = manager.create(a.id, 'Again', 'ak47'); manager.join('new', next.code, 'New'); manager.start(a.id);
  assert.equal(manager.equipmentAction(a.id, delayed).ok, false);
  assert.equal(next.players.get(a.id).equipment.activeGunId, 'ak47');
  assert.equal(manager.equipmentSnapshot(a.id).lastActionSeq, 10);
});

test('projectile and smoke capacity rejections preserve carried grenades and emit no throw', () => {
  const { manager, room, a } = pair(); pickupEquipment(a.equipment, { kind: 'grenade', grenadeType: 'frag' });
  room.gearCombatState.projectiles = Array.from({length:32}, (_, i) => ({id:`g${i}`,grenadeType:'frag'}));
  const before = structuredClone(a.equipment); const result = manager.equipmentAction(a.id, action(a, 1, {kind:'throw',grenadeType:'frag'}));
  assert.equal(result.ok, false); assert.deepEqual(a.equipment, before); assert.equal(room.gearCombatState.events.length, 0);
  room.gearCombatState.projectiles = []; room.gearCombatState.reservedSmoke = 16;
  pickupEquipment(a.equipment, { kind: 'grenade', grenadeType: 'smoke' }); const smokeBefore = structuredClone(a.equipment);
  assert.equal(manager.equipmentAction(a.id, action(a, 2, {kind:'throw',grenadeType:'smoke'})).ok, false);
  assert.deepEqual(a.equipment, smokeBefore);
});

test('explosive intents stop scoring and deaths immediately at the winning elimination', () => {
  const { manager, room, a, b } = pair(); manager.join('p3', room.code, 'Third'); const c = room.players.get('p3');
  put(a, 0, 5); put(b, 0, 0); put(c, .1, 0); b.health = c.health = 1;
  room.modeState.stats[a.id].kills = a.kills = 14;
  pickupEquipment(a.equipment, {kind:'grenade',grenadeType:'frag'});
  manager.equipmentAction(a.id, action(a, 1, {kind:'throw',grenadeType:'frag'}));
  Object.assign(room.gearCombatState.projectiles[0], {x:0,y:1.6,z:0,vx:0,vy:0,vz:0,fuseRemaining:.01});
  manager.tick(1 / 30);
  assert.equal(room.phase, 'ended'); assert.equal(a.kills, 15); assert.equal(b.deaths, 1); assert.equal(c.health, 1); assert.equal(c.deaths, 0);
  assert.equal(room.lootState.drops.length, 1); const frozen = manager.snapshot(room); manager.tick(5);
  assert.deepEqual(manager.snapshot(room), {...frozen, events:[]});
});

test('leaving permanently makes old grenades visual-only even after the same connection rejoins', () => {
  const { manager, room, a, b } = pair(); put(a, 0, 5); put(b, 0, 0);
  pickupEquipment(a.equipment, {kind:'grenade',grenadeType:'frag'});
  manager.equipmentAction(a.id, action(a, 1, {kind:'throw',grenadeType:'frag'}));
  const oldProjectile = room.gearCombatState.projectiles[0]; const ownerLifeId = oldProjectile.ownerLifeId;
  Object.assign(oldProjectile, {x:0,y:1.6,z:0,vx:0,vy:0,vz:0,fuseRemaining:.01});
  manager.leave(a.id); manager.join(a.id, room.code, 'Back', 'ak47'); const returning = room.players.get(a.id);
  const world = manager.snapshot(room).gear;
  assert.equal(world.projectiles[0].ownerId, a.id); assert.equal(world.projectiles[0].ownerLifeId, ownerLifeId);
  manager.tick(1 / 30); assert.equal(b.health, 100); assert.equal(returning.kills, 0);
  pickupEquipment(returning.equipment, {kind:'grenade',grenadeType:'frag'});
  manager.equipmentAction(a.id, action(returning, 2, {kind:'throw',grenadeType:'frag'}));
  Object.assign(room.gearCombatState.projectiles[0], {x:0,y:1.6,z:0,vx:0,vy:0,vz:0,fuseRemaining:.01});
  b.health = 50; manager.tick(1 / 30); assert.equal(returning.kills, 1); assert.equal(b.health, 0);
});

test('a gunfire death starts the full half-second unlock and thirty-second expiry', () => {
  const { manager, room, a, b } = pair(); put(a, 0, 5); put(b, 0, -5); b.health = 1;
  manager.input(a.id, {x:0,y:0,yaw:0,pitch:0,lifeId:a.lifeId,firePressed:true}); manager.tick(1 / 30);
  assert.equal(b.health, 0); assert.equal(room.lootState.drops.length, 1);
  assert.equal(room.lootState.drops[0].availableRemaining, .5); assert.equal(room.lootState.drops[0].expiresRemaining, 30);
});

test('throw suppression blocks gunfire while reload remains available', () => {
  const { manager, a } = pair(); a.equipment.owned.get('ak47').ammo--;
  pickupEquipment(a.equipment, {kind:'grenade',grenadeType:'frag'});
  manager.equipmentAction(a.id, action(a, 1, {kind:'throw',grenadeType:'frag'}));
  const gun = a.equipment.owned.get('ak47'), ammo = gun.ammo;
  manager.input(a.id, {x:0,y:0,yaw:0,pitch:0,lifeId:a.lifeId,firePressed:true}); manager.tick(1 / 30);
  assert.equal(gun.ammo, ammo);
  manager.input(a.id, {x:0,y:0,yaw:0,pitch:0,lifeId:a.lifeId,reload:true}); manager.tick(1 / 30);
  assert.ok(gun.reloadRemaining > 0);
});

test('a throw uses the latest validated aim even before the next movement tick', () => {
  const { manager, room, a } = pair(); put(a, 0, 5);
  pickupEquipment(a.equipment, {kind:'grenade',grenadeType:'frag'});
  manager.input(a.id, {x:0,y:0,yaw:Math.PI / 2,pitch:0,lifeId:a.lifeId});
  assert.equal(manager.equipmentAction(a.id, action(a, 1, {kind:'throw',grenadeType:'frag'})).ok, true);
  assert.equal(room.gearCombatState.projectiles[0].vx, -12);
  assert.ok(Math.abs(room.gearCombatState.projectiles[0].vz) < 1e-8);
});

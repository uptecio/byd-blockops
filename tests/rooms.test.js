import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/rooms.js';
import { pickupEquipment } from '../src/equipment.js';

function pair() {
  const manager = new RoomManager({ random: () => 0.5 });
  const room = manager.create('a', '<Alex>\n', 'awp');
  manager.join('b', room.code.toLowerCase(), 'Bo', 'm4a1');
  return { manager, room, a: room.players.get('a'), b: room.players.get('b') };
}

test('codes, sanitized names, host rules, capacity and host transfer', () => {
  const { manager, room, a } = pair();
  assert.match(room.code, /^[A-Z2-9]{6}$/);
  assert.equal(a.name, 'Alex');
  assert.throws(() => manager.start('b'), /host/i);
  for (let i = 2; i < 8; i++) manager.join(String(i), room.code, 'Guest', 'g17');
  assert.throws(() => manager.join('ninth', room.code, 'Guest', 'g17'), /full/i);
  assert.throws(() => manager.join('other', 'NOPE00', 'Guest', 'g17'), /found/i);
  manager.leave('a');
  assert.equal(room.hostId, 'b');
  for (const id of [...room.players.keys()]) manager.leave(id);
  assert.equal(manager.rooms.size, 0);
});

test('start requires two humans and resets round state and 500 ammo', () => {
  const manager = new RoomManager();
  const room = manager.create('a', 'A', 'g17');
  assert.throws(() => manager.start('a'), /two/i);
  manager.join('b', room.code, 'B', 'm4a1');
  manager.start('a');
  const state = manager.snapshot(room);
  assert.equal(state.phase, 'playing');
  assert.equal(state.timeLeft, 180);
  assert.equal(state.players[0].ammo + state.players[0].reserve, 500);
  assert.throws(() => manager.start('a'), /progress/i);
});

test('movement expires after 300ms and client position and health are ignored', () => {
  const { manager, room, a } = pair(); manager.start('a');
  const original = a.z;
  manager.input('a', {lifeId: manager.requirePlayer('a').player.lifeId,  x: 0, y: 1, yaw: 0, pitch: 0, health: 999, position: {x:100,z:100} });
  manager.tick(0.2);
  assert.ok(a.z < original);
  assert.equal(a.health, 100);
  manager.tick(0.2); const stopped = a.z;
  manager.tick(1); assert.equal(a.z, stopped);
  assert.equal(manager.snapshot(room).phase, 'playing');
});

test('invalid input and unknown weapons cannot contaminate simulation', () => {
  const { manager, a } = pair();
  assert.throws(() => manager.setLoadout('a', 'invented'), /weapon/i);
  assert.throws(() => manager.input('a', {lifeId: manager.requirePlayer('a').player.lifeId, x:NaN,y:0,yaw:0,pitch:0}), /finite/i);
  assert.throws(() => manager.input('a', {lifeId: manager.requirePlayer('a').player.lifeId, x:0,y:0,yaw:0,pitch:0,fire:'yes'}), /boolean/i);
  assert.equal(a.weaponId, 'awp');
});

test('semi-auto shot pulse is consumed once and per-gun inventories persist', () => {
  const { manager, a } = pair(); manager.start('a');
  manager.input('a', {lifeId: manager.requirePlayer('a').player.lifeId, x:0,y:0,yaw:0,pitch:0,fire:true,firePressed:true});
  manager.tick(0.1); assert.equal(a.inventory.get('awp').ammo, 4);
  manager.tick(2); assert.equal(a.inventory.get('awp').ammo, 4);
  manager.equipmentAction('a', {type:'equipment-action',seq:1,lifeId:a.lifeId,kind:'equip-gun',weaponId:'m4a1',source:'armory'});
  pickupEquipment(a.equipment, {kind:'gun',weaponId:'awp',ammo:4,reserve:495});
  manager.equipmentAction('a', {type:'equipment-action',seq:2,lifeId:a.lifeId,kind:'equip-gun',weaponId:'awp',source:'inventory'});
  assert.equal(a.inventory.get('awp').ammo, 4);
});

test('server hitscan kills, emits events, then respawns with protection and fresh ammo', () => {
  const { manager, room, a, b } = pair(); manager.start('a');
  Object.assign(a, {x:0,z:5,y:0,protectedRemaining:0});
  Object.assign(b, {x:0,z:-5,y:0,protectedRemaining:0});
  manager.input('a', {lifeId: manager.requirePlayer('a').player.lifeId, x:0,y:0,yaw:0,pitch:0,firePressed:true}); manager.tick(1/30);
  assert.equal(b.health, 0); assert.equal(a.kills, 1); assert.equal(b.deaths, 1);
  assert.ok(b.respawnRemaining > 2.4);
  const events = manager.snapshot(room).events;
  assert.deepEqual(events.map(event => event.type), ['shot','hit','kill']);
  assert.equal(events[2].targetId, 'b');
  assert.equal(manager.snapshot(room).events.length, 0);
  manager.tick(2.6); assert.equal(b.health, 100);
  assert.ok(b.protectedRemaining > 1.8);
  assert.equal(b.inventory.get(b.weaponId).ammo + b.inventory.get(b.weaponId).reserve, 500);
});

test('arena cover and spawn protection prevent damage', () => {
  const { manager, a, b } = pair(); manager.start('a');
  Object.assign(a,{x:-8,z:7,y:0,protectedRemaining:0});
  Object.assign(b,{x:-8,z:-7,y:0,protectedRemaining:0});
  manager.input('a',{lifeId: manager.requirePlayer('a').player.lifeId, x:0,y:0,yaw:0,pitch:0,firePressed:true}); manager.tick(0.1);
  assert.equal(b.health,100);
  Object.assign(a,{x:0,z:5}); Object.assign(b,{x:0,z:-5,protectedRemaining:2});
  manager.tick(1.4); manager.input('a',{lifeId: manager.requirePlayer('a').player.lifeId, x:0,y:0,yaw:0,pitch:0,firePressed:true}); manager.tick(0.1);
  assert.equal(b.health,100);
});

test('timeout and fifteen kills end the round and host can restart', () => {
  const { manager, room, a, b } = pair(); manager.start('a');
  a.kills=2; b.kills=2; a.deaths=1; b.deaths=3;
  Object.assign(room.modeState.stats.a,{kills:2,deaths:1});Object.assign(room.modeState.stats.b,{kills:2,deaths:3});
  manager.tick(180); assert.equal(room.phase,'ended'); assert.equal(room.winnerId,null);
  manager.start('a'); assert.equal(a.kills,0);
  Object.assign(a,{x:0,z:5,y:0,kills:14,protectedRemaining:0});
  room.modeState.stats.a.kills=14;
  Object.assign(b,{x:0,z:-5,y:0,protectedRemaining:0});
  manager.input('a',{lifeId: manager.requirePlayer('a').player.lifeId, x:0,y:0,yaw:0,pitch:0,firePressed:true}); manager.tick(0.1);
  assert.equal(room.phase,'ended'); assert.equal(room.winnerId,'a');
});

test('room count is bounded and failed creates preserve the original room', () => {
  const manager = new RoomManager({maxRooms:1});
  const room=manager.create('a','A','g17');
  assert.throws(()=>manager.create('b','B','g17'), /room limit/i);
  assert.equal(manager.roomFor('a'),room);
});

test('authoritative movement cannot cross the arena wall', () => {
  const {manager,a}=pair();manager.start('a');
  Object.assign(a,{x:-8,z:5});
  for(let i=0;i<30;i++){
    manager.input('a',{lifeId: manager.requirePlayer('a').player.lifeId, x:0,y:1,yaw:0,pitch:0});manager.tick(0.1);
  }
  assert.ok(a.z>=3.5-1e-9);assert.ok(a.z<3.7);
  assert.equal(a.x,-8);
});

test('reload pulse conserves ammunition while switching to another gun', () => {
  const {manager,a}=pair();manager.start('a');
  manager.input('a',{lifeId: manager.requirePlayer('a').player.lifeId, x:0,y:0,yaw:0,pitch:0,firePressed:true});manager.tick(0.1);
  manager.input('a',{lifeId: manager.requirePlayer('a').player.lifeId, x:0,y:0,yaw:0,pitch:0,reload:true});manager.tick(0.1);
  manager.equipmentAction('a', {type:'equipment-action',seq:1,lifeId:a.lifeId,kind:'equip-gun',weaponId:'g17',source:'armory'});
  pickupEquipment(a.equipment, {kind:'gun',weaponId:'awp',ammo:4,reserve:495});
  manager.equipmentAction('a', {type:'equipment-action',seq:2,lifeId:a.lifeId,kind:'equip-gun',weaponId:'awp',source:'inventory'});
  manager.input('a', {lifeId:a.lifeId,x:0,y:0,yaw:0,pitch:0,reload:true});manager.tick(0.1);
  manager.equipmentAction('a', {type:'equipment-action',seq:3,lifeId:a.lifeId,kind:'equip-gun',weaponId:'g17',source:'armory'});manager.tick(3);
  manager.equipmentAction('a', {type:'equipment-action',seq:4,lifeId:a.lifeId,kind:'equip-gun',weaponId:'awp',source:'inventory'});
  const state=a.inventory.get('awp');assert.equal(state.ammo,5);assert.equal(state.reserve,494);
  assert.equal(state.ammo+state.reserve,499);
});

test('a multi-target shotgun blast stops damage at the fifteenth elimination', () => {
  const samples = [0, 0.5, 1, 0.5];
  let sample = 0;
  const manager = new RoomManager({ random: () => samples[sample++ % samples.length] });
  const room = manager.create('a', 'A', 'doublebarrel');
  manager.join('b', room.code, 'B', 'g17');
  manager.join('c', room.code, 'C', 'g17');
  manager.start('a');
  const a = room.players.get('a'), b = room.players.get('b'), c = room.players.get('c');
  Object.assign(a, { x: 0, z: 3, y: 0, kills: 14, protectedRemaining: 0 });
  room.modeState.stats.a.kills = 14;
  Object.assign(b, { x: -0.45, z: -3, y: 0, health: 1, protectedRemaining: 0 });
  Object.assign(c, { x: 0.45, z: -3, y: 0, health: 1, protectedRemaining: 0 });
  manager.input('a', {lifeId: manager.requirePlayer('a').player.lifeId,  x: 0, y: 0, yaw: 0, pitch: 0, firePressed: true, fire: true });
  manager.tick(1 / 30);
  assert.equal(a.kills, 15);
  assert.equal(room.phase, 'ended');
  assert.equal(room.winnerId, 'a');
  assert.equal(a.input.fire, false);
  assert.equal(b.health, 0);
  assert.equal(c.health, 1);
  assert.equal(c.deaths, 0);
  assert.equal(c.respawnRemaining, 0);
  const events = manager.snapshot(room).events;
  assert.deepEqual(events.map(event => event.type), ['shot', 'hit', 'kill']);
  assert.equal(events.at(-1).targetId, 'b');
  manager.tick(10);
  assert.equal(a.kills, 15);
  assert.equal(manager.snapshot(room).events.length, 0);
});

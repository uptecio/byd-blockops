import test from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION } from '../src/protocol.js';
import * as protocol from '../src/gear-protocol.js';
import { RoomManager } from '../server/rooms.js';
const copy = v => structuredClone(v);
function fixture() { const manager = new RoomManager(); const room = manager.create('p1', 'P1', 'ak47'); manager.join('p2', room.code, 'P2'); manager.start('p1'); return { manager, room }; }

test('current protocol equipment validates ownership, recipient, life and nested bounded records including death', () => {
  const { manager, room } = fixture(); const own = manager.snapshot(room).players[0], dto = manager.equipmentSnapshot('p1');
  assert.equal(protocol.validEquipmentSnapshot(dto, own), true);
  const invalid = [d => d.playerId = 'p2', d => d.lifeId++, d => d.lastActionSeq = -1, d => d.equipment.owned = [], d => d.equipment.owned.push(copy(d.equipment.owned[0])), d => d.equipment.grenades.frag = -1, d => d.equipment.grenades.flash = NaN, d => d.equipment.grenades.frag = 4, d => d.equipment.owned[0].reserve = 500, d => d.equipment.extra = 1];
  for (const mutate of invalid) { const value = copy(dto); mutate(value); assert.equal(protocol.validEquipmentSnapshot(value, own), false); }
  manager.eliminate(room, 'p2', room.players.get('p1')); assert.equal(protocol.validEquipmentSnapshot(manager.equipmentSnapshot('p1'), manager.snapshot(room).players[0]), true);
});

test('supply actions accept only life-scoped intentions, never effect or time claims', () => {
  const base={type:'equipment-action',seq:1,lifeId:1,kind:'use-supply',supplyType:'health'};
  assert.equal(protocol.validEquipmentAction(base),true);
  assert.equal(protocol.validEquipmentAction({...base,supplyType:'armour'}),true);
  for(const extra of [{supplyType:'bad'},{amount:100},{health:100},{remaining:0},{seq:0},{lifeId:0}]) assert.equal(protocol.validEquipmentAction({...base,...extra}),false);
  const cancel={type:'equipment-action',seq:2,lifeId:1,kind:'cancel-supply'};
  assert.equal(protocol.validEquipmentAction(cancel),true);
  assert.equal(protocol.validEquipmentAction({...cancel,supplyType:'health'}),false);
});

test('gear world rejects duplicate IDs, unknown nested items, nonfinite values and entity caps', () => {
  const { manager, room } = fixture(); const dto = manager.snapshot(room).gear;
  assert.equal(protocol.validGearWorld(dto), true);
  for (const mutate of [d => d.loot.push(copy(d.loot[0])), d => d.loot[0].item.weaponId = 'fake', d => d.loot[0].item.reserve = 500, d => d.loot[0].availableRemaining = -1, d => d.loot[0].x = NaN, d => d.loot[0].item.kind = 'health', d => d.loot[0].extra = 1]) { const value = copy(dto); mutate(value); assert.equal(protocol.validGearWorld(value), false); }
  const projectile = { id: 'g', grenadeType: 'smoke', ownerId: 'p1', ownerTeamId: null, ownerLifeId: 1, x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, fuseRemaining: 2 };
  assert.equal(protocol.validGearWorld({ loot: [], projectiles: [projectile], smokes: [] }), true);
  for (const mutate of [d => d.projectiles.push(copy(projectile)), d => d.projectiles[0].ownerLifeId = 0, d => d.projectiles[0].fuseRemaining = 3, d => d.projectiles = Array.from({ length: 33 }, (_, i) => ({ ...projectile, id: `g${i}`, grenadeType: 'frag' })), d => d.projectiles = Array.from({ length: 17 }, (_, i) => ({ ...projectile, id: `g${i}` }))]) { const value = { loot: [], projectiles: [copy(projectile)], smokes: [] }; mutate(value); assert.equal(protocol.validGearWorld(value), false); }
  const smoke = {id:'s',ownerId:'p1',x:0,y:2,z:0,radius:4,remaining:8};
  assert.equal(protocol.validGearWorld({loot:[],projectiles:[],smokes:[smoke]}), true);
  for (const mutate of [d => d.smokes[0].radius = 5, d => d.smokes[0].remaining = 9, d => d.smokes[0].remaining = NaN, d => d.projectiles[0].grenadeType = 'unknown', d => d.smokes[0].id = 'g']) {
    const world = {loot:[],projectiles:[copy(projectile)],smokes:[copy(smoke)]}; mutate(world); assert.equal(protocol.validGearWorld(world), false);
  }
  const item = copy(dto.loot[0]);
  assert.equal(protocol.validGearWorld({loot:Array.from({length:21}, (_, i) => ({...item,id:`m${i}`})),projectiles:[],smokes:[]}), false);
  assert.equal(protocol.validGearWorld({loot:Array.from({length:49}, (_, i) => ({...item,id:`d${i}`,source:'drop',expiresRemaining:30})),projectiles:[],smokes:[]}), false);
});

test('supply worlds and pickup events accept exact types and enforce 20 map plus 48 drops', () => {
  const { manager, room } = fixture(); const world = manager.snapshot(room).gear;
  const pack = world.loot.find(p => p.item.supplyType === 'health');
  assert.ok(pack);
  world.loot.push(...Array.from({ length: 48 }, (_, i) => ({ ...copy(pack), id: `d${i}`, source: 'drop', expiresRemaining: 30, availableRemaining: .5 })));
  assert.equal(world.loot.length, 68); assert.equal(protocol.validGearWorld(world), true);
  const event = { id: 1, type: 'pickup', playerId: 'p1', itemId: pack.id, item: pack.item };
  assert.equal(protocol.validGearEvent(event), true);
  for (const item of [{ kind: 'supply' }, { kind: 'supply', supplyType: 'unknown' }, { kind: 'supply', supplyType: 'health', amount: 100 }]) {
    assert.equal(protocol.validGearWorld({ ...world, loot: [{ ...pack, item }] }), false);
    assert.equal(protocol.validGearEvent({ ...event, item }), false);
  }
  world.loot.push({ ...copy(pack), id: 'extra' }); assert.equal(protocol.validGearWorld(world), false);
});

test('equipment actions and gear events require exact catalog payloads and positive safe identities', () => {
  const value = { type: 'equipment-action', seq: 1, lifeId: 1, kind: 'equip-gun', weaponId: 'mp5', source: 'armory' };
  assert.equal(protocol.validEquipmentAction(value), true);
  for (const bad of [{ ...value, seq: 0 }, { ...value, seq: 1.5 }, { ...value, lifeId: NaN }, { ...value, weaponId: 'fake' }, { ...value, source: 'loot' }, { ...value, inventory: [] }]) assert.equal(protocol.validEquipmentAction(bad), false);
  const event = { id: 1, type: 'pickup', playerId: 'p1', itemId: 'drop:1', item: { kind: 'grenade', grenadeType: 'frag' } };
  assert.equal(protocol.validGearEvent(event), true);
  assert.equal(protocol.validGearEvent({ ...event, item: { kind: 'grenade', grenadeType: 'unknown' } }), false);
  assert.equal(protocol.validGearEvent({ ...event, id: NaN }), false);
});

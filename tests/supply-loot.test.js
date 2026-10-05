import test from 'node:test';
import assert from 'node:assert/strict';
import { createEquipment, pickupEquipment, deathItems } from '../src/equipment.js';
import { createLootState, collectLoot, lootDTO, tickLoot, addDeathDrops } from '../src/loot.js';
import { startSupplyUse, advanceSupplyUse } from '../src/supplies.js';
import { lootItemLabel } from '../src/loot-labels.js';
import { GEAR_BALANCE } from '../src/equipment-catalog.js';

const create = () => createLootState({ mapId: 'courtyard', seed: 1 });
const actor = (id, p) => ({ ...p, id, alive: true, health: 40, armour: 0, equipment: createEquipment('m4a1') });
const health = state => lootDTO(state).find(p => p.item.supplyType === 'health');
const live = { active: true, alive: true };

test('nearest eligible winner skips full supply stacks independent of actor order', () => {
  for (const reverse of [false, true]) {
    const state = create(), pack = health(state), a = actor('a', pack), b = actor('b', { ...pack, x: pack.x + .2 });
    a.equipment.supplies.health = 3;
    const events = collectLoot(state, reverse ? [b, a] : [a, b], { solids: [] });
    assert.deepEqual(events.map(e => e.playerId), ['b']);
    assert.equal(b.equipment.supplies.health, 1);
    assert.equal(a.equipment.supplies.health, 3);
    assert.equal(collectLoot(state, [a, b], { solids: [] }).length, 0);
  }
});

test('pending pack occupies capacity until completion', () => {
  const state = create(), pack = health(state), a = actor('a', pack);
  a.equipment.supplies.health = 3;
  startSupplyUse(a.equipment, a, 'health', live);
  assert.equal(collectLoot(state, [a], { solids: [] }).length, 0);
  advanceSupplyUse(a.equipment, a, 5, live);
  assert.equal(collectLoot(state, [a], { solids: [] }).length, 1);
  assert.equal(a.equipment.supplies.health, 3);
  assert.equal(a.health, 100, 'full health does not stop collection');
});

test('supplies obey pickup radius height LOS and stable tied winners', () => {
  for (const [distance, y, wall, expected] of [[1.2,.75,false,true],[1.201,0,false,false],[0,.751,false,false],[.8,0,true,false]]) {
    const state = create(), pack = health(state);
    const a = actor('a', { ...pack, x: pack.x + distance, y });
    const solids = wall ? [{ x: pack.x + .4, z: pack.z, w: .1, d: 3, height: 2 }] : [];
    assert.equal(collectLoot(state, [a], { solids }).length, Number(expected));
  }
  for (const reversed of [false, true]) {
    const state = create(), pack = health(state), actors = [actor('a', pack), actor('b', pack)];
    assert.equal(collectLoot(state, reversed ? actors.reverse() : actors, { solids: [] })[0].playerId, 'a');
  }
});

test('supply map slot respawns at twenty seconds', () => {
  const state = create(), pack = health(state);
  collectLoot(state, [actor('a', pack)], { solids: [] }); tickLoot(state, 19.999);
  assert.ok(!lootDTO(state).some(p => p.id === pack.id));
  tickLoot(state, .001);
  assert.deepEqual(lootDTO(state).find(p => p.id === pack.id), pack);
});

test('one-life death drops include pending packs with unlock expiry and saturation', () => {
  const state = create(), e = createEquipment('m4a1');
  for (const type of ['health', 'armour']) for (let i = 0; i < 3; i++) pickupEquipment(e, { kind: 'supply', supplyType: type });
  startSupplyUse(e, { health: 20, armour: 0 }, 'health', live);
  const args = { actorId: 'victim', lifeId: 1, position: { x: 0, y: 0, z: 0 }, items: deathItems(e), solids: [] };
  addDeathDrops(state, args); addDeathDrops(state, args);
  assert.equal(state.drops.length, 7);
  assert.equal(state.drops.filter(p => p.item.kind === 'supply').length, 6);
  tickLoot(state, .499);
  assert.equal(collectLoot(state, [actor('a', { x: 0, y: 0, z: 0 })], { solids: [] }).length, 0);
  tickLoot(state, .001);
  const collector = actor('a', { x: 0, y: 0, z: 0 });
  assert.equal(collectLoot(state, [collector], { solids: [] }).length, 6);
  assert.deepEqual(collector.equipment.supplies, { health: 3, armour: 3 });
  addDeathDrops(state, { ...args, lifeId: 2 }); tickLoot(state, 29.999);
  assert.equal(state.drops.length, 7); tickLoot(state, .001); assert.equal(state.drops.length, 0);
  for (let lifeId = 3; lifeId < 20; lifeId++) addDeathDrops(state, { ...args, lifeId });
  assert.equal(state.drops.length, 48); assert.equal(lootDTO(state).length, 68);
  assert.ok(state.drops.every(p => Number(p.id.split(':')[1]) > 48));
  assert.equal(GEAR_BALANCE.maxMapLoot, 20); assert.equal(GEAR_BALANCE.maxLoot, 68); assert.equal(GEAR_BALANCE.maxDrops, 48);
});

test('supply labels do not use grenade fallback', () => {
  assert.equal(lootItemLabel({ kind: 'supply', supplyType: 'health' }), 'HEALTH PACK');
  assert.equal(lootItemLabel({ kind: 'supply', supplyType: 'armour' }), 'ARMOUR PACK');
  assert.equal(lootItemLabel({ kind: 'gun', weaponId: 'm4a1' }), 'M4A1');
  assert.equal(lootItemLabel({ kind: 'knife' }), 'KNIFE');
  assert.equal(lootItemLabel({ kind: 'grenade', grenadeType: 'frag' }), 'FRAG GRENADE');
  assert.throws(() => lootItemLabel({ kind: 'unknown' }), TypeError);
});

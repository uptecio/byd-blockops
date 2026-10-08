import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpatialWorld, interactionReach, dropAnchor } from '../src/spatial.js';
import { createLootState, addDeathDrops, collectLoot, tickLoot, lootDTO } from '../src/loot.js';
import { createModeState, tickMode, recordElimination, removeParticipant, getModeSnapshot } from '../src/modes.js';
import { createHidingState, requestHide, hidingDropPosition } from '../src/hiding.js';
import { createGearActor } from './helpers/equipment-fixture.js';
import { MAPS } from '../src/maps.js';

const map = { id: 'courtyard', bounds: { min: -25, max: 25 }, solids: [{ id: 'roof', x: 0, z: 0, w: 6, d: 6, minY: 2.8, maxY: 3 }],
  bases: { red: { x: 0, y: 0, z: 0 }, blue: { x: 10, y: 0, z: 0 } } };
const world = createSpatialWorld(map);
const p = (x, y = 0, z = 0) => ({ x, y, z });
const actor = (id, x, y = 0) => createGearActor(id, { ...p(x, y), teamId: id === 'a' ? 'blue' : 'red', grounded: true });
const mode = actors => createModeState({ modeId: 'ctf', map, participants: actors });
const loot = () => { const state = createLootState({ mapId: 'courtyard', seed: 1 }); state.slots = []; return state; };
const drops = (state, position, worldOverride = world) => addDeathDrops(state, { actorId: 'victim', lifeId: 1, position,
  items: [{ kind: 'knife' }, { kind: 'grenade', grenadeType: 'frag' }], solids: worldOverride.solids, world: worldOverride });

test('interaction reach respects vertical separation, cover and same-roof support', () => {
  assert.equal(interactionReach(p(0, 3), p(0), world), false);
  assert.equal(interactionReach(p(0), p(0, 3), world), false);
  assert.equal(interactionReach(p(0, 3), p(.5, 3), world), true);
  assert.equal(interactionReach(p(0), p(.5), world), true);
  assert.equal(interactionReach(p(0), p(1.20001), world), false);
  assert.equal(interactionReach(p(0), p(NaN), world), false);
  const wall = createSpatialWorld({ ...map, solids: [...map.solids, { x: .25, z: 0, w: .1, d: 4, height: 4 }] });
  assert.equal(interactionReach(p(0, 3), p(.5, 3), wall), false);
});

test('aerial and roof death drops choose the first support, preserve spread and expire once', () => {
  assert.deepEqual(dropAnchor(p(0, 3.6), world), p(0, 3));
  assert.deepEqual(dropAnchor(p(0, 2), world), p(0));
  for (const invalid of [p(0, NaN), p(0, -1), p(100, 3)]) assert.equal(dropAnchor(invalid, world), null);
  const state = loot(); drops(state, p(0, 3.6));
  assert.equal(state.drops.length, 2); assert.ok(state.drops.every(item => item.y === 3));
  assert.ok(state.drops.some(item => item.x !== 0));
  drops(state, p(0, 3)); assert.equal(state.drops.length, 2);
  assert.equal(collectLoot(state, [actor('a', 0, 3)], { world, solids: world.solids }).length, 0);
  tickLoot(state, .5);
  assert.equal(collectLoot(state, [actor('a', 0)], { world, solids: world.solids }).length, 0);
  assert.equal(collectLoot(state, [{ ...actor('a', 0, 3), hiddenSpotId: 'hide' }], { world, solids: world.solids }).length, 0);
  assert.equal(collectLoot(state, [actor('a', 0, 3)], { world, solids: world.solids }).length, 2);
  const expired = loot(); drops(expired, p(0, 3)); tickLoot(expired, 30); assert.deepEqual(lootDTO(expired), []);
});

test('blocked spread falls back to the supported death anchor and roof loot is not ground loot', () => {
  const narrowWorld = createSpatialWorld({ ...map, solids: [...map.solids,
    { id: 'edge', x: .7, z: 0, w: .1, d: 3, minY: 3, maxY: 4 }] });
  const state = loot(); drops(state, p(0, 3), narrowWorld);
  assert.deepEqual(p(state.drops[0].x, state.drops[0].y, state.drops[0].z), p(0, 3));
  const ground = loot(); drops(ground, p(0)); tickLoot(ground, .5);
  assert.equal(collectLoot(ground, [actor('a', 0, 3)], { world, solids: world.solids }).length, 0);
});

test('flags cannot be picked up, returned or captured through floors or while hidden', () => {
  const a = actor('a', 0, 3), b = actor('b', 10), state = mode([a, b]);
  assert.deepEqual(tickMode(state, .1, [a]), []); assert.equal(state.flags.red.status, 'home');
  a.y = 0; a.hiddenSpotId = 'hide'; assert.deepEqual(tickMode(state, .1, [a]), []);
  a.hiddenSpotId = null; assert.equal(tickMode(state, .1, [a])[0].type, 'flag-pickup');
  Object.assign(a, p(10), { hiddenSpotId: 'hide' });
  assert.deepEqual(tickMode(state, .1, [a]), []); assert.equal(state.teamScores.blue, 0);
  a.hiddenSpotId = null; a.y = 3; assert.deepEqual(tickMode(state, .1, [a]), []);
  a.y = 0; assert.equal(tickMode(state, .1, [a])[0].type, 'flag-capture');
  // Dropped flag remains on its roof when a friendly player walks underneath it.
  a.x = 0; tickMode(state, .1, [a]); a.y = 3;
  recordElimination(state, { killerId: b.id, victimId: a.id, lifeId: 1, position: a });
  Object.assign(b, p(0)); assert.deepEqual(tickMode(state, .1, [b]), []); assert.equal(state.flags.red.y, 3);
  b.y = 3; b.hiddenSpotId = 'hide'; assert.deepEqual(tickMode(state, .1, [b]), []);
  b.hiddenSpotId = null; assert.equal(tickMode(state, .1, [b])[0].type, 'flag-return'); assert.equal(state.flags.red.y, 0);
});

test('flag death and disconnect preserve supported Y and automatic return restores base Y', () => {
  for (const disconnect of [false, true]) {
    const a = actor('a', 0), b = actor('b', 10), state = mode([a, b]);
    tickMode(state, .1, [a]); a.y = 3.6;
    if (disconnect) removeParticipant(state, a.id, a);
    else recordElimination(state, { killerId: b.id, victimId: a.id, lifeId: 1, position: a });
    assert.equal(getModeSnapshot(state).flags.red.y, 3);
    tickMode(state, 15, []); assert.equal(state.flags.red.y, 0); assert.equal(state.flags.red.status, 'home');
  }
});

test('hidden death and departure anchors place loot and flags outside the prop', () => {
  const actualMap = MAPS[0], actualWorld = createSpatialWorld(actualMap), spot = actualMap.hideSpots[0], hiding = createHidingState();
  const a = { ...actor('a', 0), ...spot.entry }, b = actor('b', 10);
  const state = createModeState({ modeId: 'ctf', map: actualMap, participants: [a, b] });
  Object.assign(a, actualMap.bases.red); tickMode(state, .1, [a]); Object.assign(a, spot.entry);
  assert.equal(requestHide(hiding, a, { kind: 'enter', spotId: spot.id, lifeId: 1 }, { map: actualMap, world: actualWorld, active: true }).ok, true);
  const anchor = hidingDropPosition(hiding, a, actualMap), items = loot(); drops(items, anchor, actualWorld);
  removeParticipant(state, a.id, anchor);
  assert.deepEqual(p(state.flags.red.x, state.flags.red.y, state.flags.red.z), spot.exit);
  assert.ok(items.drops.length > 0); assert.ok(items.drops.every(item => Math.hypot(item.x - spot.occupant.x, item.z - spot.occupant.z) > .6));
});

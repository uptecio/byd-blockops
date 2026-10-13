import test from 'node:test';
import assert from 'node:assert/strict';
import { RANGE_MAP, RANGE_TARGETS } from '../src/range-map.js';
import { MAPS, getMap } from '../src/maps.js';
import { createSpatialWorld, canOccupyBody, segmentClear } from '../src/spatial.js';

// Catches accidental registration in normal game selectors or multiplayer map lookup.
test('private map stays out of public selectors', () => {
  assert.equal(RANGE_MAP.id, 'shooting-range');
  assert.equal(MAPS.length, 8);
  assert.equal(MAPS.some(map => map.id === 'shooting-range'), false);
  assert.throws(() => getMap('shooting-range'));
});

// Catches targets obstructed by authored walls, invalid map geometry, or unwanted bot/access data.
test('flat private range has clear spawn, six reachable targets and backstops', () => {
  assert.deepEqual(RANGE_MAP.bounds, { min: -30, max: 30 });
  assert.deepEqual(RANGE_MAP.playerSpawn, { x: -9, z: 24 });
  assert.deepEqual(RANGE_MAP.spawns, []);
  assert.deepEqual(RANGE_MAP.hideSpots, []);
  for (const key of ['roofs', 'shelters', 'links', 'patrolPoints', 'stairs', 'ladders']) {
    assert.deepEqual(RANGE_MAP.traversal[key], []);
  }
  const world = createSpatialWorld(RANGE_MAP);
  assert.equal(canOccupyBody({ ...RANGE_MAP.playerSpawn, y: 0 }, .42, 1.84, world), true);
  assert.deepEqual(RANGE_TARGETS.map(({ kind, x, y, z, label }) => ({ kind, x, y, z, label })), [
    { kind: 'dummy', x: -10.3, y: 0, z: 16, label: 'CLOSE' },
    { kind: 'bullseye', x: -7.7, y: 0, z: 16, label: 'CLOSE' },
    { kind: 'dummy', x: -1.3, y: 0, z: 4, label: 'MEDIUM' },
    { kind: 'bullseye', x: 1.3, y: 0, z: 4, label: 'MEDIUM' },
    { kind: 'dummy', x: 7.7, y: 0, z: -16, label: 'FAR' },
    { kind: 'bullseye', x: 10.3, y: 0, z: -16, label: 'FAR' },
  ]);
  assert.equal(new Set(RANGE_TARGETS.map(target => target.id)).size, 6);
  for (const target of RANGE_TARGETS) {
    assert.equal(canOccupyBody(target, .42, 1.84, world), true);
    assert.equal(segmentClear({ x: target.x, y: 1.35, z: 24 }, { x: target.x, y: 1.35, z: target.z }, world), true);
    assert.equal(segmentClear({ x: target.x, y: 1.35, z: target.z - .5 }, { x: target.x, y: 1.35, z: -35 }, world), false);
  }
  for (const solid of RANGE_MAP.solids) {
    assert.ok(RANGE_MAP.blocks.some(block => block.solidId === solid.id && block.w === solid.w
      && block.d === solid.d && block.h === solid.height));
  }
  assert.throws(() => { RANGE_TARGETS[0].x = 20; }, TypeError);
  assert.throws(() => { RANGE_MAP.solids[0].w = 20; }, TypeError);
});

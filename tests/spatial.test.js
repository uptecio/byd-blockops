import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpatialWorld, solidBounds, canOccupyBody, supportBelow, segmentClear, rayBoxHit } from '../src/spatial.js';
import { stackedFixture } from './helpers/traversal-fixture.js';
import { hasLineOfSight } from '../src/collision.js';

test('normalisation gives legacy solids stable IDs and detached explicit height bounds', () => {
  const map = { id: 'a', bounds: { min: -10, max: 10 }, solids: [{ x: 1, z: 2, w: 4, d: 6, height: 3 }] };
  const world = createSpatialWorld(map);
  assert.deepEqual(world.solids[0], { id: 'a:solid:0', x: 1, z: 2, w: 4, d: 6, minY: 0, maxY: 3, height: 3 });
  assert.deepEqual(solidBounds(world.solids[0]), { min: { x: -1, y: 0, z: -1 }, max: { x: 3, y: 3, z: 5 } });
  assert.equal(map.solids[0].minY, undefined);
});

test('invalid geometry and duplicate IDs are rejected before simulation', () => {
  const base = { id: 'a', bounds: { min: -10, max: 10 }, solids: [] };
  const box = { id: 'same', x: 0, z: 0, w: 2, d: 2, height: 3 };
  for (const patch of [{ w: 0 }, { d: -1 }, { height: NaN }, { x: Infinity }, { minY: 3, maxY: 2 }, { minY: -1, maxY: 2 }]) {
    assert.throws(() => createSpatialWorld({ ...base, solids: [{ ...box, ...patch }] }));
  }
  assert.throws(() => createSpatialWorld({ ...base, solids: [box, box] }));
  assert.throws(() => createSpatialWorld({ ...base, bounds: { min: 5, max: 0 } }));
});

test('a roof supports an actor while the space underneath stays walkable', () => {
  const { world, roof, underRoof } = stackedFixture();
  assert.deepEqual(supportBelow(roof, .4, world), { id: 'roof', y: 3 });
  assert.equal(canOccupyBody(roof, .4, 1.84, world), true);
  assert.equal(canOccupyBody(underRoof, .4, 1.84, world), true);
  assert.equal(canOccupyBody({ ...underRoof, y: 1.2 }, .4, 1.84, world), false);
  assert.deepEqual(supportBelow(underRoof, .4, world), { id: 'ground', y: 0 });
  assert.equal(supportBelow({ x: 11, y: 4, z: 0 }, .4, world), null);
});

test('occupancy permits exact contact but rejects perimeter escapes at any height', () => {
  const { world } = stackedFixture();
  assert.equal(canOccupyBody({ x: 9.6, y: 7, z: 0 }, .4, 1.84, world), true);
  assert.equal(canOccupyBody({ x: 9.61, y: 7, z: 0 }, .4, 1.84, world), false);
  assert.equal(canOccupyBody({ x: -5, y: .55, z: 0 }, .4, 1.84, world), true);
  assert.equal(canOccupyBody({ x: -5, y: .54, z: 0 }, .4, 1.84, world), false);
});

test('explicit-height line of sight blocks slabs, permits tunnels, and only ignores named shells', () => {
  const { world, roof, underRoof } = stackedFixture();
  assert.equal(segmentClear(underRoof, roof, world), false);
  assert.equal(segmentClear({ x: -4, y: 2, z: 0 }, { x: 4, y: 2, z: 0 }, world), true);
  assert.equal(segmentClear(underRoof, roof, world, { ignoreSolidIds: ['roof'] }), true);
  assert.equal(segmentClear({ x: 6, y: 2, z: 0 }, { x: 8, y: 2, z: 0 }, world, { ignoreSolidIds: ['roof'] }), false);
  assert.equal(hasLineOfSight({ x: -4, y: 2, z: 0 }, { x: 4, y: 2, z: 0 }, world.solids), true);
  assert.equal(hasLineOfSight({ x: -4, z: 0 }, { x: 4, z: 0 }, [world.solids[0]]), false);
});

test('ray hits report world distance for non-unit direction and reject out-of-range hits', () => {
  const bounds = { min: { x: -1, y: 2, z: -1 }, max: { x: 1, y: 3, z: 1 } };
  assert.deepEqual(rayBoxHit({ x: 0, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }, 10, bounds), { point: { x: 0, y: 2, z: 0 }, distance: 2 });
  assert.equal(rayBoxHit({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 1.99, bounds), null);
  assert.equal(rayBoxHit({ x: 2, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 10, bounds), null);
  assert.equal(rayBoxHit({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 10, bounds), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MAPS, DEFAULT_MAP_ID, getMap } from '../src/maps.js';
import { canOccupy, moveCircle } from '../src/collision.js';
import { createWorld } from '../src/world.js';
import { createSpatialWorld } from '../src/spatial.js';

const ids = ['courtyard', 'dust-town', 'neon-city', 'snow-base', 'jungle-ruins', 'harbor', 'desert-fort', 'space-station'];
const radius = 0.42;
const points = map => [map.playerSpawn, ...map.spawns, ...map.teamSpawns.red, ...map.teamSpawns.blue, map.bases.red, map.bases.blue];

// Catches omitted maps and accidentally reused collision layouts.
test('eight maps have distinct collision layouts', () => {
  assert.equal(MAPS.length, 8);
  assert.deepEqual(MAPS.map(map => map.id), ids);
  assert.equal(new Set(MAPS.map(map => JSON.stringify(map.solids))).size, 8);
});

test('map lookup rejects unsupported IDs instead of silently changing the arena', () => {
  assert.equal(DEFAULT_MAP_ID, 'courtyard');
  for (const id of ids) assert.equal(getMap(id).id, id);
  for (const id of ['missing', '', undefined, null, {}, 'COURTYARD']) assert.throws(() => getMap(id));
});

test('shared definitions cannot be changed by a room or renderer', () => {
  const assertFrozen = value => {
    if (!value || typeof value !== 'object') return;
    assert.ok(Object.isFrozen(value));
    for (const child of Object.values(value)) assertFrozen(child);
  };
  assertFrozen(MAPS);
  assert.throws(() => { getMap('courtyard').solids[0].w = 100; }, TypeError);
  assert.throws(() => { getMap('courtyard').teamSpawns.red.push({ x: 0, z: 0 }); }, TypeError);
});

for (const id of ids) {
  test(`${id} has finite geometry and clear spawn and base points`, () => {
    const map = getMap(id);
    assert.ok(map.name && map.description);
    for (const key of ['sky', 'fog', 'ground', 'accent']) assert.match(map.environment[key], /^#[0-9a-f]{6}$/i);
    assert.deepEqual(map.bounds, { min: -22, max: 22 });
    assert.ok(map.blocks.length > 0 && map.solids.length > 0);
    for (const block of map.blocks) {
      for (const key of ['x', 'y', 'z', 'w', 'h', 'd']) assert.ok(Number.isFinite(block[key]), `${key} must be finite`);
      for (const key of ['w', 'h', 'd']) assert.ok(block[key] > 0, `${key} must be positive`);
      assert.match(block.colour, /^#[0-9a-f]{6}$/i);
    }
    for (const solid of map.solids) {
      for (const key of ['x', 'z', 'w', 'd', 'height']) assert.ok(Number.isFinite(solid[key]));
      for (const key of ['w', 'd', 'height']) assert.ok(solid[key] > 0);
      assert.equal(solid.height, solid.maxY - solid.minY);
      assert.ok(map.blocks.some(block => block.x === solid.x && block.z === solid.z && block.w === solid.w && block.d === solid.d && block.h === solid.height && block.y === (solid.minY + solid.maxY) / 2), 'each collider matches its explicit-height rendered box');
    }
    for (const team of ['red', 'blue']) {
      assert.ok(map.teamSpawns[team].length >= 5);
      assert.equal(new Set(map.teamSpawns[team].map(point => `${point.x},${point.z}`)).size, map.teamSpawns[team].length);
    }
    assert.notDeepEqual(map.bases.red, map.bases.blue);
    const freeForAllSpawns = [map.playerSpawn, ...map.spawns];
    assert.equal(new Set(freeForAllSpawns.map(point => `${point.x},${point.z}`)).size, freeForAllSpawns.length, 'initial free-for-all combatants must not share a spawn');
    for (const point of points(map)) {
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.z));
      assert.ok(point.x >= -22 + radius && point.x <= 22 - radius);
      assert.ok(point.z >= -22 + radius && point.z <= 22 - radius);
      assert.equal(canOccupy(point.x, point.z, radius, map.solids), true, JSON.stringify(point));
    }
  });

  test(`${id} boundary walls contain movement in every direction`, () => {
    const map = getMap(id);
    for (const point of points(map)) {
      for (const [dx, dz] of [[60, 0], [-60, 0], [0, 60], [0, -60]]) {
        const moved = moveCircle(point, dx, dz, radius, map.solids);
        assert.ok(moved.x >= -22 + radius - 1e-8 && moved.x <= 22 - radius + 1e-8);
        assert.ok(moved.z >= -22 + radius - 1e-8 && moved.z <= 22 - radius + 1e-8);
      }
    }
  });

  test(`${id} has connected walkable routes between every spawn and base`, () => {
    const map = getMap(id);
    // Half-unit samples and checked edge midpoints catch disconnected chambers
    // and gaps narrower than the actual player diameter.
    const size = 87;
    const coordinate = index => -21.5 + index * 0.5;
    const open = new Uint8Array(size * size);
    const reached = new Uint8Array(size * size);
    for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
      open[z * size + x] = Number(canOccupy(coordinate(x), coordinate(z), radius, map.solids));
    }
    const indexFor = point => Math.round((point.z + 21.5) * 2) * size + Math.round((point.x + 21.5) * 2);
    const start = indexFor(map.playerSpawn);
    assert.equal(open[start], 1);
    const queue = [start];
    reached[start] = 1;
    for (let head = 0; head < queue.length; head++) {
      const index = queue[head], x = index % size, z = Math.floor(index / size);
      for (const [nx, nz] of [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]]) {
        if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
        const next = nz * size + nx;
        if (reached[next] || !open[next]) continue;
        if (!canOccupy((coordinate(x) + coordinate(nx)) / 2, (coordinate(z) + coordinate(nz)) / 2, radius, map.solids)) continue;
        reached[next] = 1;
        queue.push(next);
      }
    }
    for (const point of points(map)) {
      const index = indexFor(point);
      const snapped = { x: coordinate(index % size), z: coordinate(Math.floor(index / size)) };
      const movement = moveCircle(point, snapped.x - point.x, snapped.z - point.z, radius, map.solids);
      assert.ok(Math.hypot(movement.x - snapped.x, movement.z - snapped.z) < 1e-8);
      assert.equal(reached[index], 1, `unreachable ${JSON.stringify(point)}`);
    }
  });

  test(`${id} renders shared blocks and collision into a disposable Three.js scene`, () => {
    const scene = new THREE.Scene();
    const world = createWorld(THREE, scene, id);
    const map = getMap(id);
    assert.equal(world.mapId, id);
    assert.equal(world.definition, map);
    assert.deepEqual(world.solids, createSpatialWorld(map).solids);
    assert.deepEqual(world.spawns, map.spawns);
    assert.deepEqual(world.playerSpawn, map.playerSpawn);
    const arena = scene.children.find(child => child !== world.botGroup);
    assert.equal(arena.children.length, map.blocks.length);
    for (const [index, mesh] of arena.children.entries()) {
      const block = map.blocks[index];
      assert.deepEqual(mesh.position.toArray(), [block.x, block.y, block.z]);
      assert.deepEqual(mesh.scale.toArray(), [block.w, block.h, block.d]);
      assert.equal(`#${mesh.material.color.getHexString()}`, block.colour.toLowerCase());
    }
    assert.equal(new Set(arena.children.map(mesh => mesh.geometry)).size, 1);
    const disposals = new Map();
    const resources = new Set(arena.children.flatMap(mesh => [mesh.geometry, mesh.material]));
    for (const resource of resources) resource.addEventListener('dispose', () => disposals.set(resource, (disposals.get(resource) || 0) + 1));
    world.dispose();
    assert.equal(scene.children.length, 0);
    assert.equal(arena.parent, null);
    assert.equal(world.botGroup.parent, null);
    for (const resource of resources) assert.equal(disposals.get(resource), 1);
  });
}

test('repeated map selection does not retain old worlds or remove unrelated scene objects', () => {
  const scene = new THREE.Scene();
  const light = new THREE.AmbientLight();
  scene.add(light);
  for (const id of ids) {
    const world = createWorld(THREE, scene, id);
    assert.equal(scene.children.length, 3);
    world.dispose();
    assert.deepEqual(scene.children, [light]);
  }
});

test('default rendering selects Courtyard and invalid maps do not alter the scene', () => {
  const scene = new THREE.Scene();
  const world = createWorld(THREE, scene);
  assert.equal(world.mapId, 'courtyard');
  world.dispose();
  assert.throws(() => createWorld(THREE, scene, 'missing'));
  assert.equal(scene.children.length, 0);
});

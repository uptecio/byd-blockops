import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as worldModule from '../src/world.js';
import { MAPS } from '../src/maps.js';
import { RANGE_MAP } from '../src/range-map.js';

const fromDefinition = (...args) => {
  assert.equal(typeof worldModule.createWorldFromDefinition, 'function', 'private definition renderer exists');
  return worldModule.createWorldFromDefinition(...args);
};

// Catches a private-map lookup, altered public geometry, or changed world return shape.
test('definition renderer preserves public world geometry and shared compatibility', () => {
  for (const map of MAPS) {
    const scene = new THREE.Scene(), publicScene = new THREE.Scene();
    const world = fromDefinition(THREE, scene, map);
    const publicWorld = worldModule.createWorld(THREE, publicScene, map.id);
    assert.deepEqual(Object.keys(world).sort(), Object.keys(publicWorld).sort());
    assert.equal(world.definition, map);
    assert.deepEqual(world.spatial, publicWorld.spatial);
    assert.equal(world.playerSpawn, map.playerSpawn);
    assert.equal(world.spawns, map.spawns);
    assert.equal(world.botGroup.name, 'Bots');
    const arena = scene.children.find(child => child !== world.botGroup);
    assert.equal(arena.name, map.name);
    assert.equal(arena.children.length, map.blocks.length);
    for (const [i, mesh] of arena.children.entries()) {
      const block = map.blocks[i];
      assert.deepEqual(mesh.position.toArray(), [block.x, block.y, block.z]);
      assert.deepEqual(mesh.scale.toArray(), [block.w, block.h, block.d]);
      assert.equal(`#${mesh.material.color.getHexString()}`, block.colour);
    }
    world.dispose(); publicWorld.dispose();
  }
});

test('private range geometry is rendered without entering the public catalogue', () => {
  const scene = new THREE.Scene(), world = fromDefinition(THREE, scene, RANGE_MAP);
  assert.equal(world.mapId, 'shooting-range');
  assert.deepEqual(world.spatial.bounds, { min: -30, max: 30 });
  assert.deepEqual(world.spawns, []);
  assert.equal(world.botGroup.children.length, 0);
  assert.equal(scene.children.find(child => child !== world.botGroup).children.length, 5);
  assert.throws(() => worldModule.createWorld(THREE, new THREE.Scene(), 'shooting-range'));
  world.dispose();
});

test('invalid spatial or rendered geometry is rejected before scene attachment', () => {
  assert.equal(typeof worldModule.createWorldFromDefinition, 'function');
  for (const map of [
    { ...RANGE_MAP, bounds: { min: NaN, max: 30 } },
    { ...RANGE_MAP, blocks: [{ ...RANGE_MAP.blocks[0], w: 0 }] },
    { ...RANGE_MAP, blocks: [{ ...RANGE_MAP.blocks[0], z: Infinity }] },
  ]) {
    const scene = new THREE.Scene();
    assert.throws(() => fromDefinition(THREE, scene, map));
    assert.equal(scene.children.length, 0);
  }
});

test('world disposal releases shared arena and bot resources only once', () => {
  const scene = new THREE.Scene(), light = new THREE.AmbientLight(); scene.add(light);
  const world = fromDefinition(THREE, scene, RANGE_MAP);
  const arena = scene.children.find(child => child.name === RANGE_MAP.name);
  const resources = new Set(arena.children.flatMap(mesh => [mesh.geometry, mesh.material]));
  const bot = new THREE.Mesh(arena.children[0].geometry, arena.children[0].material);
  world.botGroup.add(bot);
  const counts = new Map();
  for (const resource of resources) resource.addEventListener('dispose', () => counts.set(resource, (counts.get(resource) || 0) + 1));
  world.dispose(); world.dispose();
  assert.deepEqual(scene.children, [light]);
  assert.equal(arena.children.length, 0);
  assert.equal(world.botGroup.children.length, 0);
  for (const resource of resources) assert.equal(counts.get(resource), 1);
});

test('world construction cleans resources and attached groups when scene attachment fails', () => {
  const scene = new THREE.Scene(), allocations = [], counts = new Map();
  const tracked = { ...THREE };
  for (const key of ['BoxGeometry', 'MeshLambertMaterial']) tracked[key] = class extends THREE[key] {
    constructor(...args) { super(...args); allocations.push(this); this.addEventListener('dispose', () => counts.set(this, (counts.get(this) || 0) + 1)); }
  };
  scene.add = function (...objects) { THREE.Scene.prototype.add.call(this, ...objects); throw new Error('attachment failure'); };
  assert.throws(() => fromDefinition(tracked, scene, RANGE_MAP), /attachment failure/);
  assert.equal(scene.children.length, 0);
  assert.ok(allocations.length > 1);
  for (const resource of allocations) assert.equal(counts.get(resource), 1);
});

test('world construction releases earlier allocations if a later material fails', () => {
  const allocations = [], counts = new Map(); let materialCount = 0;
  const track = resource => { allocations.push(resource); resource.addEventListener('dispose', () => counts.set(resource, (counts.get(resource) || 0) + 1)); };
  const tracked = { ...THREE,
    BoxGeometry: class extends THREE.BoxGeometry { constructor(...args) { super(...args); track(this); } },
    MeshLambertMaterial: class extends THREE.MeshLambertMaterial { constructor(...args) { if (++materialCount === 2) throw new Error('allocation failure'); super(...args); track(this); } },
  };
  const scene = new THREE.Scene();
  assert.throws(() => fromDefinition(tracked, scene, RANGE_MAP), /allocation failure/);
  assert.equal(scene.children.length, 0);
  assert.equal(allocations.length, 2);
  for (const resource of allocations) assert.equal(counts.get(resource), 1);
});

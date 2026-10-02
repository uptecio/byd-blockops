import test from 'node:test';
import assert from 'node:assert/strict';
import { canOccupy, moveCircle, hasLineOfSight } from '../src/collision.js';
import * as THREE from 'three';
import { createWorld, createBotModel, createWeaponModel } from '../src/world.js';

const wall = { x: 0, z: 0, w: 2, d: 8, height: 3 };

test('circle occupancy respects walls and permits exact edge contact', () => {
  assert.equal(canOccupy(0, 0, 0.5, [wall]), false);
  assert.equal(canOccupy(-1.4, 0, 0.5, [wall]), false);
  assert.equal(canOccupy(-1.5, 0, 0.5, [wall]), true);
  assert.equal(canOccupy(8, 0, 0.5, [wall]), true);
});

test('rounded circle corners remain walkable outside a box', () => {
  const box = { x: 0, z: 0, w: 2, d: 2, height: 2 };
  assert.equal(canOccupy(1.4, 1.4, 0.5, [box]), true);
  assert.equal(canOccupy(1.3, 1.3, 0.5, [box]), false);
});

test('movement slides along the wall without changing its input', () => {
  const start = { x: -2, z: -2 };
  const result = moveCircle(start, 3, 3, 0.5, [wall]);
  assert.ok(result.x <= -1.5 + 1e-9);
  assert.ok(result.x > -1.7);
  assert.ok(Math.abs(result.z - 1) < 1e-9);
  assert.deepEqual(start, { x: -2, z: -2 });
});

test('large movement cannot tunnel through thin walls in either direction', () => {
  const thin = { x: 0, z: 0, w: 0.1, d: 10, height: 2 };
  const right = moveCircle({ x: -10, z: 0 }, 30, 0, 0.35, [thin]);
  const left = moveCircle({ x: 10, z: 0 }, -30, 0, 0.35, [thin]);
  assert.ok(right.x <= -0.4 + 1e-9);
  assert.ok(left.x >= 0.4 - 1e-9);
});

test('boundary walls contain a moving player', () => {
  const boundary = { x: 5, z: 0, w: 1, d: 20, height: 4 };
  const result = moveCircle({ x: 0, z: 0 }, 100, 2, 0.5, [boundary]);
  assert.ok(result.x <= 4 + 1e-9);
  assert.ok(Math.abs(result.z - 2) < 1e-9);
});

test('an unobstructed zero movement returns the same coordinates', () => {
  assert.deepEqual(moveCircle({ x: 2, z: 3 }, 0, 0, 0.4, []), { x: 2, z: 3 });
});

test('line of sight is blocked by crossed cover but not parallel distant cover', () => {
  assert.equal(hasLineOfSight({ x: -4, z: 0 }, { x: 4, z: 0 }, [wall]), false);
  assert.equal(hasLineOfSight({ x: -4, z: 7 }, { x: 4, z: 7 }, [wall]), true);
  assert.equal(hasLineOfSight({ x: -4, z: 0 }, { x: -4, z: 8 }, [wall]), true);
});

test('eye-height rays can pass over low cover', () => {
  const cover = { x: 0, z: 0, w: 2, d: 2, height: 1 };
  assert.equal(hasLineOfSight({ x: -4, y: 1.6, z: 0 }, { x: 4, y: 1.6, z: 0 }, [cover]), true);
  assert.equal(hasLineOfSight({ x: -4, y: 0.8, z: 0 }, { x: 4, y: 0.8, z: 0 }, [cover]), false);
});

test('sloping rays intersect cover only at their actual crossing height', () => {
  const cover = { x: 0, z: 0, w: 2, d: 2, height: 1 };
  assert.equal(hasLineOfSight({ x: -4, y: 0, z: 0 }, { x: 4, y: 4, z: 0 }, [cover]), true);
  assert.equal(hasLineOfSight({ x: -4, y: 0, z: 0 }, { x: 4, y: 1, z: 0 }, [cover]), false);
});

test('a ray starting inside a solid cannot see outside it', () => {
  assert.equal(hasLineOfSight({ x: 0, y: 1, z: 0 }, { x: 5, y: 1, z: 0 }, [wall]), false);
});

test('Courtyard preserves its clear spawn positions and first-enemy sightlines', () => {
  const scene = new THREE.Scene();
  const world = createWorld(THREE, scene, 'courtyard');
  assert.ok(world.spawns.length >= 8);
  assert.equal(canOccupy(world.playerSpawn.x, world.playerSpawn.z, 0.4, world.solids), true);
  for (const spawn of world.spawns) {
    assert.equal(canOccupy(spawn.x, spawn.z, 0.4, world.solids), true);
    assert.ok(Math.hypot(spawn.x - world.playerSpawn.x, spawn.z - world.playerSpawn.z) > 3);
  }
  assert.ok(world.spawns.filter(spawn => hasLineOfSight(
    { ...world.playerSpawn, y: 1.6 }, { ...spawn, y: 1.6 }, world.solids,
  )).length >= 3);
  assert.equal(canOccupy(23, 0, 0.4, world.solids), false);
  assert.equal(hasLineOfSight({ x: -21, y: 1.6, z: 0 }, { x: -17, y: 1.6, z: 0 }, world.solids), false);
  world.dispose();
  assert.equal(scene.children.length, 0);
});

test('block character stands on ground and camera gun points forward', () => {
  const bot = createBotModel(THREE, '#ff8855');
  const botBounds = new THREE.Box3().setFromObject(bot);
  assert.ok(Math.abs(botBounds.min.y) < 0.01);
  assert.ok(botBounds.max.y > 1.65 && botBounds.max.y < 2);
  const gun = createWeaponModel(THREE, { id: 'awp', classId: 'sniper', colour: '#55bb88' });
  const gunBounds = new THREE.Box3().setFromObject(gun);
  assert.ok(gunBounds.min.z < -0.4);
  assert.ok(gunBounds.max.z < 0.3);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ArenaGame } from '../src/game.js';
import { getWeapon, createWeaponState } from '../src/weapons.js';
import { createMatch } from '../src/match.js';

// Headless combat fixture uses real Three.js geometry/rays and production game
// methods; only audio/DOM event sinks and GPU rendering are omitted.
function arena() {
  const game = Object.create(ArenaGame.prototype);
  Object.assign(game, {
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(75, 1, .05, 180),
    world: { solids: [], spawns: [{ x: 0, z: -12 }] }, bots: [], effects: [],
    weapon: getWeapon('awp'), weaponState: createWeaponState('awp'), match: createMatch(),
    player: { x: 0, z: 10, jump: 0, health: 100, dead: 0, protected: 0 },
    audio: { shoot() {}, hit() {}, kill() {} }, events: { onToast() {} },
    input: { move: { x: 0, y: 0 }, keys: new Set(), clear() {} },
    time: 0, recoil: 0, yaw: 0, botTuning: { speed: 0, interval: 1, accuracy: 1, damage: 8 },
  });
  game.camera.position.set(0, 1.1, 10);
  return game;
}
function bot(z = 0) {
  const model = new THREE.Group(); model.position.set(0, 0, z);
  return { model, bar: new THREE.Object3D(), health: 100, cooldown: 0, respawn: 0, phase: 0 };
}
test('hitscan damages the nearest visible opponent and records its elimination', context => {
  context.mock.method(Math, 'random', () => .5);
  const game = arena(), near = bot(0), far = bot(-4); game.bots.push(near, far);
  game.shoot(false);
  assert.equal(near.health, 0); assert.equal(near.model.visible, false);
  assert.equal(far.health, 100); assert.equal(game.match.kills, 1);
  game.clearEffects();
});
test('solid cover blocks player damage and stops the visible tracer', context => {
  context.mock.method(Math, 'random', () => .5);
  const game = arena(), enemy = bot(); game.bots.push(enemy);
  game.world.solids.push({ x: 0, z: 5, w: 4, d: 1, height: 3 });
  game.shoot(false);
  assert.equal(enemy.health, 100); assert.equal(game.match.kills, 0);
  assert.equal(game.effects[0].line.geometry.attributes.position.getZ(1), 5.5);
  game.clearEffects();
});
test('enemies obey the same cover and damage only a visible unprotected player', context => {
  context.mock.method(Math, 'random', () => .5);
  const game = arena(), enemy = bot(); game.bots.push(enemy);
  // Keep this fixture on the direct visibility branch; cover blocks the ray
  // without blocking the ground-level line used to choose a nearby waypoint.
  game.navSize = 45; game.distances = new Int16Array(45 * 45).fill(-1);
  game.world.solids.push({ x: 0, z: 5, w: 4, d: 1, height: 3 });
  game.updateBots(.1); assert.equal(game.player.health, 100);
  game.world.solids = [];
  game.updateBots(.1); assert.equal(game.player.health, 92);
  game.player.protected = 1; enemy.cooldown = 0;
  game.updateBots(.1); assert.equal(game.player.health, 92);
  game.clearEffects();
});
test('lethal bot damage enters respawn once and does not count extra deaths', context => {
  context.mock.method(Math, 'random', () => .5);
  const game = arena(); game.player.health = 8; game.bots = [bot(), bot(-1)];
  game.updateBots(.1);
  assert.equal(game.player.health, 0); assert.equal(game.player.dead, 2.5);
  assert.equal(game.match.deaths, 1);
  game.updateBots(.1); assert.equal(game.match.deaths, 1);
  game.clearEffects();
});
test('fifteenth real hitscan kill ends the round', context => {
  context.mock.method(Math, 'random', () => .5);
  const game = arena(); game.match.kills = 14; game.bots = [bot()];
  game.shoot(false);
  assert.equal(game.match.kills, 15); assert.equal(game.match.ended, true);
  game.clearEffects();
});

test('all supported movement keys make the player harder for bots to hit', context => {
  context.mock.method(Math, 'random', () => .8);
  for (const key of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
    const game = arena(); game.bots = [bot()]; game.input.keys.add(key);
    game.updateBots(.1);
    assert.equal(game.player.health, 100, `${key} receives the movement accuracy modifier`);
    game.clearEffects();
  }
});

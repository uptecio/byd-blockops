import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHeadlessGame, cleanupGame } from './helpers/game-fixture.js';
import { RoomManager } from '../server/rooms.js';
import { createSpatialWorld, solidBounds } from '../src/spatial.js';
import { createBody } from '../src/character-movement.js';
import { createEquipment } from '../src/equipment.js';
import { createGearCombatState, throwGrenade, stepGearCombat, meleeTarget } from '../src/gear-combat.js';
import { stackedFixture } from './helpers/traversal-fixture.js';
import { getWeapon } from '../src/weapons.js';

function runtimes(t, world = createSpatialWorld({ id: 'empty', bounds: { min: -10, max: 10 }, solids: [] })) {
  const game = createHeadlessGame(); game.start('m4a1', { bots: 0 }); t.after(() => cleanupGame(game));
  const manager = new RoomManager({ random: () => .5 }), room = manager.create('a', 'A');
  manager.join('b', room.code, 'B'); manager.start('a');
  game.world.spatial = world; game.world.solids = world.solids;
  room.physics = { spatial: world, solids: world.solids, wallBoxes: world.solids.map(solid => {
    const bounds = solidBounds(solid); return new THREE.Box3(new THREE.Vector3(...Object.values(bounds.min)), new THREE.Vector3(...Object.values(bounds.max)));
  }) };
  const a = room.players.get('a');
  Object.assign(room.players.get('b'), createBody({ x: -8, y: 0, z: -8 }, world));
  const place = point => {
    const body = createBody(point, world);
    Object.assign(game.player, body, { jump: body.y, velocity: 0 }); Object.assign(a, body);
    game.yaw = game.pitch = 0; game.placeCamera();
  };
  place({ x: 0, y: 0, z: 0 });
  const step = (dt, { x = 0, y = 0, jump = false, yaw = 0 } = {}) => {
    game.input.move = { x, y }; game.input.jump = jump; game.yaw = yaw;
    manager.input('a', { lifeId: a.lifeId, x, y, jump, yaw, pitch: 0 });
    game.simulateStep(dt); manager.tickRoom(room, dt);
  };
  return { game, manager, room, a, place, step };
}

test('solo and server share a movement trace with the same supported feet and gravity', t => {
  const { game, a, step } = runtimes(t);
  for (let n = 0; n < 100; n++) {
    step(1 / 120, { x: .5, y: .3, jump: n === 0, yaw: .4 });
    assert.ok(Math.hypot(game.player.x - a.x, game.player.jump - a.y, game.player.z - a.z) < 1e-8);
    assert.ok(Math.abs(game.player.velocityY - a.velocityY) < 1e-8);
  }
});

test('runtime roofs remain supported and a walk-off fall has no health cost', t => {
  const { world, roof } = stackedFixture();
  const { game, a, place, step } = runtimes(t, world); place(roof);
  for (let n = 0; n < 100; n++) step(1 / 120);
  assert.equal(game.player.jump, 3); assert.equal(a.y, 3);
  assert.equal(game.camera.position.y, 4.65);
  for (let n = 0; n < 96; n++) step(1 / 120, { x: 1 });
  for (let n = 0; n < 120; n++) step(1 / 120);
  assert.equal(game.player.jump, 0); assert.equal(a.y, 0);
  assert.equal(game.player.health, 100); assert.equal(a.health, 100);
});

test('solo and online preserve their different radii at a thin side wall', t => {
  const { world } = stackedFixture(); const { game, a, place, step } = runtimes(t, world);
  place({ x: 6, y: 0, z: 0 });
  for (let n = 0; n < 60; n++) step(1 / 120, { x: 1 });
  assert.ok(game.player.x <= 6.65 + 1e-8 && game.player.x > 6.60);
  assert.ok(a.x <= 6.59 + 1e-8 && a.x > 6.54);
});

test('a quarter-second runtime stall cannot jump through a ceiling', t => {
  const { world, ceilingPoint } = stackedFixture(); const { game, a, place, step } = runtimes(t, world);
  place(ceilingPoint); step(.25, { jump: true });
  assert.ok(game.player.jump <= .16); assert.ok(a.y <= .16);
  assert.equal(game.player.health, 100); assert.equal(a.health, 100);
});

test('bot cosmetic position cannot move the physical hitbox', t => {
  const game = createHeadlessGame(); game.start('m4a1', { bots: 1 }); t.after(() => cleanupGame(game));
  const bot = game.bots[0], before = game.getActors()[1];
  bot.model.position.y += .025;
  assert.equal(game.getActors()[1].y, before.y);
});

test('runtime bot tuning does not mutate the defaults used by a second game', t => {
  const a = createHeadlessGame(), b = createHeadlessGame();
  t.after(() => { cleanupGame(a); cleanupGame(b); });
  a.start('m4a1', { bots: 1 }); a.botTuning.speed = 0;
  b.start('m4a1', { bots: 1 });
  assert.equal(b.botTuning.speed, 2.1);
});

test('grenades can be released inside a room underneath a suspended roof', () => {
  const { world } = stackedFixture(), state = createGearCombatState();
  const actor = { id: 'a', lifeId: 1, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, alive: true, equipment: createEquipment('m4a1') };
  actor.equipment.grenades.frag = 1;
  assert.equal(throwGrenade(state, actor, 'frag', { solids: world.solids }).ok, true);
  stepGearCombat(state, [actor], .05, { solids: world.solids, isEnemy: () => false });
  assert.ok(state.projectiles[0].y < 2.8);
});

test('a rising grenade bounces off the actual underside of a suspended roof', () => {
  const { world } = stackedFixture(), state = createGearCombatState();
  state.projectiles.push({ id: 'g', ownerId: 'a', grenadeType: 'frag', x: 0, y: 2.5, z: 0, vx: 0, vy: 6, vz: 0, fuseRemaining: 2 });
  stepGearCombat(state, [], .1, { solids: world.solids, isEnemy: () => false });
  assert.ok(state.projectiles[0].y < 2.8); assert.ok(state.projectiles[0].vy < 0);
});

test('roof blocks cross-floor gun knife and grenade attacks but permits same-room shots', t => {
  const { world } = stackedFixture(); const { manager, room, a } = runtimes(t, world);
  const b = room.players.get('b'); Object.assign(a, { x: 0, y: 0, z: 1, pitch: Math.atan2(3, 1), yaw: 0 });
  Object.assign(b, { x: 0, y: 3, z: 0, protectedRemaining: 0 });
  manager.shoot(room, a, getWeapon('awp')); assert.equal(b.health, 100);
  const actors = manager.actors(room);
  assert.equal(meleeTarget(actors[0], actors, { solids: world.solids, isEnemy: () => true }), null);
  const state = createGearCombatState();
  state.projectiles.push({ id: 'g', ownerId: 'a', grenadeType: 'frag', x: 0, y: 2, z: 0, vx: 0, vy: 0, vz: 0, fuseRemaining: .001 });
  const blast = stepGearCombat(state, actors, .01, { solids: world.solids, isEnemy: () => true });
  assert.equal(blast.damage.some(hit => hit.targetId === 'b'), false);
  Object.assign(b, { y: 0 }); a.pitch = 0;
  manager.shoot(room, a, getWeapon('awp')); assert.equal(b.health, 0);
});

test('server shots over low cover still damage exposed players', t => {
  const world = createSpatialWorld({ id: 'cover', bounds: { min: -10, max: 10 }, solids: [{ x: 0, z: 0, w: 2, d: 1, height: 1 }] });
  const { manager, room, a } = runtimes(t);
  room.physics.solids = world.solids;
  room.physics.wallBoxes = [new THREE.Box3(new THREE.Vector3(-1, 0, -.5), new THREE.Vector3(1, 1, .5))];
  Object.assign(a, { x: 0, y: 0, z: 2, yaw: 0, pitch: 0 });
  const b = room.players.get('b'); Object.assign(b, { x: 0, y: 0, z: -2, protectedRemaining: 0 });
  manager.shoot(room, a, getWeapon('awp')); assert.equal(b.health, 0);
});

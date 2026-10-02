import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { getWeapon, createWeaponState } from '../src/weapons.js';
import { recordElimination } from '../src/modes.js';
import { createHeadlessGame } from './helpers/game-fixture.js';

// Headless combat fixture uses real Three.js geometry/rays and production game
// methods; only audio/DOM event sinks and GPU rendering are omitted.
function arena(modeId = 'ffa', count = 2) {
  const game = createHeadlessGame(); game.start('awp', { bots: count, modeId });
  game.world.solids = [];
  Object.assign(game.player, { x: 0, z: 10, jump: 0, health: 100, dead: 0, protected: 0 });
  game.botTuning = { speed: 0, interval: 1, accuracy: 1, damage: 8 };
  game.bots.forEach((bot, i) => { bot.model.position.set(0, 0, -i * 4); Object.assign(bot, { cooldown: 0, protected: 0 }); });
  game.camera.position.set(0, 1.1, 10);
  return game;
}
test('hitscan damages the nearest visible opponent and records its elimination', context => {
  context.mock.method(Math, 'random', () => .5);
  const game = arena(), [near, far] = game.bots;
  game.shoot(false);
  assert.equal(near.health, 0); assert.equal(near.model.visible, false);
  assert.equal(far.health, 100); assert.equal(game.match.kills, 1);
  game.clearEffects();
});
test('solid cover blocks player damage and stops the visible tracer', context => {
  context.mock.method(Math, 'random', () => .5);
  const game = arena('ffa', 1), [enemy] = game.bots;
  game.world.solids.push({ x: 0, z: 5, w: 4, d: 1, height: 3 });
  game.shoot(false);
  assert.equal(enemy.health, 100); assert.equal(game.match.kills, 0);
  assert.equal(game.effects[0].line.geometry.attributes.position.getZ(1), 5.5);
  game.clearEffects();
});
test('enemies obey the same cover and damage only a visible unprotected player', context => {
  context.mock.method(Math, 'random', () => .5);
  const game = arena('ffa', 1), [enemy] = game.bots;
  game.world.solids.push({ x: 0, z: 5, w: 4, d: 1, height: 3 });
  game.updateBots(.1); assert.equal(game.player.health, 100);
  game.world.solids = [];
  enemy.intentTimer = 0;
  game.updateBots(.1); assert.equal(game.player.health, 92);
  game.player.protected = 1; enemy.cooldown = 0;
  game.updateBots(.1); assert.equal(game.player.health, 92);
  game.clearEffects();
});
test('lethal bot damage enters respawn once and does not count extra deaths', context => {
  context.mock.method(Math, 'random', () => .5);
  const game = arena('tdm', 3); game.player.health = 8;
  game.bots[1].model.position.set(20, 0, 10); game.bots[2].model.position.set(0, 0, -1);
  game.updateBots(.1);
  assert.equal(game.player.health, 0); assert.equal(game.player.dead, 2.5);
  assert.equal(game.match.deaths, 1);
  game.updateBots(.1); assert.equal(game.match.deaths, 1);
  game.clearEffects();
});
test('fifteenth real hitscan kill ends the round', context => {
  context.mock.method(Math, 'random', () => .5);
  const game = arena('ffa', 1);
  for (let i = 0; i < 14; i++) recordElimination(game.modeState, { killerId: 'local', victimId: 'bot-0', position: { x: 0, z: 0 }, lifeId: i + 100 });
  game.shoot(false);
  assert.equal(game.match.kills, 15); assert.equal(game.match.ended, true);
  game.clearEffects();
});

test('all supported movement keys make the player harder for bots to hit', context => {
  context.mock.method(Math, 'random', () => .8);
  for (const key of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
    const game = arena('ffa', 1); game.input.keys.add(key);
    game.updateBots(.1);
    assert.equal(game.player.health, 100, `${key} receives the movement accuracy modifier`);
    game.clearEffects();
  }
});

test('human shots pass through allies and damage the enemy behind them', context => {
  context.mock.method(Math, 'random', () => .5);
  const game = arena('tdm'), [enemy, ally] = game.bots; ally.model.position.set(0, 0, 5);
  game.shoot(false);
  assert.equal(ally.health, 100); assert.equal(enemy.health, 0);
  assert.equal(game.modeState.teamScores.red, 1); game.clearEffects();
});
test('bots ignore allies and bot-versus-bot eliminations credit only the attacker', context => {
  context.mock.method(Math, 'random', () => .5);
  const game = arena('tdm', 3), [attacker, enemy, ally] = game.bots;
  attacker.model.position.set(0, 0, 0); ally.model.position.set(0, 0, 2); enemy.model.position.set(0, 0, 4);
  enemy.health = 8; enemy.cooldown = 100; ally.cooldown = 100;
  game.updateBots(.1);
  assert.equal(ally.health, 100); assert.equal(enemy.health, 0); assert.equal(enemy.respawn, 2.4);
  assert.equal(game.modeState.stats['bot-0'].kills, 1); assert.equal(game.modeState.stats['bot-1'].deaths, 1);
  assert.equal(game.match.kills, 0); assert.equal(game.modeState.teamScores.blue, 1); game.clearEffects();
});
test('winning shotgun pellet stops further pellets from damaging another life', context => {
  context.mock.method(Math, 'random', () => .5);
  const game = arena(), [near, far] = game.bots;
  game.weapon = getWeapon('m870'); game.weaponState = createWeaponState('m870'); near.health = 1;
  for (let i = 0; i < 14; i++) recordElimination(game.modeState, { killerId: 'local', victimId: 'bot-0', position: { x: 0, z: 0 }, lifeId: i + 100 });
  game.shoot(false);
  assert.equal(game.modeState.ended, true); assert.equal(game.match.kills, 15); assert.equal(far.health, 100); game.clearEffects();
});
test('a winning bot shot stops subsequent bots and further damage', context => {
  context.mock.method(Math, 'random', () => .5);
  const game = arena('tdm', 3); game.player.health = 8; game.bots[1].model.position.set(20, 0, 10);
  for (let i = 0; i < 29; i++) recordElimination(game.modeState, { killerId: 'bot-0', victimId: 'local', position: { x: 0, z: 0 }, lifeId: i + 100 });
  const ammo = game.bots[2].weaponState.ammo; game.updateBots(.1);
  assert.equal(game.modeState.teamScores.blue, 30); assert.equal(game.modeState.ended, true);
  assert.equal(game.bots[2].weaponState.ammo, ammo); assert.equal(game.bots[1].health, 100); game.clearEffects();
});

test('bot fire and reload conserve the 500-round supply', context => {
  context.mock.method(Math, 'random', () => .5);
  const game = arena('ffa', 1), [enemy] = game.bots;
  game.botTuning.accuracy = 0;
  assert.equal(enemy.weaponState.ammo + enemy.weaponState.reserve, 500);
  // Fire the complete real M4 magazine through production bot combat.
  for (let i = 0; i < 30; i++) { enemy.cooldown = 0; game.updateBots(.1); }
  assert.equal(enemy.weaponState.ammo, 0); assert.equal(enemy.weaponState.reserve, 470);
  enemy.cooldown = 0; game.updateBots(.1);
  assert.ok(enemy.weaponState.reloadRemaining > 0);
  enemy.cooldown = 100; game.updateBots(4);
  assert.equal(enemy.weaponState.ammo, 30); assert.equal(enemy.weaponState.reserve, 440);
  assert.equal(enemy.weaponState.ammo + enemy.weaponState.reserve, 470); game.clearEffects();
});

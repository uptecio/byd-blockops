import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { getWeapon, createWeaponState } from '../src/weapons.js';
import { recordElimination } from '../src/modes.js';
import {createHeadlessGame, cleanupGame, positionBot, setWorldSolids } from './helpers/game-fixture.js';

// Headless combat fixture uses real Three.js geometry/rays and production game
// methods; only audio/DOM event sinks and GPU rendering are omitted.
function arena(modeId = 'ffa', count = 2) {
  const game = createHeadlessGame(); game.start('awp', { bots: count, modeId });
  setWorldSolids(game, []);
  Object.assign(game.player, { x: 0, z: 10, jump: 0, health: 100, dead: 0, protected: 0 });
  game.botTuning = { speed: 0, interval: 1, accuracy: 1, damage: 8 };
  game.bots.forEach((bot, i) => { positionBot(bot, 0, 0, -i * 4); Object.assign(bot, { cooldown: 0, protected: 0 }); });
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
  setWorldSolids(game, [...game.world.solids, { x: 0, z: 5, w: 4, d: 1, height: 3 }]);
  game.shoot(false);
  assert.equal(enemy.health, 100); assert.equal(game.match.kills, 0);
  assert.equal(game.effects[0].line.geometry.attributes.position.getZ(1), 5.5);
  game.clearEffects();
});
test('enemies obey the same cover and damage only a visible unprotected player', context => {
  context.mock.method(Math, 'random', () => .5);
  const game = arena('ffa', 1), [enemy] = game.bots;
  setWorldSolids(game, [...game.world.solids, { x: 0, z: 5, w: 4, d: 1, height: 3 }]);
  game.updateBots(.1); assert.equal(game.player.health, 100);
  setWorldSolids(game, []);
  enemy.intentTimer = 0;
  game.updateBots(.1); assert.equal(game.player.health, 92);
  game.player.protected = 1; enemy.cooldown = 0;
  game.updateBots(.1); assert.equal(game.player.health, 92);
  game.clearEffects();
});
test('lethal bot damage enters respawn once and does not count extra deaths', context => {
  context.mock.method(Math, 'random', () => .5);
  const game = arena('tdm', 3); game.player.health = 8;
  positionBot(game.bots[1], 20, 0, 10); positionBot(game.bots[2], 0, 0, -1);
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
  const game = arena('tdm'), [enemy, ally] = game.bots; positionBot(ally, 0, 0, 5);
  game.shoot(false);
  assert.equal(ally.health, 100); assert.equal(enemy.health, 0);
  assert.equal(game.modeState.teamScores.red, 1); game.clearEffects();
});
test('bots ignore allies and bot-versus-bot eliminations credit only the attacker', context => {
  context.mock.method(Math, 'random', () => .5);
  const game = arena('tdm', 3), [attacker, enemy, ally] = game.bots;
  positionBot(attacker, 0, 0, 0); positionBot(ally, 0, 0, 2); positionBot(enemy, 0, 0, 4);
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
  const game = arena('tdm', 3); game.player.health = 8; positionBot(game.bots[1], 20, 0, 10);
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

for (const impairment of ['smoke', 'flash']) test(`bots recheck ${impairment} before firing and retain last seen pursuit positions`, context => {
  context.mock.method(Math, 'random', () => .5);
  const game = arena('ffa', 1), bot = game.bots[0]; context.after(() => cleanupGame(game));
  game.updateBots(.1); assert.equal(game.player.health, 92);
  if (impairment === 'smoke') game.gearCombatState.smokes.push({ x: 0, y: 1.35, z: 5, radius: 4, remaining: 8 });
  else bot.flashRemaining = 2;
  game.player.x = 2; bot.cooldown = 0; game.updateBots(.1);
  assert.equal(game.player.health, 92); assert.deepEqual(bot.intent.goal, { x: 0, y: 0, z: 10 });
  game.player.x = 4; bot.intentTimer = 0; game.updateBots(.1);
  assert.equal(game.player.health, 92); assert.deepEqual(bot.intent.goal, { x: 0, y: 0, z: 10 });
});

test('bots spend collected grenades at most once per six seconds and spare teammates', context => {
  context.mock.method(Math, 'random', () => .5);
  const game = arena('tdm', 3), [bot, enemy, ally] = game.bots; context.after(() => cleanupGame(game));
  positionBot(enemy, 20, 0, 0); enemy.cooldown = 100;
  bot.equipment.grenades.frag = 3; ally.cooldown = 100;
  game.player.health = 100; game.updateBots(.1);
  assert.equal(bot.equipment.grenades.frag, 2); assert.equal(game.gearCombatState.projectiles.length, 1);
  game.updateBots(1); assert.equal(bot.equipment.grenades.frag, 2);
  const projectile = game.gearCombatState.projectiles[0];
  Object.assign(projectile, { x: ally.model.position.x, y: .12, z: ally.model.position.z, vx: 0, vy: 0, vz: 0, fuseRemaining: .01 });
  game.update(.02); assert.equal(ally.health, 100);
});

test('a collected sniper extends bot engagement range while preserving difficulty damage', context => {
  context.mock.method(Math, 'random', () => .5);
  const game = arena('ffa', 1), bot = game.bots[0]; context.after(() => cleanupGame(game));
  game.world.definition = { ...game.world.definition, solids: [] };
  game.player.z = 20; positionBot(bot, 0, 0, -20);
  bot.equipment.owned.set('awp', createWeaponState('awp'));
  game.updateBots(.1);
  assert.equal(bot.equipment.activeGunId, 'awp'); assert.equal(bot.weaponState.ammo, 4);
  assert.equal(game.player.health, 92);
});

test('bot knife selection cannot redirect a visible swing into a concealed nearer enemy', context => {
  const game = arena('ffa', 2), [bot, visible] = game.bots; context.after(() => cleanupGame(game));
  Object.assign(game.player, { x: 0, z: 1.05 }); positionBot(visible, .55, 0, 1.2); visible.cooldown = 100;
  bot.equipment.knife = true;
  game.gearCombatState.smokes.push({ x: 0, y: 1.6, z: 1.05, radius: .3, remaining: 8 });
  game.updateBots(.01);
  assert.equal(game.player.health, 100); assert.equal(visible.health, 50);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHeadlessGame, cleanupGame, positionBot, setWorldSolids } from './helpers/game-fixture.js';
import { pickupEquipment } from '../src/equipment.js';

function arena(t, settings = {}) {
  const game = createHeadlessGame(); t.after(() => cleanupGame(game));
  game.start('m4a1', { bots: 0, ...settings }); return game;
}
const pack = (game, type = 'health', who = game.player) => pickupEquipment(who.equipment, { kind: 'supply', supplyType: type });
const use = (game, supplyType = 'health') => game.requestEquipment({ kind: 'use-supply', supplyType });
const close = (a,b) => assert.ok(Math.abs(a-b) < 1e-8, `${a} != ${b}`);

test('moving supply use keeps the starter and completes after five seconds', t => {
  const game = arena(t); game.player.health = 10; pack(game);
  assert.equal(use(game).ok, true);
  game.input.keys.add('KeyW'); const beforeZ = game.player.z;
  game.update(4.999); assert.equal(game.player.health, 10);
  assert.notEqual(game.player.z, beforeZ); assert.equal(game.weaponState.ammo, 30);
  game.update(.001); assert.equal(game.player.health, 100);
  assert.equal(game.player.equipment.supplies.health, 0);
  assert.equal(game.player.equipment.startingGunRemoved, false);
});

test('all attacks blocked during use including direct slash shoot throw and reload', t => {
  const game = arena(t, { bots: 1 }); game.botTuning.speed = 0; game.botTuning.accuracy = 0;
  setWorldSolids(game, []); Object.assign(game.player, { x: 0, z: 1, health: 20, protected: 0 });
  const bot = game.bots[0]; positionBot(bot, 0, 0, 0); bot.protected = 0; bot.cooldown = 100;
  const e = game.player.equipment; pickupEquipment(e, { kind: 'knife' }); e.grenades.frag = 1;
  for (const heldItem of ['gun', 'knife']) {
    game.requestEquipment({ kind: 'held-item', heldItem }); pack(game);
    game.weaponState.ammo = 10;
    assert.equal(use(game).ok, true);
    game.input.fire = true; game.input.reload = true; game.input.throwPressed = true;
    assert.equal(game.requestEquipment({ kind: 'throw', grenadeType: 'frag' }).ok, false);
    game.shoot(false); game.slash(game.getActors()[0]); game.update(.1);
    assert.equal(bot.health, 100); assert.equal(game.weaponState.ammo, 10);
    assert.equal(game.weaponState.reloadRemaining, 0); assert.equal(e.meleeRemaining, 0);
    assert.equal(e.grenades.frag, 1); assert.equal(game.gearCombatState.projectiles.length, 0);
    assert.equal(game.requestEquipment({ kind: 'cancel-supply' }).ok, true);
  }
});

test('pause preserves remaining, menus permit cancellation but not a fresh use', t => {
  const game = arena(t); game.player.health = 20; pack(game); use(game);
  game.update(2); game.pause(); game.update(20);
  close(game.player.equipment.supplyUse.remaining, 3);
  assert.equal(use(game, 'armour').ok, false);
  game.resume(); game.update(3); assert.equal(game.player.health, 100);
  game.player.health = 20; pack(game); use(game); game.pause();
  assert.equal(game.requestEquipment({ kind: 'equip-gun', weaponId: 'mp5', source: 'armory' }).ok, true);
  assert.equal(game.player.equipment.supplyUse, null); assert.equal(game.player.equipment.supplies.health, 1);
  assert.equal(use(game).ok, false);
});

test('real solo walkover collects both supply types without automatically using them', t => {
  const game = arena(t);
  for (const type of ['health', 'armour']) {
    const slot = game.lootState.slots.find(s => s.item.supplyType === type);
    Object.assign(game.player, { x: slot.x, z: slot.z }); game.update(.01);
    assert.equal(game.player.equipment.supplies[type], 1); assert.equal(slot.present, false);
    assert.equal(game.player.equipment.supplyUse, null);
  }
  assert.equal(game.player.armour, 0); assert.equal(game.player.health, 100);
});

test('bot start does not count prior slice time and bot use does not self-cancel', t => {
  const game = arena(t, { bots: 1, modeId: 'ctf' }); game.botTuning.accuracy = 0;
  const bot = game.bots[0]; bot.health = 40; pack(game, 'health', bot);
  pickupEquipment(bot.equipment, { kind: 'knife' });
  const before = bot.model.position.clone();
  game.update(.05); const operation = bot.equipment.supplyUse;
  assert.deepEqual(operation, { type: 'health', remaining: 5 });
  const ammo = bot.weaponState.ammo;
  game.update(4.999);
  assert.equal(bot.equipment.supplyUse, operation); assert.equal(bot.health, 40);
  assert.notEqual(bot.model.position.distanceTo(before), 0); assert.equal(bot.weaponState.ammo, ammo);
  assert.equal(bot.equipment.meleeRemaining, 0);
  game.update(.001); assert.equal(bot.health, 100); assert.equal(bot.equipment.supplies.health, 0);
});

test('bots collect along their route and flash blocks new starts but not pending use', t => {
  const game = arena(t, { bots: 1 }); game.botTuning.speed = 0; game.botTuning.accuracy = 0;
  const bot = game.bots[0], slot = game.lootState.slots.find(s => s.item.supplyType === 'armour');
  positionBot(bot, slot.x, 0, slot.z); bot.flashRemaining = 2;
  game.update(.05); assert.equal(bot.equipment.supplies.armour, 1); assert.equal(bot.equipment.supplyUse, null);
  bot.flashRemaining = 0; game.update(.05); assert.equal(bot.equipment.supplyUse.type, 'armour');
  bot.flashRemaining = 10; game.update(5);
  assert.equal(bot.armour, 50); assert.equal(bot.equipment.supplies.armour, 0);
});

test('death drops pending pack and respawns empty', t => {
  const game = arena(t, { bots: 1 }); game.botTuning.speed = 0; game.botTuning.accuracy = 0;
  Object.assign(game.player, { x: 0, z: 0, health: 20, armour: 50, protected: 0 });
  pack(game); pack(game, 'armour'); assert.equal(use(game).ok, true);
  const oldLife = game.player.lifeId;
  assert.equal(game.damageActor(game.bots[0].id, game.player, 200), true);
  assert.equal(game.player.armour, 0); assert.equal(game.player.equipment.supplyUse, null);
  assert.deepEqual(game.player.equipment.supplies, { health: 0, armour: 0 });
  assert.deepEqual(game.lootState.drops.filter(d => d.item.kind === 'supply').map(d => d.item.supplyType), ['health', 'armour']);
  game.update(2.6); assert.ok(game.player.lifeId > oldLife);
  assert.equal(game.player.armour, 0); assert.equal(game.player.health, 100);
  assert.deepEqual(game.player.equipment.supplies, { health: 0, armour: 0 });
});

test('ordinary protected and friendly hits preserve armour while enemy damage uses it first', t => {
  const game = arena(t, { bots: 2, modeId: 'tdm' });
  const friend = game.bots.find(b => b.teamId === game.player.teamId), enemy = game.bots.find(b => b.teamId !== game.player.teamId);
  game.player.armour = 20;
  assert.equal(game.damageActor(enemy.id, game.player, 30), false);
  game.player.protected = 0;
  assert.equal(game.damageActor(friend.id, game.player, 30), false);
  assert.equal(game.player.armour, 20);
  assert.equal(game.damageActor(enemy.id, game.player, 30), true);
  assert.equal(game.player.health, 90); assert.equal(game.player.armour, 0);
  for (const damage of [-1, NaN, Infinity]) assert.equal(game.damageActor(enemy.id, game.player, damage), false);
  assert.equal(game.player.health, 90);
});

test('real knife frag and headshot route through armour without changing damage', t => {
  t.mock.method(Math, 'random', () => .5);
  const game = arena(t, { bots: 1 }); setWorldSolids(game, []); game.botTuning.speed = 0; game.botTuning.accuracy = 0;
  Object.assign(game.player, { x: 0, z: 1.2, protected: 0 }); game.yaw = 0; game.pitch = 0;
  const bot = game.bots[0]; positionBot(bot, 0,0,0); bot.protected = 0; bot.armour = 100; bot.cooldown = 100;
  pickupEquipment(game.player.equipment, { kind: 'knife' }); game.requestEquipment({ kind: 'held-item', heldItem: 'knife' });
  game.slash(game.getActors()[0]); assert.equal(bot.armour, 50); assert.equal(bot.health, 100);
  game.player.equipment.grenades.frag = 1; game.requestEquipment({ kind: 'throw', grenadeType: 'frag' });
  Object.assign(game.gearCombatState.projectiles[0], { x: 0, y: .12, z: 0, vx: 0, vy: 0, vz: 0, fuseRemaining: .01 });
  game.update(.01); assert.equal(bot.armour, 0); assert.ok(bot.health >= 60 && bot.health < 100);
  bot.health = 100; bot.armour = 100;
  game.requestEquipment({ kind: 'held-item', heldItem: 'gun' }); game.placeCamera(); game.shoot(false);
  assert.equal(bot.health, 0); assert.equal(bot.armour, 0);
});

test('round timeout and quit clear pending use without consuming', t => {
  const game = arena(t); game.player.health = 20; pack(game); assert.equal(use(game).ok, true);
  game.modeState.timeLeft = 5; game.update(5);
  assert.equal(game.match.ended, true); assert.equal(game.player.equipment.supplyUse, null);
  assert.equal(game.player.equipment.supplies.health, 1); assert.equal(game.player.health, 20);
  game.start('m4a1', { bots: 0 }); game.player.health = 20; pack(game); use(game); game.quit();
  assert.equal(game.player.equipment.supplyUse, null);
});

function lastZombie(game) {
  game.player.protected = 1000;
  for (let i = 0; i < 4; i++) {
    game.update(1.01); for (const z of game.bots) game.damageActor('local', z, 100); game.zombieRuntime.finishStep();
  }
  game.update(1.01); assert.equal(game.modeState.queued, 0); assert.equal(game.bots.length, 1);
  return game.bots[0];
}

test('last-zombie recovery preserves due pack and ammo recovery remains 500', t => {
  const game = arena(t, { modeId: 'zombies' }), z = lastZombie(game);
  setWorldSolids(game, []); positionBot(z, 0,0,0); z.health = 10; z.flashRemaining = 10;
  Object.assign(game.player, { x: 0, z: 10, health: 10 });
  game.player.equipment.grenades.frag = 1;
  assert.equal(game.requestEquipment({ kind: 'throw', grenadeType: 'frag' }).ok, true);
  game.update(.3); pack(game); assert.equal(use(game).ok, true);
  // Represent both due timers on one real simulation slice; the actual grenade resolves the kill.
  game.player.equipment.supplyUse.remaining = .01;
  Object.assign(game.gearCombatState.projectiles[0], { x:0,y:.12,z:0,vx:0,vy:0,vz:0,fuseRemaining:.01 });
  game.weaponState.ammo = 1; game.weaponState.reserve = 2; game.update(.01);
  assert.equal(game.modeState.phase, 'recovery'); assert.equal(game.player.health, 100);
  assert.equal(game.player.equipment.supplies.health, 1); assert.equal(game.player.equipment.supplyUse, null);
  assert.equal(game.weaponState.ammo + game.weaponState.reserve, 500);
});

test('fatal damage wins same-step completion in zombies', t => {
  const game = arena(t, { modeId: 'zombies' }); game.update(.05);
  const z = game.bots[0]; setWorldSolids(game, []); positionBot(z, 0,0,8.9); z.brain.attackRemaining = 0;
  Object.assign(game.player, { x: 0, z: 10, health: 10, protected: 0 }); pack(game); assert.equal(use(game).ok, true);
  game.player.equipment.supplyUse.remaining = .01; game.update(.01);
  assert.equal(game.player.health, 0); assert.equal(game.modeState.ended, true); assert.equal(game.player.equipment.supplyUse, null);
  assert.equal(game.lootState.drops.length, 0);
});

test('armour use survives recovery and a new zombie run is fresh', t => {
  const game = arena(t, { modeId: 'zombies' }), z = lastZombie(game);
  game.player.armour = 20; pack(game, 'armour'); pack(game);
  assert.equal(use(game, 'armour').ok, true); game.update(2);
  const operation = game.player.equipment.supplyUse; close(operation.remaining, 3);
  game.damageActor('local', z, 100); game.zombieRuntime.finishStep();
  assert.equal(game.player.armour, 20); assert.equal(game.player.equipment.supplyUse, operation);
  game.update(3); assert.equal(game.player.armour, 70); assert.equal(game.player.equipment.supplies.armour, 0);
  pack(game, 'armour'); assert.equal(use(game, 'armour').ok, true);
  game.start('m4a1', { modeId: 'zombies' });
  assert.equal(game.player.armour, 0); assert.deepEqual(game.player.equipment.supplies, { health:0, armour:0 });
  assert.equal(game.player.equipment.supplyUse, null);
});

test('wave-19 hit consumes full armour and zombies never collect packs', t => {
  const game = arena(t, { modeId: 'zombies' }); game.update(.05);
  const z = game.bots[0], slot = game.lootState.slots.find(s => s.item.supplyType === 'health');
  positionBot(z, slot.x,0,slot.z); z.flashRemaining = 1; game.update(.05);
  assert.equal(slot.present, true); assert.equal(z.equipment, undefined);
  setWorldSolids(game, []); Object.assign(game.player, { x:0,z:10,armour:100,protected:0 });
  positionBot(z, 0,0,8.9); z.flashRemaining = 0; z.brain.attackRemaining = 0;
  game.modeState.wave = 19; game.update(.01);
  assert.equal(game.player.armour, 0); assert.equal(game.player.health, 100); assert.equal(game.modeState.ended, false);
});

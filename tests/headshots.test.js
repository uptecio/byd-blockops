import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS, getWeapon } from '../src/weapons.js';
import { RoomManager } from '../server/rooms.js';
import { createHeadlessGame, cleanupGame } from './helpers/game-fixture.js';

function solo(t, weaponId = 'm4a1', modeId = 'ffa') {
  const game = createHeadlessGame(); t.after(() => cleanupGame(game));
  game.start(weaponId, { bots: 1, modeId }); game.world.solids = [];
  Object.assign(game.player, { x: 0, z: 10, jump: 0, protected: 0 });
  const target = game.bots[0]; target.model.position.set(0, 0, 0); target.protected = 0; target.cooldown = 100;
  game.botTuning = { speed: 0, interval: 1, accuracy: 0, damage: 8 };
  game.placeCamera();
  const amounts = [], damage = game.damageActor.bind(game);
  // Observe the adapter boundary while running the real damage/drop/score lifecycle.
  game.damageActor = (...args) => { amounts.push(args[2]); return damage(...args); };
  return { game, target, amounts };
}

function online(weaponId = 'm4a1', modeId = 'ffa') {
  const manager = new RoomManager({ random: () => .5 });
  const room = manager.create('a', 'HeadHost', weaponId, { modeId }); manager.join('b', room.code, 'Target', 'm4a1'); manager.start('a');
  const a = room.players.get('a'), target = room.players.get('b');
  Object.assign(a, { x: 0, z: 10, y: 0, yaw: 0, pitch: 0, protectedRemaining: 0 });
  Object.assign(target, { x: 0, z: 0, y: 0, protectedRemaining: 0 });
  const amounts = [], damage = manager.damage.bind(manager);
  manager.damage = (...args) => { amounts.push(args[3]); return damage(...args); };
  return { manager, room, a, target, amounts };
}

const pelletCounts = { m870: 8, spas12: 8, aa12: 7, doublebarrel: 9 };
for (const weapon of WEAPONS) {
  test(`Solo ${weapon.id} head hit delivers exactly ten billion damage and one death`, t => {
    t.mock.method(Math, 'random', () => .5);
    const { game, target, amounts } = solo(t, weapon.id);
    game.input.fire = true; game.input.firePressed = true; game.update(.01);
    assert.deepEqual(amounts, [10000000000], 'First valid pellet must request exact damage before normal health clamping');
    assert.equal(target.health, 0); assert.equal(game.match.kills, 1); assert.equal(game.modeState.stats[target.id].deaths, 1);
    assert.equal(game.lootState.drops.length, 1); assert.equal(game.weaponState.ammo + game.weaponState.reserve, 499);
    game.input.fire = false; game.update(.01);
    assert.equal(game.match.kills, 1); assert.equal(game.lootState.drops.length, 1);
    game.update(2.6); assert.equal(target.health, 100); assert.ok(target.protected > 0);
  });
  test(`authoritative ${weapon.id} head pellets each deliver ten billion without duplicate deaths`, () => {
    const { manager, room, a, target, amounts } = online(weapon.id);
    manager.input(a.id, { lifeId: a.lifeId, x: 0, y: 0, yaw: 0, pitch: 0, fire: true, firePressed: true }); manager.tick(.01);
    assert.deepEqual(amounts, [10000000000 * (pelletCounts[weapon.id] || 1)], 'Real server adapter aggregates the exact amount per valid pellet');
    assert.equal(target.health, 0); assert.equal(a.kills, 1); assert.equal(target.deaths, 1); assert.equal(room.lootState.drops.length, 1);
    assert.equal(a.inventory.get(weapon.id).ammo + a.inventory.get(weapon.id).reserve, 499);
    const snapshot = manager.snapshot(room); assert.equal(snapshot.players.find(p => p.id === target.id).health, 0);
    assert.equal(JSON.stringify(snapshot).includes('Infinity'), false);
    manager.input(a.id, { lifeId: a.lifeId, x: 0, y: 0, yaw: 0, pitch: 0 }); manager.tick(2.6);
    assert.equal(target.health, 100); assert.ok(target.protectedRemaining > 0); assert.equal(a.kills, 1);
  });
}

// Hand-calculated unchanged body values at a 9.68-unit flat Solo ray hit.
const bodyCases = [['m4a1', 24, 24], ['mp5', 17.234285714285715, 20], ['m870', 10.303428571428572, 104], ['scout', 75, 75], ['sks', 43, 43], ['m249', 23, 23], ['g17', 23, 23]];
for (const [weaponId, soloAmount, serverAmount] of bodyCases) test(`${weaponId} body impacts retain prior damage and Solo falloff`, t => {
  t.mock.method(Math, 'random', () => .5);
  const { game, amounts } = solo(t, weaponId); game.camera.position.y = 1.1; game.shoot(false);
  assert.ok(Math.abs(amounts[0] - soloAmount) < 1e-9, `${amounts[0]} != ${soloAmount}`);
  const { manager, room, a, target, amounts: serverAmounts } = online(weaponId); target.y = .55;
  manager.shoot(room, a, getWeapon(weaponId)); assert.deepEqual(serverAmounts, [serverAmount]);
});

for (const [feet, expected] of [[.17, 24], [.170000001, 24], [.169999999, 10000000000]]) test(`head threshold is strict at feet ${feet} in both real adapters`, t => {
  t.mock.method(Math, 'random', () => .5);
  const { game, target, amounts } = solo(t); target.model.position.y = feet; game.shoot(false);
  assert.deepEqual(amounts, [expected]);
  const { manager, room, a, target: remote, amounts: serverAmounts } = online(); remote.y = feet;
  manager.shoot(room, a, getWeapon('m4a1')); assert.deepEqual(serverAmounts, [expected]);
});

for (const guard of ['range', 'cover', 'friendly', 'protected', 'ended']) test(`gun headshot still respects ${guard} in Solo and authoritative Online`, t => {
  t.mock.method(Math, 'random', () => .5);
  const { game, target, amounts } = solo(t, 'g17', guard === 'friendly' ? 'tdm' : 'ffa');
  if (guard === 'range') target.model.position.z = -30.33;
  if (guard === 'cover') game.world.solids.push({ x: 0, z: 5, w: 3, d: 1, height: 3 });
  if (guard === 'friendly') { target.teamId = game.player.teamId; game.modeState.stats[target.id].teamId = game.player.teamId; }
  if (guard === 'protected') target.protected = 1;
  if (guard === 'ended') game.modeState.ended = true;
  game.shoot(false); assert.equal(target.health, 100); assert.deepEqual(amounts, []);
  const { manager, room, a, target: remote, amounts: serverAmounts } = online('g17', guard === 'friendly' ? 'tdm' : 'ffa');
  if (guard === 'range') remote.z = -30.33;
  if (guard === 'cover') { a.x = -8; a.z = 7; remote.x = -8; remote.z = -7; }
  if (guard === 'friendly') { remote.teamId = a.teamId; room.modeState.stats[remote.id].teamId = a.teamId; }
  if (guard === 'protected') remote.protectedRemaining = 1;
  if (guard === 'ended') manager.tick(180);
  manager.input(a.id, { lifeId: a.lifeId, x: 0, y: 0, yaw: 0, pitch: 0, firePressed: true }); manager.tick(.01);
  assert.equal(remote.health, 100); assert.deepEqual(serverAmounts, []);
});

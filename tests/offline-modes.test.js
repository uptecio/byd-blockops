import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MAPS } from '../src/maps.js';
import { canOccupy, moveCircle } from '../src/collision.js';
import { ObjectiveView } from '../src/objectives.js';
import { tickMode } from '../src/modes.js';
import {createHeadlessGame, cleanupGame, positionBot } from './helpers/game-fixture.js';
import { canPerceive } from '../src/actor-perception.js';

test('all 24 combinations start cleanly on one reused production game', () => {
  const game = createHeadlessGame();
  try {
    for (const map of MAPS) for (const modeId of ['ffa', 'tdm', 'ctf']) {
      const oldBots = game.bots.slice(), oldNavigation = game.navigation;
      game.tracer(new THREE.Vector3(), new THREE.Vector3(1, 1, 1), 'white');
      game.start('m4a1', { bots: 4, sensitivity: 1, difficulty: 'normal', mapId: map.id, modeId, skinId: 'ranger' });
      assert.equal(game.modeState.timeLeft, 180);
      assert.equal(game.getMatchView().modeId, modeId);
      assert.equal(game.getMatchView().players.length, 5);
      assert.equal(game.effects.length, 0);
      assert.equal(game.lootState.slots.length, 20);
      assert.equal(game.lootState.drops.length, 0);
      assert.equal(game.gearCombatState.projectiles.length, 0);
      assert.equal(game.gearCombatState.smokes.length, 0);
      assert.equal(game.player.equipment.startingGunId, 'm4a1');
      assert.equal(game.world.botGroup.children.length, 4);
      assert.ok(oldBots.every(bot => bot.model.parent === null));
      assert.notEqual(game.navigation, oldNavigation);
      for (const actor of game.getActors()) {
        assert.ok(canOccupy(actor.x, actor.z, .42, map.solids));
        assert.ok(game.navigation.reachable(actor, map.bases.red));
        assert.ok(game.navigation.reachable(actor, map.bases.blue));
        assert.equal(actor.lifeId, 1);
        assert.equal(actor.equipment.activeGunId, 'm4a1');
        assert.equal(actor.flashRemaining, 0);
      }
      assert.equal(game.objectives.group.children.length, modeId === 'ctf' ? 4 : 0);
      game.update(.1); assert.ok(Math.abs(game.match.timeLeft - 179.9) < 1e-8);
    }
  } finally { cleanupGame(game); }
});

test('pending human and bot cosmetics activate only on next spawn with replenished ammo', () => {
  const game = createHeadlessGame();
  game.start('m4a1', { bots: 2, modeId: 'tdm', skinId: 'ranger' });
  try {
    game.setPendingSkin('robo-unit');
    assert.equal(game.player.skinId, 'ranger');
    game.weaponState.ammo = 0; game.weaponState.reserve = 0;
    game.resetPlayer();
    assert.equal(game.player.skinId, 'robo-unit'); assert.equal(game.player.lifeId, 2);
    assert.equal(game.weaponState.ammo + game.weaponState.reserve, 500);
    const bot = game.bots[0]; bot.pendingSkinId = 'space-guard'; bot.respawn = .01; bot.weaponState.ammo = 0; bot.weaponState.reserve = 0;
    game.updateBots(.02);
    assert.equal(bot.skinId, 'space-guard'); assert.equal(bot.lifeId, 2);
    assert.equal(bot.weaponState.ammo + bot.weaponState.reserve, 500);
    assert.ok(game.world.definition.teamSpawns[bot.teamId].some(p => p.x === bot.model.position.x && p.z === bot.model.position.z));
    assert.ok(game.world.definition.teamSpawns.red.some(p => p.x === game.player.x && p.z === game.player.z));
  } finally { cleanupGame(game); }
});

test('CTF assigns attackers before defenders and both teams have an attacker', () => {
  const game = createHeadlessGame(); game.start('m4a1', { bots: 8, modeId: 'ctf' });
  try {
    assert.deepEqual(game.bots.map(bot => bot.role), ['attack', 'attack', 'defend', 'defend', 'defend', 'defend', 'defend', 'defend']);
    for (const team of ['red', 'blue']) assert.equal(game.bots.filter(bot => bot.teamId === team && bot.role === 'attack').length, 1);
  } finally { cleanupGame(game); }
});

test('a lone blue bot steals and captures via continuous production movement', () => {
  const game = createHeadlessGame(); game.start('m4a1', { bots: 1, modeId: 'ctf', difficulty: 'hard' });
  game.botTuning = { ...game.botTuning, accuracy: 0 };
  let pickedUp = false;
  try {
    for (let i = 0; i < 1700 && game.modeState.teamScores.blue === 0; i++) {
      game.update(.1);
      pickedUp ||= game.modeState.flags.red.carrierId === 'bot-0';
      for (const actor of game.getActors()) assert.ok(canOccupy(actor.x, actor.z, .4, game.world.solids));
    }
    assert.ok(pickedUp); assert.equal(game.modeState.teamScores.blue, 1);
    assert.equal(game.modeState.flags.red.status, 'home');
  } finally { cleanupGame(game); }
});

test('objectives follow visible carrier jump height and dispose all flag and base resources', () => {
  const scene = new THREE.Scene(), view = new ObjectiveView(THREE, scene, MAPS[0]);
  view.update({ flags: { red: { status: 'carried', carrierId: 'local', x: 0, z: 18 }, blue: { status: 'dropped', x: 3, z: 4 } }, actors: [{ id: 'local', x: 7, y: 2, z: 8 }], viewerId: 'local' });
  assert.deepEqual(view.flags.red.position.toArray(), [7, 2, 8]);
  assert.deepEqual(view.flags.blue.position.toArray(), [3, 0, 4]);
  let geometryDisposed = 0, materialDisposed = 0;
  const geometries = new Set(), materials = new Set();
  view.group.traverse(object => { if (object.geometry) geometries.add(object.geometry); if (object.material) materials.add(object.material); });
  geometries.forEach(g => g.addEventListener('dispose', () => geometryDisposed++));
  materials.forEach(m => m.addEventListener('dispose', () => materialDisposed++));
  view.dispose();
  assert.equal(scene.children.length, 0); assert.equal(geometryDisposed, geometries.size); assert.equal(materialDisposed, materials.size);
});

for (const teamId of ['red', 'blue']) test(`${teamId} carrier recovers its missing flag and captures through movement`, () => {
  const game = createHeadlessGame(); game.start('m4a1', { bots: 2, modeId: 'ctf', difficulty: 'hard' });
  game.botTuning = { ...game.botTuning, accuracy: 0 };
  const carrier = game.bots.find(bot => bot.teamId === teamId), thief = game.bots.find(bot => bot.teamId !== teamId);
  const ownBase = game.world.definition.bases[teamId], otherBase = game.world.definition.bases[thief.teamId];
  // Arrange a legitimate double steal followed by a combat drop before the run.
  positionBot(carrier, otherBase.x, 0, otherBase.z); positionBot(thief, ownBase.x, 0, ownBase.z);
  carrier.protected = thief.protected = 0; game.player.dead = 200; game.player.health = 0;
  tickMode(game.modeState, .01, game.getActors());
  positionBot(thief, 0, 0, 0);
  game.damageActor(carrier.id, thief, 100); thief.respawn = 200;
  assert.equal(game.modeState.flags[teamId].status, 'dropped');
  let ownReturned = false, returnTime = null;
  try {
    for (let i = 0; i < 1700 && game.modeState.teamScores[teamId] === 0; i++) {
      game.update(.1);
      if (i === 0) assert.deepEqual(carrier.intent.goal, { x: 0, y: 0, z: 0 });
      if (!ownReturned && game.modeState.flags[teamId].status === 'home') { ownReturned = true; returnTime = (i + 1) * .1; }
    }
    assert.ok(ownReturned); assert.ok(returnTime < 15, `touch returned the flag after ${returnTime}s, before auto-return`);
    assert.equal(game.modeState.teamScores[teamId], 1);
    assert.equal(game.modeState.flags[thief.teamId].status, 'home');
  } finally { cleanupGame(game); }
});

test('map reload disposes old objectives and effects as well as bot geometry', () => {
  const game = createHeadlessGame(); game.start('m4a1', { bots: 2, modeId: 'ctf' });
  const oldGroup = game.objectives.group, oldBot = game.bots[0].model;
  let disposed = 0; oldBot.children[0].geometry.addEventListener('dispose', () => disposed++);
  game.tracer(new THREE.Vector3(), new THREE.Vector3(1, 1, 1), 'white');
  const line = game.effects[0].line;
  game.start('m4a1', { bots: 1, modeId: 'ffa', mapId: 'harbor' });
  assert.equal(oldGroup.parent, null); assert.equal(oldBot.parent, null); assert.equal(line.parent, null); assert.equal(disposed, 1);
  cleanupGame(game);
});

test('unreachable goals throttle navigation retries instead of recalculating each frame', context => {
  const game = createHeadlessGame(); game.start('m4a1', { bots: 1, modeId: 'ffa' });
  // Player is inside an existing courtyard building; genuine navigation rejects it.
  game.player.x = 15; game.player.z = 14;
  // This tests retrying a remembered unreachable sighting, not wall-vision.
  game.bots[0].lastKnownTargets.set(game.player.id, { x: 15, y: 0, z: 14, lifeId: game.player.lifeId });
  let recalculations = 0;
  const nextApproachWaypoint = game.navigation.nextApproachWaypoint.bind(game.navigation);
  context.mock.method(game.navigation, 'nextApproachWaypoint', (...args) => { recalculations++; return nextApproachWaypoint(...args); });
  for (let i = 0; i < 50; i++) game.update(.01);
  assert.equal(game.bots[0].waypoint, null); assert.ok(recalculations > 0 && recalculations <= 6, `recalculated ${recalculations} times in half a second`);
  cleanupGame(game);
});

test('zero-bot adapter start creates no actors or meshes beyond the local human', () => {
  const game = createHeadlessGame();
  game.start('m4a1', { bots: 0, modeId: 'ctf', mapId: 'harbor' });
  assert.equal(game.bots.length, 0); assert.equal(game.world.botGroup.children.length, 0);
  assert.deepEqual(game.getActors().map(actor => actor.id), ['local']);
  // HUD is a projection; altering its copy must not create a second clock.
  game.match.timeLeft = 1; game.update(.5);
  assert.equal(game.modeState.timeLeft, 179.5); assert.equal(game.match.timeLeft, 179.5);
  cleanupGame(game);
});

test('FFA bots start in the bot spawn pool without overlapping the human spawn', () => {
  const game = createHeadlessGame();
  try {
    for (const map of MAPS) {
      game.start('m4a1', { bots: 8, modeId: 'ffa', mapId: map.id });
      for (const bot of game.bots) {
        const { x, z } = bot.model.position;
        assert.ok(x !== game.player.x || z !== game.player.z, `${map.id}/${bot.id} overlaps human`);
        assert.ok(map.spawns.some(point => point.x === x && point.z === z));
      }
    }
  } finally { cleanupGame(game); }
});

test('bots pursue a human at legal bot-radius wall contact through production updates', () => {
  const game = createHeadlessGame();
  try {
    game.start('m4a1', { bots: 1, modeId: 'ffa', mapId: 'courtyard' });
    game.player.x = game.player.z = 0;
    for (let i = 0; i < 100; i++) Object.assign(game.player, moveCircle(game.player, -.1, 0, .4, game.world.solids));
    assert.ok(Math.abs(game.player.x + 6.5) < 1e-8, 'collision movement reaches central wall');
    assert.ok(canOccupy(game.player.x, game.player.z, .4, game.world.solids));
    assert.equal(canOccupy(game.player.x, game.player.z, .42, game.world.solids), false);
    const bot = game.bots[0]; positionBot(bot, -10, 0, 0);
    bot.lastKnownTargets.set(game.player.id, { x: game.player.x, y: 0, z: game.player.z, lifeId: game.player.lifeId });
    for (let i = 0; i < 40; i++) {
      game.update(.05);
      assert.ok(canOccupy(bot.model.position.x, bot.model.position.z, .4, game.world.solids));
    }
    assert.ok(Math.hypot(bot.model.position.x + 10, bot.model.position.z) > 1, 'bot follows its real pursuit route around cover');
    assert.deepEqual(bot.intent.goal, { x: game.player.x, y: 0, z: game.player.z });
  } finally { cleanupGame(game); }
});

test('initial team spawns stay distinct for every supported bot count, map and team mode', () => {
  const game = createHeadlessGame();
  try {
    for (const map of MAPS) for (const modeId of ['tdm', 'ctf']) for (let bots = 1; bots <= 8; bots++) {
      game.start('m4a1', { bots, modeId, mapId: map.id });
      const occupied = new Set();
      for (const actor of game.getActors()) {
        const key = `${actor.x},${actor.z}`;
        assert.ok(!occupied.has(key), `${map.id}/${modeId}/${bots} bots: ${actor.id} overlaps another actor`);
        occupied.add(key);
        assert.ok(map.teamSpawns[actor.teamId].some(point => point.x === actor.x && point.z === actor.z));
      }
    }
  } finally { cleanupGame(game); }
});

test('bots pursue actual human-radius wall contact reached by live player controls', () => {
  const game = createHeadlessGame();
  try {
    game.start('m4a1', { bots: 1, modeId: 'ffa', mapId: 'courtyard' });
    game.player.x = game.player.z = 0;
    game.input.keys.add('KeyA');
    // Keep the bot out of this setup without bypassing player simulation.
    game.bots[0].respawn = 100;
    for (let i = 0; i < 160; i++) game.update(.01);
    game.input.clear();
    assert.ok(canOccupy(game.player.x, game.player.z, .34, game.world.solids));
    assert.equal(canOccupy(game.player.x, game.player.z, .4, game.world.solids), false);
    // Begin with an actual sighting around the end of the wall. An unseen
    // enemy's random patrol need not discover this position within12seconds.
    const bot = game.bots[0]; bot.respawn = 0; positionBot(bot, -7, 0, 4);
    assert.equal(canPerceive(game.getActors()[1],game.getActors()[0],{world:game.world.spatial}),true);
    game.botTuning = { ...game.botTuning, accuracy: 0 };
    for (let i = 0; i < 240; i++) {
      game.update(.05);
      assert.ok(canOccupy(bot.model.position.x, bot.model.position.z, .4, game.world.solids));
    }
    assert.ok(Math.hypot(bot.model.position.x - game.player.x, bot.model.position.z - game.player.z) < .8, 'bot routes around cover to a safe nearby approach');
  } finally { cleanupGame(game); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../src/audio.js';
import { pickupEquipment } from '../src/equipment.js';
import { createHeadlessGame, cleanupGame } from './helpers/game-fixture.js';

// The WebAudio sink is optional; the actual completion decision stays in production.
test('sound disabled is silent and both valid supply effects have a completion tone', t => {
  const audio = new GameAudio(), tones = [];
  t.mock.method(audio, 'tone', (...args) => tones.push(args));
  assert.equal(typeof audio.supplyComplete, 'function');
  audio.enabled = false; audio.supplyComplete('health'); audio.supplyComplete('armour'); assert.equal(tones.length, 0);
  audio.enabled = true; audio.supplyComplete('health'); assert.equal(tones.length, 1);
  audio.supplyComplete('armour'); assert.equal(tones.length, 2); assert.notEqual(tones[0][0], tones[1][0]);
  audio.supplyComplete('invalid'); assert.equal(tones.length, 2);
});

test('solo successful effects sound once and cancelled paused or new-life operations never replay', t => {
  const game = createHeadlessGame(); t.after(() => cleanupGame(game)); game.start('m4a1', { bots:0 });
  const cues = []; game.audio.supplyComplete = type => cues.push(type);
  const collect = type => pickupEquipment(game.player.equipment, { kind:'supply', supplyType:type });
  const use = supplyType => game.requestEquipment({ kind:'use-supply', supplyType });
  game.player.health = 30; collect('health'); use('health'); game.update(4.999); assert.deepEqual(cues, []);
  game.update(.001); assert.deepEqual(cues, ['health']); game.update(1); assert.deepEqual(cues, ['health']);
  collect('armour'); use('armour'); game.update(1); game.pause(); game.update(20); assert.deepEqual(cues, ['health']);
  game.resume(); game.update(4); assert.deepEqual(cues, ['health','armour']);
  game.player.health = 30; collect('health'); use('health'); game.requestEquipment({ kind:'cancel-supply' }); game.update(5);
  assert.deepEqual(cues, ['health','armour']);
  use('health'); game.resetPlayer(); game.update(6); assert.deepEqual(cues, ['health','armour']);
});

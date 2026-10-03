import test from 'node:test';
import assert from 'node:assert/strict';
import * as helpers from './helpers/loot-browser.js';

test('combat bearing follows lateral movement residual instead of assuming a shared X', () => {
  const aim = helpers.targetAim?.({ x: -.2, y: 0, z: -1.3 }, { x: .2, y: 0, z: 0 });
  assert.ok(aim, 'a bearing is derived from both settled public positions');
  assert.ok(Math.abs(aim.yaw - -2.843093722003614) < 1e-12, 'opponent faces the actual holder, not fixed PI');
  assert.equal(aim.pitch, 0);
});

test('combat bearing handles cardinal directions and different observed heights', () => {
  for (const [target, yaw, pitch] of [
    [{ x: 0, y: 0, z: -2 }, 0, 0],
    [{ x: 2, y: 0, z: 0 }, -Math.PI / 2, 0],
    [{ x: -2, y: 0, z: 0 }, Math.PI / 2, 0],
    [{ x: 0, y: 2, z: -2 }, 0, Math.PI / 4],
  ]) {
    const aim = helpers.targetAim?.({ x: 0, y: 0, z: 0 }, target);
    assert.ok(aim, 'coordinate-derived aim exists');
    assert.ok(Math.abs(aim.yaw - yaw) < 1e-12);
    assert.ok(Math.abs(aim.pitch - pitch) < 1e-12);
  }
});

const packet = (lifeId, health, owned = []) => ({
  room: { phase: 'playing', players: [{ id: 'holder', lifeId, health, ammo: health ? 30 : 0, reserve: health ? 470 : 0 }] },
  equipment: { playerId: 'holder', lifeId, equipment: { owned, knife: false, grenades: { frag: 0, smoke: 0, flash: 0 } } },
});

test('death capture retains the old-life packet and its private envelope after a later respawn', () => {
  const dead = packet(7, 0), respawn = packet(8, 100, [{ weaponId: 'm4a1', ammo: 30, reserve: 470 }]);
  const captured = helpers.deadSnapshot?.([packet(7, 100), dead, respawn], 'holder', 7);
  assert.deepEqual(captured, dead, 'latest alive snapshot cannot erase already observed same-life death');
  assert.deepEqual(captured.equipment.equipment.owned, []);
  assert.equal(captured.equipment.lifeId, 7);
});

test('independent death streams need not have simultaneous dead latest snapshots', () => {
  const early = packet(7, 0), late = packet(7, 0);
  const streams = [[early, packet(8, 100)], [packet(7, 100), late]];
  assert.deepEqual(streams.map(messages => helpers.deadSnapshot?.(messages, 'holder', 7)), [early, late]);
});

test('death capture rejects another player or life even when that latest player is dead', () => {
  assert.equal(helpers.deadSnapshot?.([packet(6, 0), packet(8, 0)], 'holder', 7), undefined);
  assert.equal(helpers.deadSnapshot?.([packet(7, 0)], 'opponent', 7), undefined);
});

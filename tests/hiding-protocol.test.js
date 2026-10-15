import test from 'node:test';
import assert from 'node:assert/strict';
import { validHideAction, validHideResult, validPlayerSpatial } from '../src/hiding-protocol.js';
import { PROTOCOL_VERSION } from '../src/protocol.js';
import { MAPS } from '../src/maps.js';
import { createSpatialWorld } from '../src/spatial.js';
import { MOVEMENT } from '../src/character-movement.js';

const map = MAPS[0], spot = map.hideSpots[0];
const action = () => ({ type: 'hide-action', seq: 1, roundId: 'round-1', lifeId: 1, kind: 'enter', spotId: spot.id });
const result = () => ({ type: 'hide-result', protocol: PROTOCOL_VERSION, seq: 1, roundId: 'round-1', lifeId: 1, ok: true, reason: null, hiddenSpotId: spot.id });
test('current protocol hide action/result enforce exact plain identities and map membership', () => {
  assert.equal(validHideAction(action(), map), true); assert.equal(validHideResult(result(), map), true);
  assert.equal(validHideAction({ ...action(), kind: 'exit' }, map), true);
  for (const change of [{ seq: 0 }, { seq: NaN }, { lifeId: -1 }, { seq: 1.2 }, { seq: Number.MAX_SAFE_INTEGER + 1 }, { roundId: '' }, { roundId: null },
    { spotId: MAPS[1].hideSpots[0].id }, { x: 1 }, { y: 3 }, { health: 100 }, { kind: 'teleport' }, { type: 'input' }]) assert.equal(validHideAction({ ...action(), ...change }, map), false);
  for (const key of Object.keys(action())) { const bad = action(); delete bad[key]; assert.equal(validHideAction(bad, map), false); }
  for (const change of [{ protocol: 5 }, { seq: 0 }, { lifeId: Infinity }, { ok: 1 }, { reason: 'not null' }, { position: spot.occupant }, { hiddenSpotId: 'wrong' }]) assert.equal(validHideResult({ ...result(), ...change }, map), false);
  assert.equal(validHideResult({ ...result(), ok: false, reason: 'Occupied', hiddenSpotId: null }, map), true);
  assert.equal(validHideResult({ ...result(), ok: false, reason: 'x'.repeat(161) }, map), false);
  assert.equal(validHideResult({ ...result(), ok: false, reason: null }, map), false);
  assert.equal(validHideAction(Object.assign(Object.create({ extra: true }), action()), map), false);
});

test('public spatial state validates elevation support and hidden occupant identity', () => {
  const actor = { ...spot.occupant, grounded: true, supportId: 'ground', hiddenSpotId: spot.id, ladderId: null, health: 100, respawnRemaining: 0 };
  assert.equal(validPlayerSpatial(actor, map), true);
  for (const change of [{ y: NaN }, { y: Infinity }, { y: -1 }, { y: 100 }, { x: 100 }, { grounded: 1 }, { grounded: false },
    { supportId: null }, { supportId: 'fake' }, { hiddenSpotId: 'fake' }, { x: spot.entry.x, z: spot.entry.z }, { health: 0 }, { respawnRemaining: 1 }]) assert.equal(validPlayerSpatial({ ...actor, ...change }, map), false, JSON.stringify(change));
  const roof = map.traversal.roofs[0]; assert.equal(validPlayerSpatial({ ...actor, ...roof.point, hiddenSpotId: null, supportId: roof.supportId }, map), true);
  assert.equal(validPlayerSpatial({ ...actor, hiddenSpotId: null, y: .3, grounded: false, supportId: null }, map), true);
  const world = createSpatialWorld(map), highest = Math.max(...world.solids.map(s => s.maxY));
  assert.ok(world.maxFeetY >= highest + MOVEMENT.jumpVelocity ** 2 / (2 * MOVEMENT.gravity));
  assert.ok(world.maxFeetY < highest + MOVEMENT.jumpVelocity ** 2 / (2 * MOVEMENT.gravity) + .11);
});

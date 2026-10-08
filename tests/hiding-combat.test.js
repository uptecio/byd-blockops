import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpatialWorld } from '../src/spatial.js';
import { createHidingState, requestHide } from '../src/hiding.js';
import { spotDamageTargets, raySpotHit, spotBlastExposure } from '../src/hiding-combat.js';
import { meleeTarget, createGearCombatState, stepGearCombat } from '../src/gear-combat.js';
import { createGearActor } from './helpers/equipment-fixture.js';

function fixture() {
  const spot = { id: 'box', entry: { x: 0, y: 0, z: 1.3 }, occupant: { x: 0, y: 0, z: 0 }, exit: { x: 0, y: 0, z: 1.3 }, recovery: { x: 0, y: 0, z: 1.6 },
    proxy: { min: { x: -.62, y: 0, z: -.62 }, max: { x: .62, y: 2, z: .62 } }, shellIds: ['back'] };
  const map = { id: 'proxy', bounds: { min: -20, max: 20 }, hideSpots: [spot], solids: [{ id: 'back', hideSpotId: 'box', x: 0, z: -.59, w: 1.3, d: .1, height: 2 }] };
  const world = createSpatialWorld(map), state = createHidingState();
  const target = createGearActor('target', { ...spot.entry, grounded: true });
  requestHide(state, target, { kind: 'enter', spotId: spot.id, lifeId: 1 }, { map, world, active: true });
  Object.assign(target, spot.occupant, { hiddenSpotId: spot.id });
  const owner = createGearActor('owner', { z: -2, yaw: Math.PI });
  const hiding = { state, map, world }, actors = [owner, target];
  return { spot, map, world, state, hiding, owner, target, actors, options: { solids: world.solids, isEnemy: (a, b) => a !== b, hiding } };
}

test('only occupied current-life proxies receive a single body-only ray hit through their own shell', () => {
  const f = fixture(), targets = spotDamageTargets(f.state, f.actors, f.map), origin = { x: 0, y: 1.8, z: -2 }, dir = { x: 0, y: 0, z: 1 };
  assert.equal(targets.length, 1);
  const hit = raySpotHit(origin, dir, 10, targets, f.world);
  assert.equal(hit.actorId, 'target'); assert.equal(hit.distance, 1.38); assert.equal(hit.headshot, undefined);
  assert.equal(raySpotHit(origin, dir, 1, targets, f.world), null);
  assert.deepEqual(spotDamageTargets(createHidingState(), f.actors, f.map), []);
  assert.deepEqual(spotDamageTargets(f.state, [{ ...f.target, lifeId: 2 }], f.map), []);
  assert.deepEqual(spotDamageTargets(f.state, [{ ...f.target, alive: false }], f.map), []);
  f.world.solids.push({ id: 'other-wall', x: 0, z: -1, w: 5, d: .1, minY: 0, maxY: 4 });
  assert.equal(raySpotHit(origin, dir, 10, targets, f.world), null);
});

test('proxy rays and explosions cannot pass through unrelated floors or walls', () => {
  const f = fixture(), [target] = spotDamageTargets(f.state, f.actors, f.map);
  f.world.solids.push({ id: 'roof', x: 0, z: 0, w: 4, d: 4, minY: 2.2, maxY: 2.4 });
  const above = { x: 0, y: 3, z: 0 };
  assert.equal(raySpotHit(above, { x: 0, y: -1, z: 0 }, 10, [target], f.world), null);
  assert.equal(spotBlastExposure(above, target, f.world).visible, false);
  const behind = { x: 0, y: 1.6, z: -2 };
  const exposure = spotBlastExposure(behind, target, f.world);
  assert.equal(exposure.visible, true); assert.equal(exposure.distance, 1.38);
});

test('knife proxy contact retains reach cone protection and team filtering', () => {
  const f = fixture();
  assert.equal(meleeTarget(f.owner, f.actors, f.options), 'target');
  for (const change of [{ z: -2.4201 }, { yaw: 0 }, { y: 4 }]) assert.equal(meleeTarget({ ...f.owner, ...change }, f.actors, f.options), null);
  f.target.protectedRemaining = 1; assert.equal(meleeTarget(f.owner, f.actors, f.options), null);
  f.target.protectedRemaining = 0;
  assert.equal(meleeTarget(f.owner, f.actors, { ...f.options, isEnemy: () => false }), null);
});

test('existing frag and flash affect hidden occupants without directly changing occupancy; smoke does not eject', () => {
  for (const type of ['frag', 'flash', 'smoke']) {
    const f = fixture(), state = createGearCombatState();
    state.projectiles.push({ id: 'g', grenadeType: type, ownerId: 'owner', ownerLifeId: 1, x: 0, y: 1.6, z: -2,
      vx: 0, vy: 0, vz: 0, fuseRemaining: 0 });
    const result = stepGearCombat(state, f.actors, .01, f.options);
    assert.equal(result.damage.length, type === 'frag' ? 1 : 0);
    assert.equal(result.flashes.length, type === 'flash' ? 1 : 0);
    if (type === 'frag') assert.ok(Math.abs(result.damage[0].amount - 90 * (1 - 1.38 / 5)) < 1e-9);
    assert.equal(f.state.occupants.size, 1);
  }
  for (const protectedRemaining of [0, 1]) {
    const f = fixture(); f.target.protectedRemaining = protectedRemaining;
    const state = createGearCombatState();
    state.projectiles.push({ id: 'g', grenadeType: 'frag', ownerId: 'owner', ownerLifeId: 1, x: 0, y: 1.6, z: -8, vx: 0, vy: 0, vz: 0, fuseRemaining: 0 });
    assert.equal(stepGearCombat(state, f.actors, .01, f.options).damage.length, 0);
  }
});

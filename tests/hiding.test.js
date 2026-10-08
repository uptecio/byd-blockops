import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS } from '../src/maps.js';
import { createSpatialWorld } from '../src/spatial.js';
import { createGearActor } from './helpers/equipment-fixture.js';
import { createHidingState, requestHide, exitHiding, releaseHiding, hidingContext, attackExit, hidingDropPosition } from '../src/hiding.js';

export function hidingFixture() {
  const spot = { id: 'locker', entry: { x: 0, y: 0, z: 1.3 }, occupant: { x: 0, y: 0, z: 0 },
    exit: { x: 0, y: 0, z: 1.3 }, recovery: { x: 0, y: 0, z: 1.6 }, view: { x: 0, y: 1.65, z: .35 },
    proxy: { min: { x: -.62, y: 0, z: -.62 }, max: { x: .62, y: 2, z: .62 } }, shellIds: ['back'] };
  const map = { id: 'hide-test', bounds: { min: -20, max: 20 }, hideSpots: [spot],
    solids: [{ id: 'back', hideSpotId: 'locker', x: 0, z: -.59, w: 1.28, d: .1, height: 2 }] };
  const world = createSpatialWorld(map), state = createHidingState();
  const actor = createGearActor('a', { ...spot.entry, grounded: true, hiddenSpotId: null });
  const options = { map, world, active: true };
  return { spot, map, world, state, actor, options, action: { kind: 'enter', spotId: spot.id, lifeId: actor.lifeId } };
}

test('entry is life-safe, bounded, grounded, clear, and does not mutate the actor', () => {
  for (const extra of [{ z: 2.8001 }, { y: 3 }, { grounded: false }, { alive: false }, { lifeId: 2 }, { x: NaN }]) {
    const f = hidingFixture(), actor = { ...f.actor, ...extra }, before = structuredClone(actor);
    assert.equal(requestHide(f.state, actor, f.action, f.options).ok, false, JSON.stringify(extra));
    assert.deepEqual(actor, before); assert.equal(f.state.occupants.size, 0);
  }
  const f = hidingFixture(), actor = { ...f.actor, z: 2.8 }, before = structuredClone(actor);
  const result = requestHide(f.state, actor, f.action, f.options);
  assert.equal(result.ok, true); assert.equal(result.changed, true); assert.deepEqual(result.position, f.spot.occupant);
  assert.deepEqual(actor, before);
  const inactive = hidingFixture(); assert.equal(requestHide(inactive.state, inactive.actor, inactive.action, { ...inactive.options, active: false }).ok, false);
  const blocked = hidingFixture(); blocked.world.solids.push({ id: 'wall', x: 0, z: 1.9, w: 5, d: .1, minY: 0, maxY: 3 });
  assert.equal(requestHide(blocked.state, { ...blocked.actor, z: 2.8 }, blocked.action, blocked.options).ok, false);
});

test('one occupant wins; duplicate actions are idempotent and old-life release cannot evict', () => {
  const f = hidingFixture(), other = { ...f.actor, id: 'b' };
  assert.equal(requestHide(f.state, f.actor, f.action, f.options).ok, true);
  assert.equal(requestHide(f.state, other, f.action, f.options).ok, false);
  assert.equal(requestHide(f.state, f.actor, f.action, f.options).changed, false);
  assert.deepEqual(hidingContext(f.state, other, f.options), { spotId: f.spot.id, label: 'Occupied', enabled: false });
  releaseHiding(f.state, f.actor.id, 0); assert.equal(f.state.occupants.size, 1);
  assert.deepEqual(hidingDropPosition(f.state, f.actor, f.map), f.spot.exit);
  const leave = { ...f.action, kind: 'exit' };
  assert.equal(requestHide(f.state, f.actor, leave, f.options).changed, true);
  assert.equal(requestHide(f.state, f.actor, leave, f.options).changed, false);
  assert.equal(f.state.actors.size, 0); assert.equal(f.state.occupants.size, 0);
});

test('raw Fire exits a hidden player even while healing, dry or reloading; selection and movement do not', () => {
  for (const raw of [{ fire: true }, { firePressed: true }, { kind: 'throw', grenadeType: 'frag' }]) {
    const f = hidingFixture(); f.actor.equipment.supplies.health = 1;
    f.actor.equipment.supplyUse = { kind: 'health', remaining: 5 };
    const gun = f.actor.equipment.owned.get(f.actor.equipment.activeGunId);
    gun.ammo = 0; gun.reloadRemaining = 2;
    const before = structuredClone(f.actor.equipment);
    requestHide(f.state, f.actor, f.action, f.options);
    for (const input of [{ jump: true, x: 1 }, { kind: 'select', grenadeType: 'frag' }, {}]) {
      assert.equal(attackExit(f.state, f.actor, input, f.options), null);
      assert.equal(hidingContext(f.state, f.actor, f.options).label, 'Exit');
    }
    const result = attackExit(f.state, f.actor, raw, f.options);
    assert.equal(result.ok, true); assert.equal(result.hiddenSpotId, null); assert.deepEqual(result.position, f.spot.exit);
    assert.deepEqual(f.actor.equipment, before); assert.equal(f.state.occupants.size, 0);
  }
});

test('safe exits use authored recovery only; context ties are deterministic and no timer ejects', () => {
  const f = hidingFixture(); f.map.hideSpots.push({ ...f.spot, id: 'aardvark' });
  assert.equal(hidingContext(f.state, f.actor, f.options).spotId, 'aardvark');
  requestHide(f.state, f.actor, f.action, f.options);
  for (let n = 0; n < 1000; n++) assert.equal(hidingContext(f.state, f.actor, f.options).label, 'Exit');
  f.world.solids.push({ id: 'obstacle', x: 0, z: .9, w: 1, d: .1, minY: 0, maxY: 3 });
  const result = exitHiding(f.state, f.actor, f.options);
  assert.deepEqual(result.position, f.spot.recovery);
});

for (const map of MAPS) test(`${map.id}: all authored hiding anchors enter and exit safely`, () => {
  const world = createSpatialWorld(map), state = createHidingState();
  for (const spot of map.hideSpots) {
    const actor = createGearActor('a', { ...spot.entry, grounded: true });
    assert.equal(requestHide(state, actor, { kind: 'enter', spotId: spot.id, lifeId: 1 }, { map, world, active: true }).ok, true);
    assert.deepEqual(exitHiding(state, actor, { map, world }).position, spot.exit);
  }
});

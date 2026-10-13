import test from 'node:test';
import assert from 'node:assert/strict';
import { RANGE_TARGETS } from '../src/range-map.js';
import { HEADSHOT_DAMAGE, gunHitDamage } from '../src/gun-damage.js';
import { MAX_XP } from '../src/progression.js';
import { createRangeState, rangeSnapshot, rangeTargetBounds, rangeHitRegion,
  traceRangeRay, applyRangeHit, recordRangeShot, tickRangeTargets } from '../src/range-rules.js';

const dummy = { id: 'dummy', kind: 'dummy', x: 0, y: 0, z: 0 };
const bullseye = { id: 'bullseye', kind: 'bullseye', x: 0, y: 0, z: 0 };
const ray = (y = 1, x = 0) => ({ origin: { x, y, z: 10 }, direction: { x: 0, y: 0, z: -1 }, range: 20, solids: [] });
const noHit = { landed: false, killed: false, damage: 0, kill: null };

// Catches an anatomical threshold moved to >=, imprecise centre edges, and renderer/hitbox drift.
test('target bounds and precision regions use exact shared dimensions', () => {
  assert.deepEqual(rangeTargetBounds(dummy), { min: { x: -.32, y: .05, z: -.32 }, max: { x: .32, y: 1.84, z: .32 } });
  assert.deepEqual(rangeTargetBounds(bullseye), { min: { x: -.6, y: .75, z: -.05 }, max: { x: .6, y: 1.95, z: .05 } });
  assert.deepEqual(rangeTargetBounds({ ...dummy, x: 2, y: 3, z: 4 }), {
    min: { x: 1.68, y: 3.05, z: 3.68 }, max: { x: 2.32, y: 4.84, z: 4.32 },
  });
  assert.equal(rangeHitRegion(dummy, { x: dummy.x, y: 1.48, z: dummy.z }), 'body');
  assert.equal(rangeHitRegion(dummy, { x: dummy.x, y: 1.481, z: dummy.z }), 'head');
  for (const x of [-.15, .15]) for (const y of [1.2, 1.5]) {
    assert.equal(rangeHitRegion(bullseye, { x, y, z: 0 }), 'centre');
  }
  for (const [x, y] of [[-.151, 1.35], [.151, 1.35], [0, 1.199], [0, 1.501]]) {
    assert.equal(rangeHitRegion(bullseye, { x, y, z: 0 }), 'body');
  }
});

// Catches missing damage, health, counters, or attribution to any hit except the killing hit.
test('100 health and killing-hit precision', () => {
  const state = createRangeState([dummy]);
  assert.equal(rangeSnapshot(state).targets[0].health, 100);
  const bodyHit = traceRangeRay(state, ray());
  assert.deepEqual(applyRangeHit(state, bodyHit, 25), { landed: true, killed: false, damage: 25, kill: null });
  assert.equal(rangeSnapshot(state).targets[0].health, 75);
  const headHit = traceRangeRay(state, ray(1.481));
  assert.deepEqual(applyRangeHit(state, headHit, 25), {
    landed: true, killed: true, damage: 10000000000, kill: { targetId: 'dummy', lifeId: 1, region: 'head' },
  });
  assert.equal(HEADSHOT_DAMAGE, 10000000000);
  assert.equal(gunHitDamage(25, 1.48, 0), 25);
  assert.equal(gunHitDamage(25, 1.481, 0), HEADSHOT_DAMAGE);
  assert.equal(rangeSnapshot(state).targetKills, 1);
  assert.equal(rangeSnapshot(state).precisionKills, 1);
  const ordinary = createRangeState([dummy]);
  const ordinaryHit = traceRangeRay(ordinary, ray());
  assert.equal(applyRangeHit(ordinary, ordinaryHit, 100).kill.region, 'body');
  assert.equal(rangeSnapshot(ordinary).precisionKills, 0);
  const centre = createRangeState([bullseye]);
  assert.equal(applyRangeHit(centre, traceRangeRay(centre, ray(1.35)), 25).damage, 10000000000);
  assert.equal(rangeSnapshot(centre).precisionKills, 1);
});

// Catches wall-time respawns, early respawns, and retaining dead health/life on respawn.
test('five active seconds per life', () => {
  const makeDead = () => {
    const state = createRangeState([dummy]);
    applyRangeHit(state, traceRangeRay(state, ray()), 100);
    return state;
  };
  const state = makeDead();
  assert.equal(rangeSnapshot(state).targets[0].respawnRemaining, 5);
  tickRangeTargets(state, 0);
  assert.equal(rangeSnapshot(state).targets[0].health, 0);
  tickRangeTargets(state, 4.999);
  assert.equal(rangeSnapshot(state).targets[0].health, 0);
  assert.equal(traceRangeRay(state, ray()), null);
  const atFive = makeDead();
  tickRangeTargets(atFive, 5);
  assert.deepEqual(rangeSnapshot(atFive).targets[0], { ...dummy, health: 100, lifeId: 2, respawnRemaining: 0 });
  const stepped = makeDead();
  tickRangeTargets(stepped, 2);
  tickRangeTargets(stepped, 3);
  assert.equal(rangeSnapshot(stepped).targets[0].lifeId, 2);
  tickRangeTargets(stepped, 100);
  assert.equal(rangeSnapshot(stepped).targets[0].lifeId, 2);
  const fractional = makeDead();
  tickRangeTargets(fractional, 4.999);
  tickRangeTargets(fractional, .001);
  assert.equal(rangeSnapshot(fractional).targets[0].health, 100);
  for (const framesPerSecond of [60, 120]) {
    const frames = makeDead();
    for (let frame = 0; frame < framesPerSecond * 5 - 1; frame++) tickRangeTargets(frames, 1 / framesPerSecond);
    assert.equal(rangeSnapshot(frames).targets[0].health, 0, `${framesPerSecond}Hz must not respawn before five seconds`);
    tickRangeTargets(frames, 1 / framesPerSecond);
    assert.equal(rangeSnapshot(frames).targets[0].health, 100, `${framesPerSecond}Hz must respawn at five seconds`);
  }
  const almostFive = makeDead();
  tickRangeTargets(almostFive, 5 - 1e-9);
  assert.equal(rangeSnapshot(almostFive).targets[0].health, 0);
});

// Catches insertion-order target selection, cover penetration, and rays exceeding their range.
test('nearest target respects cover', () => {
  const state = createRangeState([{ ...dummy, id: 'far', z: -5 }, dummy]);
  const hit = traceRangeRay(state, ray());
  assert.ok(hit, 'a clear ray must hit the nearest target');
  assert.equal(hit.targetId, 'dummy');
  assert.equal(hit.distance, 9.68);
  assert.deepEqual(hit.point, { x: 0, y: 1, z: .3200000000000003 });
  assert.equal(traceRangeRay(state, { ...ray(), range: 9 }), null);
  const cover = { x: 0, z: 5, w: 2, d: 1, height: 2 };
  assert.equal(traceRangeRay(state, { ...ray(), solids: [cover] }), null);
  assert.equal(traceRangeRay(state, { ...ray(), solids: [{ ...cover, z: -2 }] }).targetId, 'dummy');
  assert.equal(traceRangeRay(state, { ...ray(), solids: [{ ...cover, z: 0, d: .64 }] }), null);
  assert.equal(traceRangeRay(state, ray(1, 2)), null);
  assert.equal(traceRangeRay(state, { ...ray(), direction: { x: 0, y: 0, z: -10 } }).distance, 9.68);
});

// Catches duplicate pellet awards and stale-life damage after respawn.
test('pellets cannot duplicate a life', () => {
  const state = createRangeState([dummy]);
  const hit = traceRangeRay(state, ray());
  assert.equal(applyRangeHit(state, hit, 100).killed, true);
  assert.deepEqual(applyRangeHit(state, hit, 100), noHit);
  tickRangeTargets(state, 5);
  assert.deepEqual(applyRangeHit(state, hit, 100), noHit);
  assert.equal(rangeSnapshot(state).targets[0].health, 100);
  assert.equal(rangeSnapshot(state).targetKills, 1);
  assert.deepEqual(applyRangeHit(state, { ...hit, targetId: 'missing' }, 100), noHit);
});

// Catches counting pellets as separate shots and overflow above the integer-stat cap.
test('one accuracy hit per shot', () => {
  const state = createRangeState([dummy]);
  assert.equal(rangeSnapshot(state).accuracy, 0);
  const hit = traceRangeRay(state, ray());
  for (let pellet = 0; pellet < 3; pellet++) applyRangeHit(state, hit, 25);
  recordRangeShot(state, true);
  recordRangeShot(state, false);
  assert.equal(rangeSnapshot(state).shotsFired, 2);
  assert.equal(rangeSnapshot(state).shotsHit, 1);
  assert.equal(rangeSnapshot(state).accuracy, 50);
  state.shotsFired = MAX_XP;
  state.shotsHit = MAX_XP;
  state.targetKills = MAX_XP;
  state.precisionKills = MAX_XP;
  recordRangeShot(state, true);
  applyRangeHit(state, traceRangeRay(state, ray(1.6)), 25);
  const snapshot = rangeSnapshot(state);
  assert.equal(snapshot.shotsFired, MAX_XP);
  assert.equal(snapshot.shotsHit, MAX_XP);
  assert.equal(snapshot.targetKills, MAX_XP);
  assert.equal(snapshot.precisionKills, MAX_XP);
  assert.equal(snapshot.accuracy, 100);
});

// Catches mutations through either returned snapshots or caller-owned target descriptors.
test('snapshots and visit states are detached', () => {
  const source = [{ ...dummy }];
  const state = createRangeState(source);
  source[0].x = 15;
  const snapshot = rangeSnapshot(state);
  snapshot.targets[0].health = 0;
  snapshot.targets[0].x = 20;
  snapshot.targets.push(bullseye);
  snapshot.shotsFired = 5;
  assert.deepEqual(rangeSnapshot(state).targets, [{ ...dummy, health: 100, lifeId: 1, respawnRemaining: 0 }]);
  assert.equal(rangeSnapshot(state).shotsFired, 0);
  assert.equal(rangeSnapshot(createRangeState()).targets.length, RANGE_TARGETS.length);
});

// Catches partial mutations on rejected numbers and accidental coercion of malformed inputs.
test('invalid numeric inputs are rejected', () => {
  for (const value of [NaN, Infinity, -Infinity, -1, '1', null, undefined]) {
    const state = createRangeState([dummy]);
    const before = rangeSnapshot(state);
    const hit = traceRangeRay(state, ray());
    assert.throws(() => tickRangeTargets(state, value), RangeError);
    assert.throws(() => applyRangeHit(state, hit, value), RangeError);
    assert.throws(() => traceRangeRay(state, { ...ray(), range: value }), RangeError);
    assert.throws(() => applyRangeHit(state, { ...hit, distance: value }, 25), RangeError);
    assert.deepEqual(rangeSnapshot(state), before);
  }
  const state = createRangeState([dummy]);
  const hit = traceRangeRay(state, ray());
  for (const bad of [null, {}, { ...dummy, y: -1 }, { ...dummy, x: NaN }, { ...dummy, kind: 'enemy' }]) {
    assert.throws(() => createRangeState([bad]), RangeError);
    assert.throws(() => rangeTargetBounds(bad), RangeError);
  }
  assert.throws(() => createRangeState([dummy, dummy]), RangeError);
  assert.throws(() => createRangeState(null), RangeError);
  assert.throws(() => rangeHitRegion(dummy, { x: 0, y: NaN, z: 0 }), RangeError);
  for (const bad of [null, {}, { ...ray(), origin: { x: NaN, y: 1, z: 0 } },
    { ...ray(), direction: { x: 0, y: 0, z: 0 } }, { ...ray(), solids: [{}] }]) {
    assert.throws(() => traceRangeRay(state, bad), RangeError);
  }
  for (const bad of [null, {}, { ...hit, lifeId: -1 }, { ...hit, lifeId: 1.5 },
    { ...hit, region: 'centre' }, { ...hit, point: { x: NaN, y: 1, z: 0 } }]) {
    assert.throws(() => applyRangeHit(state, bad, 25), RangeError);
  }
  for (const value of [0, 1, null, undefined, 'true']) assert.throws(() => recordRangeShot(state, value), RangeError);
  assert.equal(applyRangeHit(state, hit, 0).damage, 0);
  assert.equal(rangeSnapshot(state).targets[0].health, 100);
});

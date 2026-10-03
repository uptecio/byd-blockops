import test from 'node:test';
import assert from 'node:assert/strict';
import { GEAR_BALANCE } from '../src/equipment-catalog.js';
import { pickupEquipment, equipmentDTO, tickEquipment } from '../src/equipment.js';
import { createGearActor } from './helpers/equipment-fixture.js';
import * as combat from '../src/gear-combat.js';

const { createGearCombatState, meleeTarget, throwGrenade, stepGearCombat, smokeBlocksSight, gearCombatDTO } = combat;
const enemy = (a, b) => a !== b && !['mate', 'owner'].includes(b);
const options = { solids: [], isEnemy: enemy };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

function armed(id = 'owner', type = 'frag', overrides = {}) {
  const actor = createGearActor(id, overrides);
  pickupEquipment(actor.equipment, { kind: 'grenade', grenadeType: type });
  return actor;
}

// A complete projectile fixture isolates numerical detonation rules from launch motion.
function burstState(type = 'frag', overrides = {}) {
  const state = createGearCombatState();
  state.projectiles.push({ id: 'g1', grenadeType: type, ownerId: 'owner', ownerTeamId: 'red', ownerLifeId: 1,
    x: 0, y: 1.6, z: 0, vx: 0, vy: 0, vz: 0, fuseRemaining: 0, ...overrides });
  if (type === 'smoke') state.reservedSmoke = 1;
  return state;
}

test('shared knife and grenade balance matches the approved combat values', () => {
  assert.deepEqual(GEAR_BALANCE.knife, { damage: 50, reach: 1.8, halfAngle: Math.PI / 6, interval: .6 });
  assert.deepEqual(GEAR_BALANCE.grenades.frag, { fuse: 2, radius: 5, maxDamage: 90 });
  assert.deepEqual(GEAR_BALANCE.grenades.smoke, { fuse: 2, radius: 4, duration: 8 });
  assert.deepEqual(GEAR_BALANCE.grenades.flash, { fuse: 1.25, radius: 10, maxDuration: 3 });
});

test('melee chooses nearest visible enemy and stable ID ties without hitting teammates', () => {
  const a = createGearActor('owner');
  const actors = [createGearActor('far', { z: -1.7 }), createGearActor('mate', { z: -.2 }),
    createGearActor('z', { z: -1 }), createGearActor('a', { z: -1 })];
  assert.equal(meleeTarget(a, actors, options), 'a');
  assert.equal(a.equipment.meleeRemaining, 0);
});

test('melee rejects out of reach, outside cone, vertically separated, dead and protected enemies', () => {
  const a = createGearActor('owner');
  for (const target of [
    { z: -1.81 }, { x: 1, z: -1 }, { y: 2, z: -.1 },
    { z: -1, alive: false }, { z: -1, protectedRemaining: .1 },
  ]) assert.equal(meleeTarget(a, [createGearActor('foe', target)], options), null);
  assert.equal(meleeTarget({ ...a, alive: false }, [createGearActor('foe', { z: -1 })], options), null);
  assert.equal(meleeTarget(a, [createGearActor('foe', { z: -1.8 })], options), 'foe');
  assert.equal(meleeTarget(a, [createGearActor('foe', { x: .75, z: -1.3 })], options), 'foe');
});

test('melee respects pitched aim and intervening cover', () => {
  const a = createGearActor('owner', { pitch: Math.PI / 4 });
  assert.equal(meleeTarget(a, [createGearActor('foe', { y: 1, z: -1 })], options), 'foe');
  const solids = [{ x: 0, z: -.5, w: 2, d: .1, height: 3 }];
  assert.equal(meleeTarget(createGearActor('owner'), [createGearActor('foe', { z: -1 })], { ...options, solids }), null);
});

test('accepted throw consumes one item and starts both locks', () => {
  const state = createGearCombatState(), actor = createGearActor('a');
  pickupEquipment(actor.equipment, { kind: 'grenade', grenadeType: 'smoke' });
  assert.equal(throwGrenade(state, actor, 'smoke', { solids: [] }).ok, true);
  assert.equal(actor.equipment.grenades.smoke, 0);
  assert.equal(actor.equipment.throwRemaining, .65);
  assert.equal(actor.equipment.attackLockRemaining, .25);
  assert.equal(gearCombatDTO(state).projectiles.length, 1);
  const projectile = gearCombatDTO(state).projectiles[0];
  near(projectile.vx, 0); near(projectile.vy, 3); near(projectile.vz, -12);
  assert.equal(projectile.fuseRemaining, 2);
  assert.equal(projectile.ownerId, 'a');
  assert.equal(projectile.ownerLifeId, 1);
  assert.equal(actor.equipment.startingGunRemoved, false);
  assert.deepEqual(stepGearCombat(state, [actor], .01, options).events[0],
    { type: 'grenade-throw', playerId: 'a', grenadeId: projectile.id, grenadeType: 'smoke' });
});

test('invalid throws preserve stock, timers, IDs and world state', () => {
  for (const [overrides, type, solids] of [
    [{ alive: false }, 'frag', []], [{ yaw: NaN }, 'frag', []], [{}, 'gas', []],
    [{}, 'frag', [{ x: 0, z: -.3, w: 2, d: .1, height: 3 }]],
    [{}, 'frag', [{ x: 0, z: -.2, w: 2, d: .01, height: 3 }]],
  ]) {
    const state = createGearCombatState(), a = armed('owner', 'frag', overrides);
    const beforeGear = equipmentDTO(a.equipment), beforeWorld = structuredClone(state);
    assert.equal(throwGrenade(state, a, type, { solids }).ok, false);
    assert.deepEqual(equipmentDTO(a.equipment), beforeGear);
    assert.deepEqual(state, beforeWorld);
  }
  const state = createGearCombatState(), a = armed();
  throwGrenade(state, a, 'frag', options);
  pickupEquipment(a.equipment, { kind: 'grenade', grenadeType: 'frag' });
  assert.equal(throwGrenade(state, a, 'frag', options).ok, false);
  assert.equal(a.equipment.grenades.frag, 1);
});

test('live projectile capacity accepts 32 and rejects the next without spending stock', () => {
  const state = createGearCombatState();
  for (let i = 0; i < 32; i++) assert.equal(throwGrenade(state, armed(`p${i}`), 'frag', options).ok, true);
  const a = armed('extra');
  assert.equal(throwGrenade(state, a, 'frag', options).ok, false);
  assert.equal(a.equipment.grenades.frag, 1);
  assert.equal(gearCombatDTO(state).projectiles.length, 32);
});

test('smoke reserves 16 combined active and airborne slots until expiry', () => {
  const state = createGearCombatState();
  const owners = [];
  for (let i = 0; i < 16; i++) {
    const a = armed(`p${i}`, 'smoke'); owners.push(a);
    assert.equal(throwGrenade(state, a, 'smoke', options).ok, true);
  }
  const extra = armed('extra', 'smoke');
  assert.equal(throwGrenade(state, extra, 'smoke', options).ok, false);
  assert.equal(extra.equipment.grenades.smoke, 1);
  state.projectiles[0].fuseRemaining = 0;
  stepGearCombat(state, owners, .01, options);
  assert.equal(state.smokes.length, 1);
  assert.equal(state.projectiles.length, 15);
  assert.equal(throwGrenade(state, extra, 'smoke', options).ok, false);
  stepGearCombat(state, owners, 20, options);
  assert.equal(state.smokes.length, 0);
  assert.equal(state.reservedSmoke, 0);
  assert.equal(throwGrenade(state, extra, 'smoke', options).ok, true);
});

test('frag damage falls linearly and excludes self, teammates, dead and protected targets', () => {
  const state = burstState();
  const actors = [createGearActor('owner'), createGearActor('mate'), createGearActor('mid', { x: 2.5 }),
    createGearActor('full'), createGearActor('edge', { x: 5 }), createGearActor('dead', { alive: false }),
    createGearActor('safe', { protectedRemaining: 1 })];
  const result = stepGearCombat(state, actors, .1, options);
  assert.deepEqual(result.damage, [
    { sourceId: 'owner', sourceLifeId: 1, targetId: 'full', amount: 90 },
    { sourceId: 'owner', sourceLifeId: 1, targetId: 'mid', amount: 45 },
  ]);
  assert.deepEqual(result.flashes, []);
  assert.equal(result.events.filter(e => e.type === 'grenade-burst').length, 1);
  assert.deepEqual(stepGearCombat(state, actors, 50, options), { damage: [], flashes: [], events: [] });
});

test('solid cover blocks blast and flash while low cover permits eye-height effects', () => {
  const actors = [createGearActor('owner'), createGearActor('foe', { x: 2, yaw: Math.PI / 2 })];
  for (const type of ['frag', 'flash']) {
    const blocked = stepGearCombat(burstState(type), actors, .1, { ...options,
      solids: [{ x: 1, z: 0, w: .1, d: 4, height: 3 }] });
    assert.deepEqual(blocked.damage, []); assert.deepEqual(blocked.flashes, []);
    const clear = stepGearCombat(burstState(type), actors, .1, { ...options,
      solids: [{ x: 1, z: 0, w: .1, d: 4, height: 1 }] });
    assert.equal(clear.damage.length + clear.flashes.length, 1);
  }
});

test('flash has full, side and behind facing falloff with bounded refresh', () => {
  const actors = [createGearActor('owner'), createGearActor('front', { z: 5 }),
    createGearActor('side', { x: 5 }), createGearActor('behind', { z: -5 }),
    createGearActor('mate'), createGearActor('safe', { protectedRemaining: 1 }),
    createGearActor('dead', { alive: false })];
  const result = stepGearCombat(burstState('flash'), actors, .1, options);
  assert.deepEqual(result.damage, []);
  const flashes = new Map(result.flashes.map(f => [f.targetId, f.duration]));
  near(flashes.get('front'), 1.5);
  near(flashes.get('side'), 1.21875);
  near(flashes.get('behind'), .375);
  assert.equal(flashes.size, 3);
  const target = createGearActor('foe', { flashRemaining: 2.8 });
  for (let i = 0; i < 4; i++) {
    const [intent] = stepGearCombat(burstState('flash'), [actors[0], target], .1, options).flashes;
    assert.ok(intent.duration <= 3);
    target.flashRemaining = Math.min(3, Math.max(target.flashRemaining, intent.duration));
  }
  assert.equal(target.flashRemaining, 3);
});

test('dead and respawned owners retain old-life credit but disconnected owners cause visual effects only', () => {
  const foe = createGearActor('foe');
  for (const owner of [createGearActor('owner', { alive: false }), createGearActor('owner', { lifeId: 2 })]) {
    const state = burstState();
    const result = stepGearCombat(state, [owner, foe], .1, options);
    assert.equal(result.damage[0].sourceLifeId, 1);
    assert.equal(result.damage[0].amount, 90);
    assert.equal(stepGearCombat(state, [owner, foe], .1, options).damage.length, 0);
  }
  for (const type of ['frag', 'flash', 'smoke']) {
    const state = burstState(type);
    const result = stepGearCombat(state, [foe], .1, options);
    assert.deepEqual(result.damage, []); assert.deepEqual(result.flashes, []);
    assert.equal(result.events.length, 1);
    assert.equal(state.smokes.length, type === 'smoke' ? 1 : 0);
  }
});

test('permanently visual-only grenades retain identities without harming rejoined owners opponents', () => {
  for (const type of ['frag', 'flash', 'smoke']) {
    const state = burstState(type, { visualOnly: true });
    const dto = gearCombatDTO(state);
    assert.equal(Object.hasOwn(dto.projectiles[0], 'visualOnly'), false);
    assert.equal(dto.projectiles[0].ownerId, 'owner'); assert.equal(dto.projectiles[0].ownerLifeId, 1);
    const actors = [createGearActor('owner', { lifeId: 2 }), createGearActor('foe')];
    const result = stepGearCombat(state, actors, .1, options);
    assert.deepEqual(result.damage, []); assert.deepEqual(result.flashes, []); assert.equal(result.events.length, 1);
    assert.equal(state.smokes.length, type === 'smoke' ? 1 : 0);
    stepGearCombat(state, actors, 8, options); assert.equal(state.smokes.length, 0);
  }
});

test('smoke uses an elevated sphere, overlapping sight blockers and elapsed expiry', () => {
  const state = burstState('smoke', { y: .12 });
  stepGearCombat(state, [], .5, options);
  assert.equal(state.smokes[0].y, 2.12);
  assert.equal(state.smokes[0].radius, 4);
  near(state.smokes[0].remaining, 7.5);
  const smokes = [{ x: 0, y: 2, z: 0, radius: 4, remaining: 8 },
    { x: 3, y: 2, z: 0, radius: 4, remaining: 8 }];
  assert.equal(smokeBlocksSight({ x: -8, y: 2, z: 0 }, { x: 8, y: 2, z: 0 }, smokes), true);
  assert.equal(smokeBlocksSight({ x: 0, y: 2, z: 0 }, { x: 1, y: 2, z: 0 }, smokes), true);
  assert.equal(smokeBlocksSight({ x: -8, y: 7, z: 0 }, { x: 8, y: 7, z: 0 }, smokes), false);
  assert.equal(smokeBlocksSight({ x: 0, y: 2, z: 0 }, { x: 0, y: 2, z: 0 }, smokes), true);
  assert.equal(smokeBlocksSight({ x: -8, y: 2, z: 0 }, { x: 8, y: 2, z: 0 }, smokes.map(s => ({ ...s, remaining: 0 }))), false);
  stepGearCombat(state, [], 7.5, options);
  assert.deepEqual(gearCombatDTO(state).smokes, []);
});

test('large steps sweep thin cover, bounce with damping and never detonate twice', () => {
  const state = burstState('frag', { x: -2, y: 1.6, vx: 12, vy: 0, fuseRemaining: 2 });
  const solids = [{ x: 0, z: 0, w: .01, d: 50, height: 20 }];
  const first = stepGearCombat(state, [createGearActor('owner')], .3, { ...options, solids });
  assert.equal(first.events.length, 0);
  assert.ok(state.projectiles[0].x < -.125);
  near(state.projectiles[0].vx, -4.2);
  const final = stepGearCombat(state, [createGearActor('owner')], 100, { ...options, solids });
  assert.equal(final.events.length, 1);
  assert.equal(gearCombatDTO(state).projectiles.length, 0);
  assert.equal(stepGearCombat(state, [], 100, options).events.length, 0);
});

test('ground collision damps tangential motion and settles instead of micro-bouncing', () => {
  const state = burstState('frag', { y: .12, vx: 1, vy: -2, fuseRemaining: 2 });
  stepGearCombat(state, [], .001, options);
  near(state.projectiles[0].vx, .7);
  assert.ok(state.projectiles[0].vy > 0 && state.projectiles[0].vy < .71);
  stepGearCombat(state, [], 1, options);
  assert.equal(state.projectiles[0].y, .12);
  assert.equal(state.projectiles[0].vy, 0);
});

test('DTO copies are detached and invalid time steps leave all world state intact', () => {
  const state = createGearCombatState(), actor = armed();
  throwGrenade(state, actor, 'frag', options);
  const before = structuredClone(state);
  for (const dt of [0, -1, NaN, Infinity, '1', null]) {
    assert.deepEqual(stepGearCombat(state, [actor], dt, options), { damage: [], flashes: [], events: [] });
    assert.deepEqual(state, before);
  }
  const dto = gearCombatDTO(state);
  dto.projectiles[0].x = 999;
  assert.equal(gearCombatDTO(state).projectiles[0].x, 0);
  const smoke = burstState('smoke');
  stepGearCombat(smoke, [], .01, options);
  const smokeDTO = gearCombatDTO(smoke); smokeDTO.smokes[0].remaining = 0;
  assert.ok(smoke.smokes[0].remaining > 0);
  tickEquipment(actor.equipment, 1);
});

test('settling on ground still sweeps nearby thin walls', () => {
  const state = burstState('frag', { x: -.131, y: .12, vx: 12, vy: -.1, fuseRemaining: 2 });
  stepGearCombat(state, [], .001, { ...options, solids: [{ x: 0, z: 0, w: .01, d: 4, height: 3 }] });
  assert.ok(state.projectiles[0].x <= -.125);
  assert.ok(state.projectiles[0].vx < 0);
});

test('flash remains full through 60 degrees and vanishes at its radius', () => {
  const actors = [createGearActor('owner'), createGearActor('angle', { z: 5, yaw: Math.PI / 3 }),
    createGearActor('edge', { z: 10 }), createGearActor('outside', { z: 11 })];
  const result = stepGearCombat(burstState('flash'), actors, .1, options);
  assert.equal(result.flashes.length, 1);
  near(result.flashes[0].duration, 1.5);
});

test('smoke ages only after detonation and huge finite ticks expire effects with bounded work', () => {
  const state = burstState('smoke', { y: .12, fuseRemaining: 2 });
  stepGearCombat(state, [], 2.5, options);
  assert.equal(state.smokes.length, 1);
  near(state.smokes[0].remaining, 7.5);
  const other = burstState('smoke', { y: .12, fuseRemaining: 2 });
  assert.equal(stepGearCombat(other, [], Number.MAX_VALUE, options).events.length, 1);
  assert.deepEqual(gearCombatDTO(other), { projectiles: [], smokes: [] });
});

test('burst and damage order is chronological then stable ID regardless of actor input order', () => {
  const state = burstState('frag', { id: 'z', fuseRemaining: .2 });
  state.projectiles.push({ ...state.projectiles[0], id: 'b', fuseRemaining: .1 });
  state.projectiles.push({ ...state.projectiles[0], id: 'a', fuseRemaining: .1 });
  const actors = [createGearActor('zfoe'), createGearActor('owner'), createGearActor('afoe')];
  const result = stepGearCombat(state, actors, .3, options);
  assert.deepEqual(result.events.map(event => event.grenadeId), ['a', 'b', 'z']);
  assert.deepEqual(result.damage.map(intent => intent.targetId), ['afoe', 'zfoe', 'afoe', 'zfoe', 'afoe', 'zfoe']);
  assert.ok(actors.every(actor => actor.flashRemaining === 0));
});

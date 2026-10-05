import test from 'node:test';
import assert from 'node:assert/strict';
import { createEquipment } from '../src/equipment.js';
import { damageVitals } from '../src/vitals.js';
import { SUPPLY_TYPES, SUPPLY_NAMES, SUPPLY_BALANCE, createSupplyState, startSupplyUse,
  cancelSupplyUse, advanceSupplyUse, isUsingSupply, chooseBotSupply } from '../src/supplies.js';

const live = { active: true, alive: true };
function fixture() {
  const e = Object.assign(createEquipment('m4a1'), createSupplyState());
  e.supplies.health = 2;
  e.supplies.armour = 2;
  return { e, v: { health: 12, armour: 0 } };
}

test('supply constants and fresh state are detached', () => {
  assert.deepEqual(SUPPLY_TYPES, ['health', 'armour']);
  assert.deepEqual(SUPPLY_NAMES, { health: 'Health Pack', armour: 'Armour Pack' });
  assert.deepEqual(SUPPLY_BALANCE, { capacity: 3, useSeconds: 5, armourGain: 50 });
  assert.ok(Object.isFrozen(SUPPLY_BALANCE));
  const a = createSupplyState(), b = createSupplyState();
  a.supplies.health = 3;
  assert.deepEqual(b, { supplies: { health: 0, armour: 0 }, supplyUse: null });
});

test('five seconds consumes one health pack once', () => {
  const { e, v } = fixture();
  assert.equal(startSupplyUse(e, v, 'health', live).ok, true);
  assert.equal(isUsingSupply(e), true);
  assert.equal(advanceSupplyUse(e, v, 4.999, live).status, 'pending');
  assert.equal(v.health, 12);
  assert.equal(e.supplies.health, 2);
  assert.deepEqual(advanceSupplyUse(e, v, .001, live), { status: 'completed', supplyType: 'health' });
  assert.equal(v.health, 100);
  assert.equal(e.supplies.health, 1);
  assert.equal(e.supplyUse, null);
  assert.equal(isUsingSupply(e), false);
  assert.deepEqual(advanceSupplyUse(e, v, 5, live), { status: 'idle', supplyType: null });
});

test('one large step and one hundred small steps finish together', () => {
  const a = fixture(), b = fixture();
  for (const f of [a, b]) startSupplyUse(f.e, f.v, 'health', live);
  advanceSupplyUse(a.e, a.v, 5, live);
  for (let i = 0; i < 100; i++) {
    assert.equal(advanceSupplyUse(b.e, b.v, .05, live).status, i === 99 ? 'completed' : 'pending');
  }
  assert.deepEqual(a, b);
});

test('armour adds fifty and caps', () => {
  for (const [before, after] of [[0, 50], [50, 100], [90, 100]]) {
    const { e, v } = fixture(); v.armour = before;
    assert.equal(startSupplyUse(e, v, 'armour', live).ok, true);
    assert.equal(advanceSupplyUse(e, v, 5, live).status, 'completed');
    assert.deepEqual(v, { health: 12, armour: after });
    assert.deepEqual(e.supplies, { health: 2, armour: 1 });
  }
});

test('no resource waste', () => {
  for (const type of SUPPLY_TYPES) {
    const { e, v } = fixture(); v[type] = 100;
    assert.equal(startSupplyUse(e, v, type, live).ok, false);
    assert.equal(e.supplyUse, null);
    v[type] = 40;
    assert.equal(startSupplyUse(e, v, type, live).ok, true);
    v[type] = 100;
    assert.deepEqual(advanceSupplyUse(e, v, 5, live), { status: 'cancelled', supplyType: type });
    assert.equal(e.supplies[type], 2);
    assert.equal(e.supplyUse, null);
  }
});

test('hit preserves use', () => {
  const { e, v } = fixture(); v.health = 80; v.armour = 20;
  startSupplyUse(e, v, 'health', live);
  const operation = e.supplyUse;
  advanceSupplyUse(e, v, 2, live);
  damageVitals(v, 40);
  assert.equal(e.supplyUse, operation);
  assert.equal(operation.remaining, 3);
  assert.equal(advanceSupplyUse(e, v, 3, live).status, 'completed');
  assert.deepEqual(v, { health: 100, armour: 0 });
});

test('dead completion cannot heal', () => {
  for (const options of [live, { active: true, alive: false }, { active: false, alive: true }]) {
    const { e, v } = fixture();
    startSupplyUse(e, v, 'health', live);
    v.health = 0;
    assert.equal(advanceSupplyUse(e, v, 5, options).status, 'cancelled');
    assert.equal(v.health, 0);
    assert.equal(e.supplies.health, 2);
    assert.equal(e.supplyUse, null);
  }
});

test('inactive actors cancel without consumption', () => {
  const { e, v } = fixture(); startSupplyUse(e, v, 'health', live);
  assert.equal(advanceSupplyUse(e, v, 0, { active: false, alive: true }).status, 'cancelled');
  assert.equal(e.supplies.health, 2); assert.equal(v.health, 12);
});

test('cancel and type switch', () => {
  const { e, v } = fixture();
  assert.deepEqual(cancelSupplyUse(e), { ok: true, changed: false });
  startSupplyUse(e, v, 'health', live); advanceSupplyUse(e, v, 2, live);
  const old = e.supplyUse;
  assert.equal(startSupplyUse(e, v, 'invalid', live).ok, false);
  assert.equal(e.supplyUse, old); assert.equal(old.remaining, 3);
  e.supplies.armour = 0;
  assert.equal(startSupplyUse(e, v, 'armour', live).ok, false);
  assert.equal(e.supplyUse, old);
  e.supplies.armour = 2;
  assert.equal(startSupplyUse(e, v, 'armour', live).ok, true);
  assert.notEqual(e.supplyUse, old);
  assert.deepEqual(e.supplyUse, { type: 'armour', remaining: 5 });
  assert.deepEqual(cancelSupplyUse(e), { ok: true, changed: true });
  assert.deepEqual(e.supplies, { health: 2, armour: 2 });
});

test('duplicate start cannot postpone finish', () => {
  const { e, v } = fixture(); startSupplyUse(e, v, 'health', live);
  advanceSupplyUse(e, v, 4, live);
  const operation = e.supplyUse;
  assert.equal(startSupplyUse(e, v, 'health', live).ok, false);
  assert.equal(e.supplyUse, operation); assert.equal(operation.remaining, 1);
  assert.equal(advanceSupplyUse(e, v, 1, live).status, 'completed');
});

test('reload/melee/throw gate', () => {
  for (const timer of ['reloadRemaining', 'meleeRemaining', 'attackLockRemaining']) {
    const { e, v } = fixture();
    if (timer === 'reloadRemaining') e.owned.get(e.activeGunId)[timer] = .1;
    else e[timer] = .1;
    assert.equal(startSupplyUse(e, v, 'health', live).ok, false, timer);
    assert.equal(e.supplyUse, null); assert.equal(e.supplies.health, 2);
  }
  const { e, v } = fixture(); e.throwRemaining = .1;
  assert.equal(startSupplyUse(e, v, 'health', live).ok, true, 'throw cooldown alone is not attack suppression');
});

test('start requires an active living owner with need and valid vitals', () => {
  for (const change of [
    f => { f.options.active = false; }, f => { f.options.alive = false; },
    f => { f.v.health = 0; }, f => { f.v.health = 101; }, f => { f.v.armour = NaN; },
    f => { f.e.supplies.health = 0; }, f => { f.e.owned.clear(); },
  ]) {
    const f = { ...fixture(), options: { ...live } }; change(f);
    assert.equal(startSupplyUse(f.e, f.v, 'health', f.options).ok, false);
    assert.equal(f.e.supplyUse, null);
  }
});

test('zero negative and nonfinite dt never advance a living use', () => {
  for (const dt of [0, -1, NaN, Infinity, -Infinity, undefined, '5']) {
    const { e, v } = fixture(); startSupplyUse(e, v, 'health', live);
    assert.equal(advanceSupplyUse(e, v, dt, live).status, 'pending');
    assert.equal(e.supplyUse.remaining, 5);
    assert.equal(e.supplies.health, 2); assert.equal(v.health, 12);
  }
});

test('bot priority and exclusions', () => {
  const { e } = fixture();
  const actor = { health: 50, armour: 50, alive: true, flashRemaining: 0, equipment: e };
  assert.equal(chooseBotSupply(actor), 'health');
  actor.health = 51; assert.equal(chooseBotSupply(actor), 'armour');
  actor.armour = 51; assert.equal(chooseBotSupply(actor), null);
  actor.health = 50; actor.armour = 0;
  e.supplies.health = 0; assert.equal(chooseBotSupply(actor), 'armour');
  e.supplies.health = 2;
  actor.flashRemaining = .1; assert.equal(chooseBotSupply(actor), null);
  actor.flashRemaining = 0; actor.alive = false; assert.equal(chooseBotSupply(actor), null);
  actor.alive = true; actor.health = 0; assert.equal(chooseBotSupply(actor), null);
  actor.health = 50; startSupplyUse(e, actor, 'health', live);
  assert.equal(chooseBotSupply(actor), null);
});

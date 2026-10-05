import test from 'node:test';
import assert from 'node:assert/strict';
import { damageVitals } from '../src/vitals.js';

test('damage consumes armour before health', () => {
  const v = { health: 100, armour: 20 };
  assert.deepEqual(damageVitals(v, 30), { ok: true, healthDamage: 10, armourDamage: 20, killed: false });
  assert.deepEqual(v, { health: 90, armour: 0 });
});

test('zero damage and missing armour are supported', () => {
  const v = { health: 60 };
  assert.deepEqual(damageVitals(v, 0), { ok: true, healthDamage: 0, armourDamage: 0, killed: false });
  assert.deepEqual(damageVitals(v, 15), { ok: true, healthDamage: 15, armourDamage: 0, killed: false });
  assert.equal(v.health, 45);
  assert.equal(v.armour, 0);
});

test('invalid damage is inert', () => {
  for (const amount of [-1, NaN, Infinity, -Infinity, '10', null, undefined]) {
    const v = { health: 80, armour: 50 };
    assert.equal(damageVitals(v, amount).ok, false);
    assert.deepEqual(v, { health: 80, armour: 50 });
  }
});

test('invalid present vitals reject without mutation', () => {
  for (const v of [null, {}, { health: -1 }, { health: 101 }, { health: NaN },
    { health: 80, armour: undefined }, { health: 80, armour: -1 },
    { health: 80, armour: 101 }, { health: 80, armour: Infinity }, { health: '80', armour: 0 }]) {
    const before = structuredClone(v);
    assert.equal(damageVitals(v, 20).ok, false);
    assert.deepEqual(v, before);
  }
});

test('fatal headshot through armour', () => {
  const v = { health: 100, armour: 100 };
  assert.deepEqual(damageVitals(v, 10000000000), { ok: true, healthDamage: 100, armourDamage: 100, killed: true });
  assert.deepEqual(v, { health: 0, armour: 0 });
  assert.equal(damageVitals(v, 50).healthDamage, 0);
});

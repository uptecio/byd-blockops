import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSoloPowers, normalizeSoloPowers, replenishPoweredMagazine } from '../src/solo-powers.js';
import { WEAPONS, createWeaponState } from '../src/weapons.js';

const off = { invincible:false, unlimitedAmmo:false, superSpeed:false, speedMultiplier:2 };

test('defaults and normalized configurations are independent copies', () => {
  const first = defaultSoloPowers();
  assert.deepEqual(first, off);
  first.invincible = true;
  assert.deepEqual(defaultSoloPowers(), off);
  const normalized = normalizeSoloPowers(first);
  first.invincible = false;
  assert.equal(normalized.invincible, true);
});

test('only exact boolean switches and finite bounded numeric speeds can activate powers', () => {
  for (const value of [null, undefined, [], true, 'powers', {}, Object.create(off)]) {
    assert.equal(normalizeSoloPowers(value), null);
  }
  for (const key of ['invincible', 'unlimitedAmmo', 'superSpeed']) {
    for (const value of [1, 0, 'true', null, undefined]) {
      assert.equal(normalizeSoloPowers({...off, [key]:value}), null);
    }
    assert.deepEqual(normalizeSoloPowers({...off, [key]:true}), {...off, [key]:true});
  }
  for (const speedMultiplier of [NaN, Infinity, -Infinity, 1.9, 5.1, '3', null]) {
    assert.equal(normalizeSoloPowers({...off, speedMultiplier}), null);
  }
  for (const [speedMultiplier, want] of [[2,2], [5,5], [2.34,2.3], [4.96,5]]) {
    assert.equal(normalizeSoloPowers({...off, speedMultiplier}).speedMultiplier, want);
  }
});

test('unexpected keys, symbols and throwing accessors fail closed without escaping', () => {
  assert.equal(normalizeSoloPowers({...off, extra:true}), null);
  assert.equal(normalizeSoloPowers({...off, [Symbol('power')]:true}), null);
  const hiddenExtra = Object.defineProperty({...off}, 'extra', {value:true});
  assert.equal(normalizeSoloPowers(hiddenExtra), null);
  const throwing = Object.defineProperty({...off}, 'invincible', {get() { throw new Error('denied'); }});
  assert.equal(normalizeSoloPowers(throwing), null);
  assert.equal(normalizeSoloPowers(new Proxy({}, {ownKeys() { throw new Error('denied'); }})), null);
});

for (const weapon of WEAPONS) {
  test(`${weapon.name}: replenishment cancels reload without bypassing cooldown or exceeding finite inventory bounds`, () => {
    const definition = {...weapon};
    for (const [ammo, reserve] of [[0,0], [1,120], [0,500], [weapon.magazine,500-weapon.magazine]]) {
      const state = {...createWeaponState(weapon.id), ammo, reserve, cooldown:.57, reloadRemaining:1.3};
      replenishPoweredMagazine(state);
      assert.deepEqual(state, {
        weaponId:weapon.id, ammo:weapon.magazine,
        reserve:Math.min(reserve,500-weapon.magazine), cooldown:.57, reloadRemaining:0,
      });
      assert.equal(Number.isInteger(state.ammo) && Number.isInteger(state.reserve), true);
      assert.ok(state.ammo + state.reserve <= 500);
    }
    assert.deepEqual(weapon, definition);
  });
}

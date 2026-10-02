import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPON_CLASSES, WEAPONS, getWeapon, createWeaponState, tickWeapon, tryFire, startReload } from '../src/weapons.js';

test('armory contains four usable unique weapons for each of seven classes', () => {
  assert.deepEqual(WEAPON_CLASSES.map(item => item.id), ['assault', 'smg', 'shotgun', 'sniper', 'marksman', 'lmg', 'sidearm']);
  assert.equal(WEAPONS.length, 28);
  assert.equal(new Set(WEAPONS.map(item => item.id)).size, 28);
  for (const category of WEAPON_CLASSES) {
    assert.ok(category.label && category.description);
    assert.equal(WEAPONS.filter(item => item.classId === category.id).length, 4);
  }
  for (const weapon of WEAPONS) {
    assert.equal(getWeapon(weapon.id), weapon);
    assert.ok(weapon.name);
    for (const field of ['damage', 'magazine', 'reserve', 'fireInterval', 'reloadTime', 'spread', 'pellets', 'range', 'recoil', 'zoom']) {
      assert.ok(Number.isFinite(weapon[field]) && weapon[field] > 0, `${weapon.id}.${field} must be a positive number`);
    }
    for (const field of ['magazine', 'reserve', 'pellets', 'colour']) assert.ok(Number.isInteger(weapon[field]));
    assert.ok(weapon.colour >= 0 && weapon.colour <= 0xffffff);
    assert.equal(typeof weapon.automatic, 'boolean');
    assert.ok(weapon.spread < 0.3 && weapon.recoil < 0.3, 'angular stats use radians');
  }
});

test('unknown IDs normalize to the default weapon and independent fresh states', () => {
  assert.equal(getWeapon('missing').id, 'm4a1');
  const first = createWeaponState('missing');
  const second = createWeaponState('m4a1');
  assert.deepEqual(first, { weaponId: 'm4a1', ammo: 30, reserve: 470, cooldown: 0, reloadRemaining: 0 });
  tryFire(first);
  assert.equal(second.ammo, getWeapon('m4a1').magazine);
});

test('firing spends one round and blocks shots until the cooldown expires', () => {
  const state = createWeaponState('ak47');
  const weapon = getWeapon('ak47');
  assert.equal(tryFire(state), true);
  assert.equal(state.ammo, weapon.magazine - 1);
  assert.equal(state.cooldown, weapon.fireInterval);
  assert.equal(tryFire(state), false);
  tickWeapon(state, weapon.fireInterval / 2);
  assert.equal(tryFire(state), false);
  tickWeapon(state, weapon.fireInterval / 2);
  assert.equal(tryFire(state), true);
  assert.equal(state.ammo, weapon.magazine - 2);
});

test('an empty weapon never fires or begins an automatic reload', () => {
  const state = createWeaponState('doublebarrel');
  assert.equal(tryFire(state), true);
  tickWeapon(state, 10);
  assert.equal(tryFire(state), true);
  tickWeapon(state, 10);
  assert.equal(tryFire(state), false);
  assert.equal(state.ammo, 0);
  assert.equal(state.reloadRemaining, 0);
});

test('reload completes once and conserves magazine plus reserve ammunition', () => {
  const state = createWeaponState('m4a1');
  const weapon = getWeapon('m4a1');
  state.ammo = 7;
  state.reserve = 40;
  assert.equal(startReload(state), true);
  assert.equal(state.reloadRemaining, weapon.reloadTime);
  assert.equal(startReload(state), false);
  assert.equal(tryFire(state), false);
  tickWeapon(state, weapon.reloadTime / 2);
  assert.equal(state.ammo, 7);
  assert.equal(state.reserve, 40);
  tickWeapon(state, weapon.reloadTime / 2);
  assert.equal(state.ammo, weapon.magazine);
  assert.equal(state.reserve, 47 - weapon.magazine);
  assert.equal(state.reloadRemaining, 0);
  tickWeapon(state, 10000);
  assert.equal(state.ammo + state.reserve, 47);
});

test('reload with too little reserve transfers only the available rounds', () => {
  const state = createWeaponState('m870');
  state.ammo = 1;
  state.reserve = 2;
  assert.equal(startReload(state), true);
  tickWeapon(state, 10000);
  assert.equal(state.ammo, 3);
  assert.equal(state.reserve, 0);
  assert.equal(startReload(state), false);
});

test('reload rejects a full magazine and an empty reserve without changing state', () => {
  const state = createWeaponState('g17');
  const initial = { ...state };
  assert.equal(startReload(state), false);
  assert.deepEqual(state, initial);
  state.ammo = 0;
  state.reserve = 0;
  const empty = { ...state };
  assert.equal(startReload(state), false);
  assert.deepEqual(state, empty);
});

test('large ticks finish cooldown and reload without manufacturing ammunition', () => {
  const state = createWeaponState('p90');
  tryFire(state);
  startReload(state);
  const total = state.ammo + state.reserve;
  tickWeapon(state, Number.MAX_VALUE);
  assert.equal(state.cooldown, 0);
  assert.equal(state.reloadRemaining, 0);
  assert.equal(state.ammo + state.reserve, total);
  assert.equal(tryFire(state), true);
});

test('invalid delta times do not poison timers or advance a reload', () => {
  const state = createWeaponState('scar');
  tryFire(state);
  startReload(state);
  const initial = { ...state };
  for (const dt of [NaN, Infinity, -Infinity, -1, undefined, null, '1', {}, 0]) {
    tickWeapon(state, dt);
    assert.deepEqual(state, initial);
  }
});

test('all 28 weapons start with 500 total rounds and conserve them through repeated fire and reloads', () => {
  assert.equal(WEAPONS.length, 28);
  for (const weapon of WEAPONS) {
    const state = createWeaponState(weapon.id);
    assert.equal(state.ammo, weapon.magazine, `${weapon.id} starts with a full magazine`);
    assert.equal(state.ammo + state.reserve, 500, `${weapon.id} starts with exactly 500 rounds`);
    assert.equal(weapon.magazine + weapon.reserve, 500, `${weapon.id} catalogue matches its starting supply`);
    const initialTotal = 500;
    let shots = 0;
    for (let attempt = 0; attempt < initialTotal + 1; attempt++) {
      if (state.ammo === 0 && state.reserve > 0) {
        assert.equal(startReload(state), true);
        tickWeapon(state, weapon.reloadTime + 1);
      }
      if (tryFire(state)) shots++;
      tickWeapon(state, weapon.fireInterval + 1);
      assert.equal(state.ammo + state.reserve + shots, initialTotal);
      assert.ok(state.ammo >= 0 && state.ammo <= weapon.magazine && state.reserve >= 0);
    }
    assert.equal(shots, initialTotal);
    assert.equal(state.ammo, 0);
    assert.equal(state.reserve, 0);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRangeEquipment, equipRangeGun, replenishRangeReserves } from '../src/range-equipment.js';
import { createEquipment, equipGun, equipmentDTO, equipmentFromDTO, tickEquipment } from '../src/equipment.js';
import { WEAPONS, tryFire, startReload } from '../src/weapons.js';
import { replenishPoweredMagazine } from '../src/solo-powers.js';

test('range starters validate real catalogue IDs and begin with only the selected gun', () => {
  assert.equal(WEAPONS.length, 29);
  for (const gun of WEAPONS) {
    const e = createRangeEquipment(gun.id);
    assert.equal(e.activeGunId, gun.id);
    assert.deepEqual([...e.owned.keys()], [gun.id]);
    assert.equal(e.owned.get(gun.id).ammo, gun.magazine);
    assert.equal(e.owned.get(gun.id).reserve, 500 - gun.magazine);
    assert.deepEqual(equipmentDTO(equipmentFromDTO(equipmentDTO(e))), equipmentDTO(e));
  }
  for (const id of ['unknown', '', '__proto__', undefined, null]) {
    assert.throws(() => createRangeEquipment(id), RangeError);
  }
});

for (const gun of WEAPONS) {
  // Catches accidental magazine refill, shortened reload or finite reserve exhaustion.
  test(`${gun.name}: practice reserves support repeated ordinary magazine exhaustion and timed reloads`, () => {
    const e = createRangeEquipment('m4a1');
    assert.equal(equipRangeGun(e, gun.id, { source: 'armory' }).ok, true);
    const state = e.owned.get(gun.id);
    for (let cycle = 0; cycle < 6; cycle++) {
      for (let shot = 0; shot < gun.magazine; shot++) {
        assert.equal(tryFire(state), true);
        tickEquipment(e, gun.fireInterval);
        replenishRangeReserves(e);
      }
      assert.equal(state.ammo, 0);
      assert.equal(state.reserve, 500);
      assert.equal(tryFire(state), false);
      assert.equal(startReload(state), true);
      assert.equal(state.reloadRemaining, gun.reloadTime);
      tickEquipment(e, gun.reloadTime / 2);
      replenishRangeReserves(e);
      assert.equal(state.ammo, 0);
      assert.equal(state.reloadRemaining, gun.reloadTime / 2);
      assert.equal(tryFire(state), false);
      tickEquipment(e, gun.reloadTime / 2);
      assert.equal(state.reloadRemaining, 0);
      assert.equal(state.ammo, gun.magazine);
      replenishRangeReserves(e);
      assert.equal(state.reserve, 500 - gun.magazine);
      assert.ok([...e.owned.values()].every(s => Number.isFinite(s.reserve) && s.ammo + s.reserve <= 500));
    }
    assert.deepEqual(equipmentDTO(equipmentFromDTO(equipmentDTO(e))), equipmentDTO(e));
  });
}

test('starter to Minigun to starter retains ammunition, cooldown and DTO validity', () => {
  const e = createRangeEquipment('m4a1');
  const starter = e.owned.get('m4a1');
  assert.equal(tryFire(starter), true);
  const remainingStarterAmmo = starter.ammo;
  const remainingCooldown = starter.cooldown;
  assert.equal(equipRangeGun(e, 'minigun', { source: 'armory' }).ok, true);
  assert.equal(e.startingGunRemoved, true);
  assert.equal(e.owned.get('minigun').ammo, 200);
  assert.equal(equipRangeGun(e, 'm4a1', { source: 'inventory' }).ok, true);
  assert.equal(e.owned.get('m4a1'), starter);
  assert.equal(starter.ammo, remainingStarterAmmo);
  assert.equal(starter.cooldown, remainingCooldown);
  assert.equal(tryFire(starter), false);
  assert.deepEqual(equipmentDTO(equipmentFromDTO(equipmentDTO(e))), equipmentDTO(e));
  assert.equal(equipRangeGun(e, 'minigun', { source: 'inventory' }).ok, true);
  assert.equal(equipRangeGun(e, 'm4a1', { source: 'armory' }).ok, true);
  assert.equal(starter.ammo, remainingStarterAmmo);
});

test('invalid gun, source and unowned inventory selections leave equipment untouched', () => {
  const e = createRangeEquipment('m4a1');
  const starter = e.owned.get('m4a1');
  tryFire(starter);
  startReload(starter);
  const before = equipmentDTO(e);
  for (const id of ['unknown', '', '__proto__', undefined, null]) {
    assert.deepEqual(equipRangeGun(e, id, { source: 'armory' }), { ok: false, reason: 'Unknown gun' });
  }
  for (const options of [undefined, null, {}, [], { source: 'loot' }, { source: 'armory', extra: true },
    Object.create({ source: 'armory' }), { source: 'armory', [Symbol('extra')]: true }]) {
    assert.deepEqual(equipRangeGun(e, 'minigun', options), { ok: false, reason: 'Invalid equip source' });
  }
  assert.deepEqual(equipRangeGun(e, 'minigun', { source: 'inventory' }), { ok: false, reason: 'Gun not owned' });
  assert.deepEqual(equipmentDTO(e), before);
  e.owned.clear();
  assert.deepEqual(equipRangeGun(e, 'minigun', { source: 'armory' }), { ok: false, reason: 'No active equipment' });
  assert.equal(e.owned.size, 0);
});

test('switching cancels outgoing partial reload without transferring ammunition or resetting cooldown', () => {
  const e = createRangeEquipment('m4a1');
  const starter = e.owned.get('m4a1');
  tryFire(starter);
  startReload(starter);
  tickEquipment(e, 0.05);
  const ammo = starter.ammo;
  const reserve = starter.reserve;
  const cooldown = starter.cooldown;
  assert.equal(equipRangeGun(e, 'm4a1', { source: 'inventory' }).ok, true);
  assert.equal(starter.reloadRemaining, 1.95);
  e.supplyUse = { type: 'health', remaining: 3 };
  e.heldItem = 'knife';
  assert.equal(equipRangeGun(e, 'minigun', { source: 'armory' }).ok, true);
  assert.equal(e.heldItem, 'gun');
  assert.equal(e.supplyUse, null);
  assert.equal(starter.reloadRemaining, 0);
  assert.equal(starter.ammo, ammo);
  assert.equal(starter.reserve, reserve);
  assert.equal(starter.cooldown, cooldown);
  tickEquipment(e, 3);
  assert.equal(equipRangeGun(e, 'm4a1', { source: 'inventory' }).ok, true);
  assert.equal(starter.ammo, 29);
  assert.equal(starter.reloadRemaining, 0);
  assert.equal(tryFire(starter), true);
  assert.equal(startReload(starter), true);
  tickEquipment(e, 2);
  assert.equal(starter.ammo, 30);
});

test('reserve replenishment covers inactive guns without refilling magazines or altering timers', () => {
  const e = createRangeEquipment('m4a1');
  const starter = e.owned.get('m4a1');
  tryFire(starter);
  equipRangeGun(e, 'minigun', { source: 'armory' });
  const minigun = e.owned.get('minigun');
  tryFire(minigun);
  startReload(minigun);
  starter.reserve = 0;
  minigun.reserve = 0;
  const before = [...e.owned.values()].map(({ reserve, ...state }) => state);
  assert.equal(replenishRangeReserves(e), undefined);
  assert.deepEqual([...e.owned.values()].map(({ reserve, ...state }) => state), before);
  assert.equal(starter.reserve, 471);
  assert.equal(minigun.reserve, 301);
});

test('no-reload power remains explicit and turning it off restores ordinary magazines and reloads', () => {
  const e = createRangeEquipment('minigun');
  const state = e.owned.get('minigun');
  tryFire(state);
  startReload(state);
  replenishRangeReserves(e);
  assert.equal(state.ammo, 199);
  assert.equal(state.reloadRemaining, 5.5);
  const cooldown = state.cooldown;
  replenishPoweredMagazine(state);
  replenishRangeReserves(e);
  assert.equal(state.ammo, 200);
  assert.equal(state.reloadRemaining, 0);
  assert.equal(state.cooldown, cooldown);
  assert.equal(state.reserve, 300);
  assert.equal(tryFire(state), false);
  tickEquipment(e, 1 / 30);
  assert.equal(tryFire(state), true);
  replenishRangeReserves(e);
  assert.equal(state.ammo, 199);
  assert.equal(startReload(state), true);
  tickEquipment(e, 5.5);
  assert.equal(state.ammo, 200);
  assert.deepEqual(equipmentDTO(equipmentFromDTO(equipmentDTO(e))), equipmentDTO(e));
});

test('normal match equipment still removes its starter and does not gain practice reserves', () => {
  const e = createEquipment('m4a1');
  assert.equal(equipGun(e, 'minigun', { source: 'armory' }).ok, true);
  assert.equal(e.owned.has('m4a1'), false);
  assert.equal(equipGun(e, 'm4a1', { source: 'armory' }).ok, false);
  const state = e.owned.get('minigun');
  tryFire(state);
  tickEquipment(e, 1 / 30);
  assert.equal(state.ammo, 199);
  assert.equal(state.reserve, 300);
});

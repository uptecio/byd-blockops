import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS } from '../src/weapons.js';
import { createEquipment, equipGun, pickupEquipment, setHeldItem, selectGrenade, refillOwnedAmmo } from '../src/equipment.js';

for(const gun of WEAPONS) test(`recovery fills ${gun.name} to its magazine and 500 total without replacing state`, () => {
  const e=createEquipment(gun.id), state=e.owned.get(gun.id);
  Object.assign(state,{ammo:0,reserve:2,cooldown:.2,reloadRemaining:1});
  refillOwnedAmmo(e);
  assert.equal(e.owned.get(gun.id),state);
  assert.equal(state.ammo,gun.magazine); assert.equal(state.ammo+state.reserve,500);
  assert.equal(state.cooldown,0); assert.equal(state.reloadRemaining,0);
});

test('recovery preserves all ownership order choices grenade counts and removed starter flag', () => {
  const e=createEquipment('m4a1'); equipGun(e,'mp5',{source:'armory'});
  pickupEquipment(e,{kind:'gun',weaponId:'awp',ammo:1,reserve:0});
  pickupEquipment(e,{kind:'knife'});
  for(const grenadeType of ['smoke','flash']) pickupEquipment(e,{kind:'grenade',grenadeType});
  selectGrenade(e,'smoke'); setHeldItem(e,'knife');
  const owned=e.owned;
  Object.assign(e,{throwRemaining:.5,attackLockRemaining:.2,meleeRemaining:.5});
  refillOwnedAmmo(e);
  assert.equal(e.owned,owned); assert.deepEqual([...owned.keys()],['mp5','awp']);
  assert.equal(e.activeGunId,'mp5'); assert.equal(e.heldItem,'knife'); assert.equal(e.knife,true);
  assert.equal(e.startingGunRemoved,true); assert.equal(e.startingGunId,'m4a1');
  assert.equal(e.owned.has('m4a1'),false);
  assert.deepEqual(e.grenades,{frag:0,smoke:1,flash:1}); assert.equal(e.selectedGrenade,'smoke');
  for(const state of owned.values()) assert.equal(state.ammo+state.reserve,500);
  for(const key of ['throwRemaining','attackLockRemaining','meleeRemaining']) assert.equal(e[key],0);
});

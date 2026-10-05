import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS, tryFire, startReload } from '../src/weapons.js';
import { GRENADE_TYPES, GEAR_BALANCE } from '../src/equipment-catalog.js';
import {
  createEquipment, equipGun, pickupEquipment, setHeldItem, selectGrenade,
  tickEquipment, consumeGrenade, beginMelee, deathItems, clearEquipment,
  resetEquipment, equipmentDTO, equipmentFromDTO, refillOwnedAmmo,
} from '../src/equipment.js';
import { startSupplyUse, advanceSupplyUse } from '../src/supplies.js';
import { createGearActor } from './helpers/equipment-fixture.js';

function unchanged(e, action) {
  const before = equipmentDTO(e);
  const result = action();
  assert.equal(result.ok, false);
  assert.equal(typeof result.reason, 'string');
  assert.ok(result.reason.length > 0);
  assert.deepEqual(equipmentDTO(e), before);
}

test('supplies stack independently without equipping', () => {
  const e = createEquipment('m4a1');
  for (let i = 0; i < 3; i++) assert.equal(pickupEquipment(e, { kind: 'supply', supplyType: 'health' }).ok, true);
  unchanged(e, () => pickupEquipment(e, { kind: 'supply', supplyType: 'health' }));
  assert.equal(pickupEquipment(e, { kind: 'supply', supplyType: 'armour' }).ok, true);
  assert.deepEqual(e.supplies, { health: 3, armour: 1 });
  assert.equal(e.activeGunId, 'm4a1'); assert.equal(e.startingGunRemoved, false);
  assert.equal(deathItems(e).filter(i => i.kind === 'supply').length, 4);
  for (const item of [{ kind: 'supply', supplyType: 'gas' }, { kind: 'supply', supplyType: 'health', count: 2 }, { kind: 'supply' }]) {
    unchanged(e, () => pickupEquipment(e, item));
  }
});

test('strict detached supply DTOs', () => {
  const e = createEquipment('m4a1'), v = { health: 10, armour: 0 }, live = { active: true, alive: true };
  pickupEquipment(e, { kind: 'supply', supplyType: 'health' });
  startSupplyUse(e, v, 'health', live); advanceSupplyUse(e, v, 2.5, live);
  const dto = equipmentDTO(e), copy = equipmentFromDTO(dto);
  assert.deepEqual(copy.supplyUse, { type: 'health', remaining: 2.5 });
  dto.supplies.health = 3; dto.supplyUse.remaining = 1;
  copy.supplies.health = 2; copy.supplyUse.remaining = .5;
  assert.equal(e.supplies.health, 1); assert.equal(e.supplyUse.remaining, 2.5);
  const changes = [
    d => { delete d.supplies; }, d => { delete d.supplyUse; }, d => { delete d.supplies.armour; },
    d => { d.supplies.gas = 1; }, d => { d.supplyUse.extra = 1; }, d => { delete d.supplyUse.type; },
    d => { d.supplyUse.type = 'gas'; }, d => { d.supplies.health = 0; },
    ...[-1, 1.5, 4, NaN, '1'].map(n => d => { d.supplies.armour = n; }),
    ...[0, -1, 5.001, NaN, Infinity, '5'].map(n => d => { d.supplyUse.remaining = n; }),
    d => { d.supplies = []; }, d => { d.supplyUse = []; },
  ];
  for (const change of changes) {
    const invalid = equipmentDTO(e); change(invalid);
    assert.throws(() => equipmentFromDTO(invalid), TypeError);
  }
});

test('empty inventory has no supplies/use and reset grants none', () => {
  const e = createEquipment('m4a1');
  pickupEquipment(e, { kind: 'supply', supplyType: 'health' });
  startSupplyUse(e, { health: 10, armour: 0 }, 'health', { active: true, alive: true });
  clearEquipment(e);
  assert.deepEqual(e.supplies, { health: 0, armour: 0 }); assert.equal(e.supplyUse, null);
  const dead = equipmentDTO(e);
  assert.doesNotThrow(() => equipmentFromDTO(dead));
  assert.throws(() => equipmentFromDTO({ ...dead, supplies: { health: 1, armour: 0 } }), TypeError);
  assert.throws(() => equipmentFromDTO({ ...dead, supplyUse: { type: 'health', remaining: 1 } }), TypeError);
  unchanged(e, () => pickupEquipment(e, { kind: 'supply', supplyType: 'health' }));
  resetEquipment(e);
  assert.deepEqual(e.supplies, { health: 0, armour: 0 }); assert.equal(e.supplyUse, null);
});

test('successful selection cancels, denied selection preserves supply use', () => {
  for (const kind of ['gun', 'knife', 'grenade']) {
    const e = createEquipment('m4a1');
    pickupEquipment(e, { kind: 'supply', supplyType: 'health' });
    startSupplyUse(e, { health: 50, armour: 0 }, 'health', { active: true, alive: true });
    const use = e.supplyUse;
    if (kind === 'gun') {
      unchanged(e, () => equipGun(e, 'ak47', { source: 'inventory' }));
      assert.equal(e.supplyUse, use);
      assert.equal(equipGun(e, 'ak47', { source: 'armory' }).ok, true);
    } else if (kind === 'knife') {
      unchanged(e, () => setHeldItem(e, 'knife'));
      pickupEquipment(e, { kind: 'knife' }); assert.equal(e.supplyUse, use);
      assert.equal(setHeldItem(e, 'knife').ok, true);
    } else {
      unchanged(e, () => selectGrenade(e, 'gas')); assert.equal(e.supplyUse, use);
      assert.equal(selectGrenade(e, 'frag').ok, true);
    }
    assert.equal(e.supplyUse, null); assert.equal(e.supplies.health, 1);
  }
});

test('refill preserves supplies/use and equipment ticking never advances use', () => {
  const e = createEquipment('m4a1');
  pickupEquipment(e, { kind: 'supply', supplyType: 'armour' });
  startSupplyUse(e, { health: 100, armour: 0 }, 'armour', { active: true, alive: true });
  const use = e.supplyUse;
  tickEquipment(e, 10); refillOwnedAmmo(e);
  assert.equal(e.supplyUse, use); assert.equal(use.remaining, 5); assert.equal(e.supplies.armour, 1);
});

test('original gun needs loot after the first replacement and resets next life', () => {
  const e = createEquipment('ak47');
  assert.equal(equipGun(e, 'mp5', { source: 'armory' }).ok, true);
  assert.equal(e.owned.has('ak47'), false);
  assert.deepEqual(equipGun(e, 'ak47', { source: 'armory' }), { ok: false, reason: 'Find this gun as loot' });
  assert.equal(pickupEquipment(e, { kind: 'gun', weaponId: 'ak47', ammo: 7, reserve: 19 }).ok, true);
  assert.equal(e.activeGunId, 'mp5');
  assert.equal(equipGun(e, 'ak47', { source: 'inventory' }).ok, true);
  assert.equal(e.owned.get('ak47').ammo + e.owned.get('ak47').reserve, 26);
  resetEquipment(e);
  assert.equal(e.activeGunId, 'ak47');
  assert.equal(e.owned.get('ak47').ammo + e.owned.get('ak47').reserve, 500);
});

test('every catalog gun can start a life and be carried without ammo refill', () => {
  assert.equal(WEAPONS.length, 28);
  for (const gun of WEAPONS) {
    const e = createEquipment(gun.id);
    assert.equal(e.owned.get(gun.id).ammo + e.owned.get(gun.id).reserve, 500);
    const state = e.owned.get(gun.id);
    assert.equal(tryFire(state), true);
    assert.equal(equipGun(e, gun.id, { source: 'armory' }).ok, true);
    assert.equal(e.owned.get(gun.id), state);
    assert.equal(state.ammo + state.reserve, 499);
  }
  const e = createEquipment('ak47');
  equipGun(e, 'mp5', { source: 'armory' });
  for (const gun of WEAPONS) {
    if (gun.id === 'ak47') pickupEquipment(e, { kind: 'gun', weaponId: 'ak47', ammo: 30, reserve: 470 });
    else assert.equal(equipGun(e, gun.id, { source: 'armory' }).ok, true);
  }
  assert.equal(e.owned.size, 28);
});

test('invalid IDs and invalid equip sources never fall back or partially mutate', () => {
  for (const id of ['missing', '', null, undefined, {}, '__proto__']) assert.throws(() => createEquipment(id), RangeError);
  const e = createEquipment('ak47');
  for (const id of ['missing', '', null, undefined, {}]) {
    unchanged(e, () => equipGun(e, id, { source: 'armory' }));
    unchanged(e, () => pickupEquipment(e, { kind: 'gun', weaponId: id, ammo: 1, reserve: 1 }));
  }
  for (const options of [undefined, null, {}, { source: 'preview' }]) unchanged(e, () => equipGun(e, 'mp5', options));
  unchanged(e, () => equipGun(e, 'mp5', { source: 'inventory' }));
  assert.equal(e.startingGunRemoved, false);
});

test('pickup, knife toggle and grenade throw retain original gun until actual different equip', () => {
  const e = createEquipment('ak47');
  pickupEquipment(e, { kind: 'gun', weaponId: 'mp5', ammo: 2, reserve: 5 });
  pickupEquipment(e, { kind: 'knife' });
  pickupEquipment(e, { kind: 'grenade', grenadeType: 'frag' });
  assert.equal(setHeldItem(e, 'knife').ok, true);
  assert.equal(consumeGrenade(e, 'frag').ok, true);
  assert.equal(e.owned.has('ak47'), true);
  assert.equal(e.startingGunRemoved, false);
  assert.equal(equipGun(e, 'ak47', { source: 'inventory' }).ok, true);
  assert.equal(e.heldItem, 'gun');
  assert.equal(equipGun(e, 'mp5', { source: 'inventory' }).ok, true);
  assert.equal(e.owned.has('ak47'), false);
  pickupEquipment(e, { kind: 'gun', weaponId: 'ak47', ammo: 1, reserve: 4 });
  equipGun(e, 'scar', { source: 'armory' });
  assert.equal(e.owned.has('ak47'), true);
});

test('duplicate guns and knives are rejected without changing carried gear or pickup', () => {
  const e = createEquipment('m4a1');
  tryFire(e.owned.get('m4a1'));
  const gun = { kind: 'gun', weaponId: 'm4a1', ammo: 30, reserve: 470 };
  unchanged(e, () => pickupEquipment(e, gun));
  assert.deepEqual(gun, { kind: 'gun', weaponId: 'm4a1', ammo: 30, reserve: 470 });
  assert.equal(pickupEquipment(e, { kind: 'knife' }).ok, true);
  unchanged(e, () => pickupEquipment(e, { kind: 'knife' }));
});

test('malformed loot is rejected atomically including invalid ammo bounds and extra keys', () => {
  const e = createEquipment('m4a1');
  for (const item of [null, undefined, {}, { kind: 'armor' }, { kind: 'knife', extra: 1 },
    { kind: 'grenade', grenadeType: 'gas' }, { kind: 'grenade', grenadeType: 'frag', count: 9 },
    ...[-1, 31, 1.5, Infinity, NaN, '1'].map(ammo => ({ kind: 'gun', weaponId: 'ak47', ammo, reserve: 1 })),
    ...[-1, 500, 1.5, Infinity, NaN, '1'].map(reserve => ({ kind: 'gun', weaponId: 'ak47', ammo: 1, reserve })),
    { kind: 'gun', weaponId: 'ak47', ammo: 30, reserve: 471 },
    { kind: 'gun', weaponId: 'ak47', ammo: 1, reserve: 1, reloadRemaining: 3 },
  ]) unchanged(e, () => pickupEquipment(e, item));
  assert.equal(pickupEquipment(e, { kind: 'gun', weaponId: 'ak47', ammo: 0, reserve: 0 }).ok, true);
});

test('three mixed grenades share capacity and selected empty types do not auto-switch', () => {
  const e = createEquipment('m4a1');
  for (const grenadeType of ['frag', 'smoke', 'flash']) assert.equal(pickupEquipment(e, { kind: 'grenade', grenadeType }).ok, true);
  assert.deepEqual(e.grenades, { frag: 1, smoke: 1, flash: 1 });
  for (const grenadeType of ['frag', 'smoke', 'flash']) unchanged(e, () => pickupEquipment(e, { kind: 'grenade', grenadeType }));
  assert.equal(selectGrenade(e, 'smoke').ok, true);
  assert.equal(consumeGrenade(e, 'smoke').ok, true);
  assert.equal(e.selectedGrenade, 'smoke');
  tickEquipment(e, 1);
  unchanged(e, () => consumeGrenade(e, 'smoke'));
  assert.equal(pickupEquipment(e, { kind: 'grenade', grenadeType: 'flash' }).ok, true);
  assert.equal(e.selectedGrenade, 'smoke');
  unchanged(e, () => selectGrenade(e, 'gas'));
});

test('knife requires ownership and a held knife, then observes its swing interval', () => {
  const e = createEquipment('m4a1');
  unchanged(e, () => beginMelee(e));
  unchanged(e, () => setHeldItem(e, 'knife'));
  unchanged(e, () => setHeldItem(e, 'grenade'));
  pickupEquipment(e, { kind: 'knife' });
  unchanged(e, () => beginMelee(e));
  setHeldItem(e, 'knife');
  assert.equal(beginMelee(e).ok, true);
  assert.equal(e.meleeRemaining, 0.6);
  unchanged(e, () => beginMelee(e));
  tickEquipment(e, 0.3);
  unchanged(e, () => beginMelee(e));
  tickEquipment(e, 0.3);
  assert.equal(beginMelee(e).ok, true);
});

test('throw spends one stock, preserves held gear and gates another throw and slash', () => {
  const e = createEquipment('m4a1');
  unchanged(e, () => consumeGrenade(e, 'frag'));
  unchanged(e, () => consumeGrenade(e, 'gas'));
  pickupEquipment(e, { kind: 'knife' });
  setHeldItem(e, 'knife');
  pickupEquipment(e, { kind: 'grenade', grenadeType: 'frag' });
  pickupEquipment(e, { kind: 'grenade', grenadeType: 'frag' });
  assert.equal(consumeGrenade(e, 'frag').ok, true);
  assert.equal(e.grenades.frag, 1);
  assert.equal(e.heldItem, 'knife');
  assert.equal(e.activeGunId, 'm4a1');
  assert.equal(e.throwRemaining, 0.65);
  assert.equal(e.attackLockRemaining, 0.25);
  unchanged(e, () => beginMelee(e));
  unchanged(e, () => consumeGrenade(e, 'frag'));
  tickEquipment(e, 0.25);
  assert.equal(beginMelee(e).ok, true);
  unchanged(e, () => consumeGrenade(e, 'frag'));
  tickEquipment(e, 0.4);
  assert.equal(consumeGrenade(e, 'frag').ok, true);
  assert.equal(e.grenades.frag, 0);
});

test('switching preserves each gun reload and stowed gun timers elapse without refills', () => {
  const e = createEquipment('ak47');
  equipGun(e, 'mp5', { source: 'armory' });
  const mp5 = e.owned.get('mp5');
  tryFire(mp5);
  startReload(mp5);
  const beforeSwitch = { ...mp5 };
  equipGun(e, 'scar', { source: 'armory' });
  assert.deepEqual(mp5, beforeSwitch);
  tickEquipment(e, 0.5);
  assert.equal(mp5.reloadRemaining, 1.2);
  assert.equal(mp5.ammo, 29);
  assert.equal(mp5.reserve, 470);
  equipGun(e, 'mp5', { source: 'inventory' });
  assert.equal(e.owned.get('mp5'), mp5);
  assert.equal(mp5.reloadRemaining, 1.2);
  tickEquipment(e, 5);
  assert.deepEqual(mp5, { weaponId: 'mp5', ammo: 30, reserve: 469, cooldown: 0, reloadRemaining: 0 });
});

test('invalid dt changes nothing and large ticks complete all gear timers once', () => {
  const e = createEquipment('m4a1');
  tryFire(e.owned.get('m4a1'));
  startReload(e.owned.get('m4a1'));
  pickupEquipment(e, { kind: 'knife' });
  setHeldItem(e, 'knife');
  beginMelee(e);
  pickupEquipment(e, { kind: 'grenade', grenadeType: 'flash' });
  consumeGrenade(e, 'flash');
  const before = equipmentDTO(e);
  for (const dt of [NaN, Infinity, -Infinity, -1, undefined, null, '1', {}, 0]) {
    tickEquipment(e, dt);
    assert.deepEqual(equipmentDTO(e), before);
  }
  tickEquipment(e, Number.MAX_VALUE);
  assert.equal(e.throwRemaining, 0);
  assert.equal(e.attackLockRemaining, 0);
  assert.equal(e.meleeRemaining, 0);
  assert.equal(e.owned.get('m4a1').ammo + e.owned.get('m4a1').reserve, 499);
  tickEquipment(e, 100);
  assert.equal(e.owned.get('m4a1').ammo + e.owned.get('m4a1').reserve, 499);
});

test('death while holding knife yields remembered gun with untransferred reload ammo and each grenade', () => {
  const e = createEquipment('ak47');
  equipGun(e, 'mp5', { source: 'armory' });
  const gun = e.owned.get('mp5');
  gun.ammo = 7; gun.reserve = 19;
  startReload(gun);
  pickupEquipment(e, { kind: 'knife' });
  setHeldItem(e, 'knife');
  for (const grenadeType of ['smoke', 'smoke', 'flash']) pickupEquipment(e, { kind: 'grenade', grenadeType });
  assert.deepEqual(deathItems(e), [
    { kind: 'gun', weaponId: 'mp5', ammo: 7, reserve: 19 },
    { kind: 'grenade', grenadeType: 'smoke' }, { kind: 'grenade', grenadeType: 'smoke' },
    { kind: 'grenade', grenadeType: 'flash' },
  ]);
  const receiver = createEquipment('m4a1');
  pickupEquipment(receiver, deathItems(e)[0]);
  tickEquipment(receiver, 10);
  assert.deepEqual(receiver.owned.get('mp5'), { weaponId: 'mp5', ammo: 7, reserve: 19, cooldown: 0, reloadRemaining: 0 });
  clearEquipment(e);
  assert.equal(e.owned.size, 0);
  assert.equal(e.knife, false);
  assert.deepEqual(e.grenades, { frag: 0, smoke: 0, flash: 0 });
  assert.deepEqual(deathItems(e), []);
  resetEquipment(e);
  assert.equal(e.activeGunId, 'ak47');
  assert.equal(e.heldItem, 'gun');
  assert.equal(e.startingGunRemoved, false);
  assert.deepEqual([...e.owned.keys()], ['ak47']);
  assert.equal(e.owned.get('ak47').ammo + e.owned.get('ak47').reserve, 500);
});

test('DTO round trips gun timers and makes detached copies in both directions', () => {
  const e = createEquipment('ak47');
  equipGun(e, 'mp5', { source: 'armory' });
  tryFire(e.owned.get('mp5')); startReload(e.owned.get('mp5'));
  pickupEquipment(e, { kind: 'grenade', grenadeType: 'smoke' });
  const dto = equipmentDTO(e);
  const copy = equipmentFromDTO(JSON.parse(JSON.stringify(dto)));
  assert.deepEqual(equipmentDTO(copy), dto);
  dto.owned[0].ammo = 0; dto.grenades.smoke = 0;
  assert.equal(e.owned.get('mp5').ammo, 29);
  assert.equal(e.grenades.smoke, 1);
  copy.owned.get('mp5').ammo = 1; copy.grenades.smoke = 2;
  assert.equal(e.owned.get('mp5').ammo, 29);
  assert.equal(e.grenades.smoke, 1);
  const source = equipmentDTO(e);
  const rebuilt = equipmentFromDTO(source);
  source.owned[0].ammo = 2; source.grenades.smoke = 0;
  assert.equal(rebuilt.owned.get('mp5').ammo, 29);
  assert.equal(rebuilt.grenades.smoke, 1);
});

test('DTO rejects unknown keys, bad inventory relationships and unsafe numbers', () => {
  const valid = equipmentDTO(createEquipment('m4a1'));
  const changes = [
    dto => { dto.extra = 1; }, dto => { delete dto.knife; },
    dto => { dto.startingGunId = 'invalid'; }, dto => { dto.activeGunId = 'ak47'; },
    dto => { dto.owned = []; dto.activeGunId = 'ak47'; },
    dto => { dto.heldItem = 'knife'; }, dto => { dto.knife = 1; },
    dto => { dto.startingGunRemoved = 'yes'; }, dto => { dto.selectedGrenade = 'gas'; },
    dto => { dto.owned.push({ ...dto.owned[0] }); }, dto => { dto.owned = {}; },
    dto => { dto.owned[0].extra = 1; }, dto => { dto.owned[0].weaponId = 'missing'; },
    dto => { dto.owned[0].ammo = 31; }, dto => { dto.owned[0].reserve = 471; },
    dto => { dto.owned[0].cooldown = Infinity; }, dto => { dto.owned[0].reloadRemaining = -1; },
    dto => { dto.owned[0].cooldown = 1; }, dto => { dto.owned[0].reloadRemaining = 3; },
    dto => { dto.grenades.frag = 4; }, dto => { dto.grenades.smoke = 1.5; },
    dto => { dto.grenades.flash = -1; }, dto => { dto.grenades.gas = 0; },
    dto => { dto.throwRemaining = NaN; }, dto => { dto.attackLockRemaining = '1'; },
    dto => { dto.meleeRemaining = -1; },
    dto => { dto.throwRemaining = 0.66; }, dto => { dto.attackLockRemaining = 0.26; },
    dto => { dto.meleeRemaining = 0.61; },
    dto => { dto.owned = []; dto.knife = true; },
    dto => { dto.owned = []; dto.grenades.frag = 1; },
    dto => { dto.owned = []; dto.throwRemaining = 0.1; },
  ];
  for (const change of changes) {
    const dto = structuredClone(valid);
    change(dto);
    assert.throws(() => equipmentFromDTO(dto), TypeError);
  }
  for (const dto of [null, [], undefined, 'gear']) assert.throws(() => equipmentFromDTO(dto), TypeError);
});

test('cleared equipment survives serialization with a remembered valid active gun', () => {
  const e = createEquipment('ak47');
  equipGun(e, 'mp5', { source: 'armory' });
  clearEquipment(e);
  const copy = equipmentFromDTO(equipmentDTO(e));
  assert.equal(copy.activeGunId, 'mp5');
  assert.equal(copy.owned.size, 0);
  resetEquipment(copy);
  assert.equal(copy.activeGunId, 'ak47');
});

test('clearing cannot grant a fresh gun through late equip or pickup actions', () => {
  const e = createEquipment('ak47');
  clearEquipment(e);
  unchanged(e, () => equipGun(e, 'mp5', { source: 'armory' }));
  unchanged(e, () => equipGun(e, 'ak47', { source: 'inventory' }));
  unchanged(e, () => pickupEquipment(e, { kind: 'gun', weaponId: 'mp5', ammo: 30, reserve: 470 }));
  unchanged(e, () => pickupEquipment(e, { kind: 'knife' }));
  unchanged(e, () => pickupEquipment(e, { kind: 'grenade', grenadeType: 'frag' }));
  unchanged(e, () => setHeldItem(e, 'gun'));
  unchanged(e, () => consumeGrenade(e, 'frag'));
  unchanged(e, () => beginMelee(e));
  resetEquipment(e);
  assert.equal(equipGun(e, 'mp5', { source: 'armory' }).ok, true);
});

test('test actors are complete and their default equipment never aliases another actor', () => {
  const a = createGearActor('a');
  const b = createGearActor('b', { x: 3, teamId: 'blue' });
  assert.deepEqual({ ...a, equipment: undefined }, {
    id: 'a', lifeId: 1, teamId: null, x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
    alive: true, protectedRemaining: 0, flashRemaining: 0, equipment: undefined,
  });
  tryFire(a.equipment.owned.get('m4a1'));
  assert.equal(b.equipment.owned.get('m4a1').ammo, 30);
  assert.equal(b.x, 3);
  assert.equal(b.teamId, 'blue');
});

test('shared catalog cannot be mutated to change gear rules', () => {
  assert.deepEqual(GRENADE_TYPES, ['frag', 'smoke', 'flash']);
  assert.throws(() => GRENADE_TYPES.push('gas'), TypeError);
  assert.throws(() => { GEAR_BALANCE.knife.interval = 0; }, TypeError);
  assert.throws(() => { GEAR_BALANCE.grenades.frag.maxDamage = 999; }, TypeError);
});

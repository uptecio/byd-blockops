import { WEAPONS, TOTAL_AMMO, createWeaponState, tickWeapon } from './weapons.js';
import { GRENADE_TYPES, GEAR_BALANCE } from './equipment-catalog.js';
import { hasOwn } from './has-own.js';

const guns = new Map(WEAPONS.map(gun => [gun.id, gun]));
const equipmentKeys = [
  'startingGunId', 'activeGunId', 'heldItem', 'startingGunRemoved', 'owned',
  'knife', 'grenades', 'selectedGrenade', 'throwRemaining', 'attackLockRemaining', 'meleeRemaining',
];
const weaponKeys = ['weaponId', 'ammo', 'reserve', 'cooldown', 'reloadRemaining'];
const ok = () => ({ ok: true });
const denied = reason => ({ ok: false, reason });
const grenadeCount = e => GRENADE_TYPES.reduce((total, type) => total + e.grenades[type], 0);
const hasEquipment = e => e.owned.has(e.activeGunId);
const isTimer = (value, maximum) => Number.isFinite(value) && value >= 0 && value <= maximum;

function hasKeys(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null)
    && Reflect.ownKeys(value).length === keys.length
    && keys.every(key => hasOwn(value, key));
}

function validAmmo(weaponId, ammo, reserve) {
  const gun = guns.get(weaponId);
  return !!gun && Number.isInteger(ammo) && ammo >= 0 && ammo <= gun.magazine
    && Number.isInteger(reserve) && reserve >= 0 && ammo + reserve <= TOTAL_AMMO;
}

export function createEquipment(startingGunId) {
  if (!guns.has(startingGunId)) throw new RangeError('Unknown starting gun');
  return {
    startingGunId, activeGunId: startingGunId, heldItem: 'gun', startingGunRemoved: false,
    owned: new Map([[startingGunId, createWeaponState(startingGunId)]]),
    knife: false, grenades: { frag: 0, smoke: 0, flash: 0 }, selectedGrenade: 'frag',
    throwRemaining: 0, attackLockRemaining: 0, meleeRemaining: 0,
  };
}

export function equipGun(e, weaponId, options) {
  if (!guns.has(weaponId)) return denied('Unknown gun');
  if (!hasKeys(options, ['source']) || !['armory', 'inventory'].includes(options.source)) return denied('Invalid equip source');
  if (!hasEquipment(e)) return denied('No active equipment');
  if (!e.owned.has(weaponId)) {
    if (weaponId === e.startingGunId && e.startingGunRemoved) return denied('Find this gun as loot');
    if (options.source === 'inventory') return denied('Gun not owned');
  }
  if (!e.owned.has(weaponId)) e.owned.set(weaponId, createWeaponState(weaponId));
  if (!e.startingGunRemoved && weaponId !== e.startingGunId) {
    e.owned.delete(e.startingGunId);
    e.startingGunRemoved = true;
  }
  e.activeGunId = weaponId;
  e.heldItem = 'gun';
  return ok();
}

export function pickupEquipment(e, item) {
  if (!hasEquipment(e)) return denied('No active equipment');
  if (hasKeys(item, ['kind', 'weaponId', 'ammo', 'reserve']) && item.kind === 'gun') {
    if (!validAmmo(item.weaponId, item.ammo, item.reserve)) return denied('Invalid gun pickup');
    if (e.owned.has(item.weaponId)) return denied('Gun already owned');
    e.owned.set(item.weaponId, { weaponId: item.weaponId, ammo: item.ammo, reserve: item.reserve, cooldown: 0, reloadRemaining: 0 });
  } else if (hasKeys(item, ['kind']) && item.kind === 'knife') {
    if (e.knife) return denied('Knife already owned');
    e.knife = true;
  } else if (hasKeys(item, ['kind', 'grenadeType']) && item.kind === 'grenade' && GRENADE_TYPES.includes(item.grenadeType)) {
    if (grenadeCount(e) >= GEAR_BALANCE.grenadeCapacity) return denied('Grenade capacity full');
    e.grenades[item.grenadeType] += 1;
  } else return denied('Invalid equipment pickup');
  return ok();
}

export function setHeldItem(e, heldItem) {
  if (!['gun', 'knife'].includes(heldItem)) return denied('Unknown held item');
  if (!hasEquipment(e)) return denied('No active equipment');
  if (heldItem === 'knife' && !e.knife) return denied('Find a knife as loot');
  e.heldItem = heldItem;
  return ok();
}

export function selectGrenade(e, grenadeType) {
  if (!GRENADE_TYPES.includes(grenadeType)) return denied('Unknown grenade type');
  e.selectedGrenade = grenadeType;
  return ok();
}

export function tickEquipment(e, dt) {
  if (!Number.isFinite(dt) || dt <= 0) return;
  for (const state of e.owned.values()) tickWeapon(state, dt);
  e.throwRemaining = Math.max(0, e.throwRemaining - dt);
  e.attackLockRemaining = Math.max(0, e.attackLockRemaining - dt);
  e.meleeRemaining = Math.max(0, e.meleeRemaining - dt);
}

// Call only after the runtime validates the release point and entity caps.
export function consumeGrenade(e, grenadeType) {
  if (!GRENADE_TYPES.includes(grenadeType)) return denied('Unknown grenade type');
  if (!hasEquipment(e)) return denied('No active equipment');
  if (e.grenades[grenadeType] <= 0) return denied('No grenades of this type');
  if (e.throwRemaining > 0) return denied('Throw cooling down');
  e.grenades[grenadeType] -= 1;
  e.throwRemaining = GEAR_BALANCE.throwCooldown;
  e.attackLockRemaining = GEAR_BALANCE.attackSuppression;
  return ok();
}

export function beginMelee(e) {
  if (!hasEquipment(e)) return denied('No active equipment');
  if (!e.knife || e.heldItem !== 'knife') return denied('Hold a collected knife');
  if (e.attackLockRemaining > 0) return denied('Attack temporarily blocked');
  if (e.meleeRemaining > 0) return denied('Knife cooling down');
  e.meleeRemaining = GEAR_BALANCE.knife.interval;
  return ok();
}

export function deathItems(e) {
  const items = [];
  const active = e.owned.get(e.activeGunId);
  // Reload progress is deliberately absent: dropped ammo is never transferred.
  if (active) items.push({ kind: 'gun', weaponId: active.weaponId, ammo: active.ammo, reserve: active.reserve });
  for (const grenadeType of GRENADE_TYPES) {
    for (let count = 0; count < e.grenades[grenadeType]; count++) items.push({ kind: 'grenade', grenadeType });
  }
  return items;
}

export function clearEquipment(e) {
  e.owned.clear();
  e.heldItem = 'gun';
  e.knife = false;
  e.grenades = { frag: 0, smoke: 0, flash: 0 };
  e.selectedGrenade = 'frag';
  e.throwRemaining = 0;
  e.attackLockRemaining = 0;
  e.meleeRemaining = 0;
}

export function resetEquipment(e) {
  const fresh = createEquipment(e.startingGunId);
  Object.assign(e, fresh);
}

export function equipmentDTO(e) {
  return {
    startingGunId: e.startingGunId, activeGunId: e.activeGunId, heldItem: e.heldItem,
    startingGunRemoved: e.startingGunRemoved,
    owned: [...e.owned.values()].map(state => ({
      weaponId: state.weaponId, ammo: state.ammo, reserve: state.reserve,
      cooldown: state.cooldown, reloadRemaining: state.reloadRemaining,
    })),
    knife: e.knife, grenades: { frag: e.grenades.frag, smoke: e.grenades.smoke, flash: e.grenades.flash },
    selectedGrenade: e.selectedGrenade, throwRemaining: e.throwRemaining,
    attackLockRemaining: e.attackLockRemaining, meleeRemaining: e.meleeRemaining,
  };
}

export function equipmentFromDTO(dto) {
  const invalid = () => { throw new TypeError('Invalid equipment DTO'); };
  if (!hasKeys(dto, equipmentKeys) || !guns.has(dto.startingGunId) || !guns.has(dto.activeGunId)
    || !['gun', 'knife'].includes(dto.heldItem) || typeof dto.startingGunRemoved !== 'boolean'
    || (!dto.startingGunRemoved && dto.activeGunId !== dto.startingGunId)
    || typeof dto.knife !== 'boolean' || (dto.heldItem === 'knife' && !dto.knife)
    || !GRENADE_TYPES.includes(dto.selectedGrenade) || !hasKeys(dto.grenades, GRENADE_TYPES)
    || !Array.isArray(dto.owned) || dto.owned.length > guns.size
    || !isTimer(dto.throwRemaining, GEAR_BALANCE.throwCooldown)
    || !isTimer(dto.attackLockRemaining, GEAR_BALANCE.attackSuppression)
    || !isTimer(dto.meleeRemaining, GEAR_BALANCE.knife.interval)) invalid();
  if (!GRENADE_TYPES.every(type => Number.isInteger(dto.grenades[type]) && dto.grenades[type] >= 0)
    || grenadeCount(dto) > GEAR_BALANCE.grenadeCapacity) invalid();
  const owned = new Map();
  for (const state of dto.owned) {
    if (!hasKeys(state, weaponKeys) || !validAmmo(state.weaponId, state.ammo, state.reserve)
      || owned.has(state.weaponId) || !isTimer(state.cooldown, guns.get(state.weaponId).fireInterval)
      || !isTimer(state.reloadRemaining, guns.get(state.weaponId).reloadTime)) invalid();
    owned.set(state.weaponId, { ...state });
  }
  if (owned.size > 0) {
    if (!owned.has(dto.activeGunId) || (!dto.startingGunRemoved && !owned.has(dto.startingGunId))) invalid();
  } else if (dto.knife || grenadeCount(dto) > 0 || dto.heldItem !== 'gun'
    || dto.throwRemaining > 0 || dto.attackLockRemaining > 0 || dto.meleeRemaining > 0) invalid();
  return { ...dto, owned, grenades: { ...dto.grenades } };
}

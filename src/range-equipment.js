import { createEquipment } from './equipment.js';
import { WEAPONS, TOTAL_AMMO, createWeaponState } from './weapons.js';
import { cancelSupplyUse } from './supplies.js';

const gunIds = new Set(WEAPONS.map(gun => gun.id));
const denied = reason => ({ ok: false, reason });

function validSource(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) return false;
  const prototype = Object.getPrototypeOf(options);
  return (prototype === Object.prototype || prototype === null)
    && Reflect.ownKeys(options).length === 1
    && Object.prototype.hasOwnProperty.call(options, 'source')
    && ['armory', 'inventory'].includes(options.source);
}

export function createRangeEquipment(startingGunId) {
  return createEquipment(startingGunId);
}

export function equipRangeGun(equipment, weaponId, options) {
  if (!gunIds.has(weaponId)) return denied('Unknown gun');
  if (!validSource(options)) return denied('Invalid equip source');
  const outgoing = equipment.owned.get(equipment.activeGunId);
  if (!outgoing) return denied('No active equipment');
  if (!equipment.owned.has(weaponId)) {
    if (options.source === 'inventory') return denied('Gun not owned');
    equipment.owned.set(weaponId, createWeaponState(weaponId));
  }
  if (weaponId !== equipment.activeGunId) outgoing.reloadRemaining = 0;
  // The existing DTO flag permits a nonstarter active gun; practice retains
  // the starter's actual state so returning to it cannot reset its magazine.
  if (weaponId !== equipment.startingGunId) equipment.startingGunRemoved = true;
  equipment.activeGunId = weaponId;
  equipment.heldItem = 'gun';
  cancelSupplyUse(equipment);
  return { ok: true };
}

// Called by the range simulation, independently of the explicit no-reload power.
export function replenishRangeReserves(equipment) {
  for (const state of equipment.owned.values()) state.reserve = TOTAL_AMMO - state.ammo;
}

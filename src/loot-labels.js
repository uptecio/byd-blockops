import { getWeapon } from './weapons.js';
import { GRENADE_TYPES } from './equipment-catalog.js';
import { SUPPLY_TYPES, SUPPLY_NAMES } from './supplies.js';

export function lootItemLabel(item) {
  if (item?.kind === 'gun') return getWeapon(item.weaponId).name;
  if (item?.kind === 'knife') return 'KNIFE';
  if (item?.kind === 'grenade' && GRENADE_TYPES.includes(item.grenadeType)) return `${item.grenadeType.toUpperCase()} GRENADE`;
  if (item?.kind === 'supply' && SUPPLY_TYPES.includes(item.supplyType)) return SUPPLY_NAMES[item.supplyType].toUpperCase();
  throw new TypeError('Unknown loot item');
}

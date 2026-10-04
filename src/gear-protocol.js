import { equipmentFromDTO } from './equipment.js';
import { WEAPONS, TOTAL_AMMO } from './weapons.js';
import { GEAR_BALANCE, GRENADE_TYPES } from './equipment-catalog.js';
import { hasOwn } from './has-own.js';

const guns = new Map(WEAPONS.map(gun => [gun.id, gun]));
const id = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
const count = value => Number.isSafeInteger(value) && value >= 0;
const positive = value => count(value) && value > 0;
const timer = (value, maximum) => Number.isFinite(value) && value >= 0 && value <= maximum;
const keys = (value, fields) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value))
  && Reflect.ownKeys(value).length === fields.length && fields.every(field => hasOwn(value, field));
const position = value => ['x', 'y', 'z'].every(axis => Number.isFinite(value[axis]));
const grenade = value => GRENADE_TYPES.includes(value);

function validItem(item) {
  if (item?.kind === 'gun') {
    const gun = guns.get(item.weaponId);
    return keys(item, ['kind', 'weaponId', 'ammo', 'reserve']) && !!gun && count(item.ammo)
      && item.ammo <= gun.magazine && count(item.reserve) && item.ammo + item.reserve <= TOTAL_AMMO;
  }
  return (item?.kind === 'knife' && keys(item, ['kind']))
    || (item?.kind === 'grenade' && keys(item, ['kind', 'grenadeType']) && grenade(item.grenadeType));
}

export function validEquipmentSnapshot(value, ownPlayer) {
  if (!keys(value, ['playerId', 'lifeId', 'lastActionSeq', 'equipment']) || !ownPlayer
    || !id(value.playerId) || value.playerId !== ownPlayer.id || !positive(value.lifeId)
    || value.lifeId !== ownPlayer.lifeId || !count(value.lastActionSeq)) return false;
  let equipment;
  try { equipment = equipmentFromDTO(value.equipment); } catch { return false; }
  if (equipment.activeGunId !== ownPlayer.weaponId || equipment.heldItem !== ownPlayer.heldItem) return false;
  if (ownPlayer.health > 0) {
    const state = equipment.owned.get(equipment.activeGunId);
    return !!state && state.ammo === ownPlayer.ammo && state.reserve === ownPlayer.reserve
      && state.reloadRemaining === ownPlayer.reloadRemaining;
  }
  return ownPlayer.health === 0 && equipment.owned.size === 0 && ownPlayer.ammo === 0
    && ownPlayer.reserve === 0 && ownPlayer.reloadRemaining === 0;
}

export function validGearWorld(value) {
  if (!keys(value, ['loot', 'projectiles', 'smokes']) || ![value.loot, value.projectiles, value.smokes].every(Array.isArray)
    || value.loot.length > 64 || value.projectiles.length > 32 || value.smokes.length > 16) return false;
  const ids = new Set();
  const unique = record => id(record?.id) && !ids.has(record.id) && !!ids.add(record.id);
  let maps = 0, drops = 0;
  for (const record of value.loot) {
    if (!keys(record, ['id', 'x', 'y', 'z', 'item', 'source', 'availableRemaining', 'expiresRemaining'])
      || !unique(record) || !position(record) || record.y < 0 || !validItem(record.item)
      || !timer(record.availableRemaining, GEAR_BALANCE.dropUnlock)) return false;
    if (record.source === 'map') { maps++; if (record.expiresRemaining !== null || record.availableRemaining !== 0) return false; }
    else if (record.source === 'drop') { drops++; if (!timer(record.expiresRemaining, GEAR_BALANCE.dropExpiry) || record.expiresRemaining === 0) return false; }
    else return false;
  }
  if (maps > 16 || drops > 48) return false;
  for (const record of value.projectiles) {
    if (!keys(record, ['id', 'grenadeType', 'ownerId', 'ownerTeamId', 'ownerLifeId', 'x', 'y', 'z', 'vx', 'vy', 'vz', 'fuseRemaining'])
      || !unique(record) || !grenade(record.grenadeType) || !id(record.ownerId) || !positive(record.ownerLifeId)
      || ![null, 'red', 'blue'].includes(record.ownerTeamId) || !position(record) || record.y < 0
      || !['vx', 'vy', 'vz'].every(axis => Number.isFinite(record[axis]))
      || !timer(record.fuseRemaining, GEAR_BALANCE.grenades[record.grenadeType].fuse) || record.fuseRemaining === 0) return false;
  }
  for (const record of value.smokes) {
    if (!keys(record, ['id', 'ownerId', 'x', 'y', 'z', 'radius', 'remaining']) || !unique(record)
      || !id(record.ownerId) || !position(record) || record.y < 0 || record.radius !== 4
      || !timer(record.remaining, 8) || record.remaining === 0) return false;
  }
  return value.smokes.length + value.projectiles.filter(p => p.grenadeType === 'smoke').length <= 16;
}

export function validEquipmentAction(packet) {
  const fields = { 'equip-gun': ['weaponId', 'source'], 'held-item': ['heldItem'], 'select-grenade': ['grenadeType'], throw: ['grenadeType'] };
  if (!packet || !hasOwn(fields, packet.kind) || !keys(packet, ['type', 'seq', 'lifeId', 'kind', ...fields[packet.kind]])
    || packet.type !== 'equipment-action' || !positive(packet.seq) || !positive(packet.lifeId)) return false;
  if (packet.kind === 'equip-gun') return guns.has(packet.weaponId) && ['armory', 'inventory'].includes(packet.source);
  if (packet.kind === 'held-item') return ['gun', 'knife'].includes(packet.heldItem);
  return grenade(packet.grenadeType);
}

export function validGearEvent(event) {
  const fields = { pickup: ['itemId', 'item'], melee: [], 'grenade-throw': ['grenadeId', 'grenadeType'], 'grenade-burst': ['grenadeId', 'grenadeType', 'position'] };
  if (!event || !hasOwn(fields, event.type) || !keys(event, ['id', 'type', 'playerId', ...fields[event.type]])
    || !positive(event.id) || !id(event.playerId)) return false;
  if (event.type === 'pickup') return id(event.itemId) && validItem(event.item);
  if (event.type === 'melee') return true;
  return id(event.grenadeId) && grenade(event.grenadeType)
    && (event.type !== 'grenade-burst' || (keys(event.position, ['x', 'y', 'z']) && position(event.position)));
}

import { LOOT_SPAWNS } from './loot-spawns.js';
import { GEAR_BALANCE, GRENADE_TYPES } from './equipment-catalog.js';
import { pickupEquipment } from './equipment.js';
import { WEAPONS, createWeaponState } from './weapons.js';
import { getMap } from './maps.js';
import { canOccupy, hasLineOfSight } from './collision.js';
import { SUPPLY_BALANCE } from './supplies.js';
import { interactionReach, dropAnchor } from './spatial.js';

const gunIds = new Set(WEAPONS.map(gun => gun.id));
// Drops must fit wherever the smallest runtime actor (solo human) can stand.
// Authored locations separately retain their conservative .42 clearance.
const dropRadius = .34;
const remaining = (time, dt) => time - dt < 1e-9 ? 0 : time - dt;
const dto = record => ({
  id: record.id, x: record.x, y: record.y, z: record.z, item: { ...record.item },
  source: record.source, availableRemaining: record.availableRemaining, expiresRemaining: record.expiresRemaining,
});
function starters(ids) {
  const distinct = [...new Set(ids)].sort();
  if (distinct.length > 8 || distinct.some(id => !gunIds.has(id))) throw new RangeError('Invalid starting gun coverage');
  return distinct;
}
function freshGun(weaponId) {
  const { ammo, reserve } = createWeaponState(weaponId);
  return { kind: 'gun', weaponId, ammo, reserve };
}
function seededGuns(seed) {
  let value = Number(seed) >>> 0;
  const ids = [...gunIds];
  for (let index = ids.length - 1; index > 0; index--) {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    const next = Math.floor(value / 4294967296 * (index + 1));
    [ids[index], ids[next]] = [ids[next], ids[index]];
  }
  return ids;
}

export function createLootState({ mapId, seed, startingGunIds = [] }) {
  getMap(mapId);
  const required = starters(startingGunIds);
  const assignments = [...required, ...seededGuns(seed).filter(id => !required.includes(id))];
  let gunIndex = 0;
  return {
    mapId,
    slots: LOOT_SPAWNS[mapId].map(location => ({
      id: location.id, x: location.x, y: location.y ?? 0, z: location.z,
      item: location.kind === 'gun' ? freshGun(assignments[gunIndex++])
        : location.kind === 'knife' ? { kind: 'knife' }
          : location.kind === 'supply' ? { kind: 'supply', supplyType: location.supplyType }
            : { kind: 'grenade', grenadeType: location.grenadeType },
      source: 'map', availableRemaining: 0, expiresRemaining: null, respawnRemaining: 0, present: true,
    })),
    drops: [], nextDropId: 1, lastDroppedLife: new Map(),
  };
}

export function reconcileStartingGuns(state, startingGunIds) {
  const required = new Set(starters(startingGunIds));
  const slots = state.slots.filter(slot => slot.item.kind === 'gun');
  const counts = new Map();
  for (const slot of slots) counts.set(slot.item.weaponId, (counts.get(slot.item.weaponId) ?? 0) + 1);
  for (const weaponId of required) {
    if (counts.has(weaponId)) continue;
    const slot = slots.find(candidate => !required.has(candidate.item.weaponId) || counts.get(candidate.item.weaponId) > 1);
    const previous = slot.item.weaponId;
    const count = counts.get(previous) - 1;
    if (count) counts.set(previous, count); else counts.delete(previous);
    slot.item = freshGun(weaponId);
    counts.set(weaponId, 1);
    // An absent slot retains its current respawn timer; an available one
    // changes atomically without introducing another world record.
  }
}

export function tickLoot(state, dt) {
  if (!Number.isFinite(dt) || dt <= 0) return;
  for (const slot of state.slots) {
    if (slot.present) continue;
    slot.respawnRemaining = remaining(slot.respawnRemaining, dt);
    if (slot.respawnRemaining === 0) slot.present = true;
  }
  for (const drop of state.drops) {
    drop.availableRemaining = remaining(drop.availableRemaining, dt);
    drop.expiresRemaining = remaining(drop.expiresRemaining, dt);
  }
  state.drops = state.drops.filter(drop => drop.expiresRemaining > 0);
}

function eligible(actor, record, solids, world) {
  if (!actor.alive || actor.hiddenSpotId || !Number.isFinite(actor.x) || !Number.isFinite(actor.y) || !Number.isFinite(actor.z)) return false;
  if (Math.hypot(actor.x - record.x, actor.z - record.z) > GEAR_BALANCE.pickupRadius + 1e-10
    || Math.abs(actor.y - record.y) > GEAR_BALANCE.pickupVerticalReach) return false;
  if (world ? !interactionReach(actor, record, world) : !hasLineOfSight({ x: actor.x, z: actor.z }, { x: record.x, z: record.z }, solids)) return false;
  const equipment = actor.equipment;
  if (!equipment?.owned.has(equipment.activeGunId)) return false;
  if (record.item.kind === 'gun') return !equipment.owned.has(record.item.weaponId);
  if (record.item.kind === 'knife') return !equipment.knife;
  if (record.item.kind === 'supply') return equipment.supplies[record.item.supplyType] < SUPPLY_BALANCE.capacity;
  return GRENADE_TYPES.reduce((total, type) => total + equipment.grenades[type], 0) < GEAR_BALANCE.grenadeCapacity;
}

export function collectLoot(state, actors, { solids, world }) {
  const events = [];
  for (const record of [...state.slots.filter(slot => slot.present), ...state.drops]) {
    if (record.availableRemaining > 0) continue;
    const candidates = actors.filter(actor => eligible(actor, record, solids, world));
    candidates.sort((a, b) => {
      const distance = actor => (actor.x - record.x) ** 2 + (actor.z - record.z) ** 2;
      return distance(a) - distance(b) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
    });
    const winner = candidates[0];
    if (!winner || !pickupEquipment(winner.equipment, record.item).ok) continue;
    if (record.source === 'map') {
      record.present = false;
      record.respawnRemaining = GEAR_BALANCE.mapRespawn;
    } else state.drops = state.drops.filter(drop => drop !== record);
    events.push({ type: 'pickup', playerId: winner.id, itemId: record.id, item: { ...record.item } });
  }
  return events;
}

export function addDeathDrops(state, { actorId, lifeId, position, items, solids, world }) {
  if (state.lastDroppedLife.get(actorId) === lifeId) return;
  const { bounds } = getMap(state.mapId);
  const safe = point => Number.isFinite(point?.x) && Number.isFinite(point?.z)
    && point.x >= bounds.min + dropRadius && point.x <= bounds.max - dropRadius
    && point.z >= bounds.min + dropRadius && point.z <= bounds.max - dropRadius
    && canOccupy(point.x, point.z, dropRadius, solids);
  const anchor = world ? dropAnchor({ ...position, y: position?.y ?? 0 }, world) : safe(position) ? { ...position, y: 0 } : null;
  if (!anchor || (position.y !== undefined && !Number.isFinite(position.y))) return;
  state.lastDroppedLife.set(actorId, lifeId);
  for (const [index, item] of items.entries()) {
    const angle = index * Math.PI * 2 / Math.max(1, items.length);
    const spread = { x: anchor.x + .35 * Math.cos(angle), y: anchor.y, z: anchor.z + .35 * Math.sin(angle) };
    const projected = world ? dropAnchor(spread, world) : safe(spread) ? spread : null;
    const clear = projected && (world ? projected.y === anchor.y && interactionReach(anchor, projected, world)
      : hasLineOfSight(anchor, projected, solids));
    const point = clear ? projected : anchor;
    state.drops.push({
      id: `drop:${state.nextDropId++}`, x: point.x, y: point.y, z: point.z, item: { ...item }, source: 'drop',
      availableRemaining: GEAR_BALANCE.dropUnlock, expiresRemaining: GEAR_BALANCE.dropExpiry,
    });
  }
  if (state.drops.length > GEAR_BALANCE.maxDrops) state.drops.splice(0, state.drops.length - GEAR_BALANCE.maxDrops);
}

export function lootDTO(state) {
  return [...state.slots.filter(slot => slot.present), ...state.drops].map(dto);
}

import { canOccupyBody, supportBelow, segmentClear } from './spatial.js';

const point = actor => ({ x: actor.x, y: actor.y ?? 0, z: actor.z });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const identity = actor => actor && typeof actor.id === 'string' && actor.id.length > 0
  && Number.isSafeInteger(actor.lifeId) && actor.lifeId >= 0;
const current = (state, actor) => {
  const record = state.actors.get(actor?.id);
  return record?.lifeId === actor?.lifeId ? record : null;
};
const findSpot = (map, id) => map.hideSpots?.find(spot => spot.id === id);
const result = (ok, reason, changed, hiddenSpotId, position) => ({ ok, reason, changed, hiddenSpotId, position: position ? { ...position } : null });
const supported = (p, world) => canOccupyBody(p, .42, 1.84, world)
  && Math.abs((supportBelow(p, .42, world)?.y ?? -100) - p.y) < 1e-8;

function clearPassage(a, b, world) {
  if (!a || !b || ![a.x, a.y, a.z, b.x, b.y, b.z].every(Number.isFinite) || Math.abs(a.y - b.y) > .05) return false;
  if (!segmentClear({ ...a, y: a.y + 1 }, { ...b, y: b.y + 1 }, world)) return false;
  const steps = Math.max(1, Math.ceil(distance(a, b) / .1));
  for (let n = 0; n <= steps; n++) if (!canOccupyBody({ x: a.x + (b.x - a.x) * n / steps,
    y: a.y + (b.y - a.y) * n / steps, z: a.z + (b.z - a.z) * n / steps }, .4, 1.84, world)) return false;
  return true;
}

function eligible(actor, spot, { world, active }) {
  const p = point(actor);
  return active && actor.alive === true && actor.grounded === true && spot
    && distance(p, spot.entry) <= 1.5 + 1e-9 && Math.abs(p.y - spot.entry.y) <= .05
    && canOccupyBody(p, .34, 1.84, world) && Math.abs((supportBelow(p, .34, world)?.y ?? -100) - p.y) < 1e-8
    && ['entry', 'occupant', 'exit', 'recovery'].every(name => supported(spot[name], world))
    && clearPassage(p, spot.entry, world) && clearPassage(spot.entry, spot.occupant, world)
    && clearPassage(spot.exit, spot.recovery, world);
}

export function createHidingState() { return { occupants: new Map(), actors: new Map() }; }

export function releaseHiding(state, actorId, lifeId) {
  const record = state.actors.get(actorId);
  if (!record || record.lifeId !== lifeId) return;
  const occupant = state.occupants.get(record.spotId);
  if (occupant?.actorId === actorId && occupant.lifeId === lifeId) state.occupants.delete(record.spotId);
  state.actors.delete(actorId);
}

export function exitHiding(state, actor, { map, world, reason = null }) {
  const record = current(state, actor);
  if (!record) return result(true, null, false, null, null);
  const spot = findSpot(map, record.spotId);
  const position = spot && [spot.exit, spot.recovery].find(p => supported(p, world));
  if (!position) return result(false, 'No safe exit', false, record.spotId, null);
  releaseHiding(state, actor.id, actor.lifeId);
  return result(true, null, true, null, position);
}

export function requestHide(state, actor, action, options) {
  const record = current(state, actor), hidden = record?.spotId ?? null;
  const deny = reason => result(false, reason, false, hidden, null);
  if (!identity(actor) || !action || action.lifeId !== actor.lifeId) return deny('Stale life');
  const stored = state.actors.get(actor.id);
  if (stored && stored.lifeId !== actor.lifeId) return deny('Stale occupancy');
  const spot = findSpot(options.map, action.spotId);
  if (!spot || !['enter', 'exit'].includes(action.kind)) return deny('Unknown hiding spot');
  if (!options.active || actor.alive !== true) return deny('Cannot hide while inactive');
  if (action.kind === 'exit') {
    if (record && record.spotId !== spot.id) return deny('Wrong hiding spot');
    return exitHiding(state, actor, options);
  }
  if (record) return record.spotId === spot.id ? result(true, null, false, spot.id, spot.occupant) : deny('Already hiding');
  if (!eligible(actor, spot, options)) return deny('Move to the entrance');
  if (state.occupants.has(spot.id)) return deny('Occupied');
  state.occupants.set(spot.id, { actorId: actor.id, lifeId: actor.lifeId });
  state.actors.set(actor.id, { lifeId: actor.lifeId, spotId: spot.id });
  return result(true, null, true, spot.id, spot.occupant);
}

export function hidingContext(state, actor, options) {
  const empty = { spotId: null, label: null, enabled: false };
  if (!identity(actor) || !options.active || !actor.alive) return empty;
  const record = current(state, actor);
  if (record) return { spotId: record.spotId, label: 'Exit', enabled: true };
  const spots = (options.map.hideSpots ?? []).filter(spot => eligible(actor, spot, options));
  spots.sort((a, b) => distance(point(actor), a.entry) - distance(point(actor), b.entry) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const spot = spots[0];
  if (!spot) return empty;
  const occupied = state.occupants.has(spot.id);
  return { spotId: spot.id, label: occupied ? 'Occupied' : 'Hide', enabled: !occupied };
}

// This consumes raw intent, before equipment locks or supply-use suppression.
export function attackExit(state, actor, rawIntent, options) {
  if (!current(state, actor) || !(rawIntent?.fire || rawIntent?.firePressed || rawIntent?.kind === 'throw')) return null;
  return exitHiding(state, actor, { ...options, reason: 'attack' });
}

export function hidingDropPosition(state, actor, map) {
  const record = current(state, actor), spot = record && findSpot(map, record.spotId);
  return { ...(spot?.exit ?? point(actor)) };
}

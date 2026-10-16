import { entriesObject } from './entries-object.js';
import { rayBoxHit, segmentClear } from './spatial.js';

export function spotDamageTargets(state, actors, map) {
  const targets = [];
  for (const spot of map.hideSpots ?? []) {
    const occupant = state.occupants.get(spot.id);
    if (!occupant) continue;
    const actor = actors.find(a => a.id === occupant.actorId && a.lifeId === occupant.lifeId && a.alive);
    if (!actor || state.actors.get(actor.id)?.spotId !== spot.id) continue;
    targets.push({ actorId: actor.id, lifeId: actor.lifeId, spotId: spot.id,
      bounds: { min: { ...spot.proxy.min }, max: { ...spot.proxy.max } }, shellIds: [...spot.shellIds] });
  }
  return targets;
}

export function raySpotHit(origin, direction, range, targets, world) {
  let nearest = null;
  for (const target of targets) {
    const hit = rayBoxHit(origin, direction, range, target.bounds);
    if (!hit || !segmentClear(origin, hit.point, world, { ignoreSolidIds: target.shellIds })) continue;
    if (!nearest || hit.distance < nearest.distance || (hit.distance === nearest.distance && target.actorId < nearest.actorId)) {
      nearest = { actorId: target.actorId, lifeId: target.lifeId, spotId: target.spotId, ...hit };
    }
  }
  return nearest;
}

export function spotBlastExposure(origin, target, world) {
  const point = entriesObject(['x', 'y', 'z'].map(axis => [axis, Math.max(target.bounds.min[axis], Math.min(target.bounds.max[axis], origin[axis]))]));
  const distance = Math.hypot(point.x - origin.x, point.y - origin.y, point.z - origin.z);
  return { point, distance, visible: segmentClear(origin, point, world, { ignoreSolidIds: target.shellIds }) };
}

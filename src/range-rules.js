// Pure practice rules. Only the active simulation caller advances target time.
import { RANGE_TARGETS } from './range-map.js';
import { HEADSHOT_DAMAGE } from './gun-damage.js';
import { MAX_XP } from './progression.js';
import { rayBoxHit, solidBounds } from './spatial.js';

export const RANGE_TARGET_DIMENSIONS = Object.freeze({
  dummy: Object.freeze({ halfWidth: .32, halfDepth: .32, minY: .05, maxY: 1.84, headAboveY: 1.48 }),
  bullseye: Object.freeze({ halfWidth: .6, halfDepth: .05, minY: .75, maxY: 1.95,
    centreHalfWidth: .15, centreMinY: 1.2, centreMaxY: 1.5 }),
});
const HEALTH = 100, RESPAWN_SECONDS = 5;
const pointValid = point => point && [point.x, point.y, point.z].every(Number.isFinite);
const positiveId = id => typeof id === 'string' && id.length > 0;
const nonnegative = value => Number.isFinite(value) && value >= 0;
const fail = () => { throw new RangeError('Invalid range input'); };
const increment = value => Math.min(MAX_XP, value + 1);
const missed = () => ({ landed: false, killed: false, damage: 0, kill: null });

function requireTarget(target) {
  if (!target || !positiveId(target.id) || !Object.hasOwn(RANGE_TARGET_DIMENSIONS, target.kind)
    || !pointValid(target) || target.y < 0) fail();
}

export function rangeTargetBounds(target) {
  requireTarget(target);
  const dimensions = RANGE_TARGET_DIMENSIONS[target.kind];
  return {
    min: { x: target.x - dimensions.halfWidth, y: target.y + dimensions.minY, z: target.z - dimensions.halfDepth },
    max: { x: target.x + dimensions.halfWidth, y: target.y + dimensions.maxY, z: target.z + dimensions.halfDepth },
  };
}

export function rangeHitRegion(target, point) {
  requireTarget(target);
  if (!pointValid(point)) fail();
  const dimensions = RANGE_TARGET_DIMENSIONS[target.kind];
  if (target.kind === 'dummy') return point.y > target.y + dimensions.headAboveY ? 'head' : 'body';
  return point.x >= target.x - dimensions.centreHalfWidth && point.x <= target.x + dimensions.centreHalfWidth
    && point.y >= target.y + dimensions.centreMinY && point.y <= target.y + dimensions.centreMaxY ? 'centre' : 'body';
}

export function createRangeState(targets = RANGE_TARGETS) {
  if (!Array.isArray(targets)) fail();
  const ids = new Set();
  for (const target of targets) {
    requireTarget(target);
    if (ids.has(target.id)) fail();
    ids.add(target.id);
  }
  return { targets: targets.map(target => ({ ...target, health: HEALTH, lifeId: 1, respawnRemaining: 0 })),
    shotsFired: 0, shotsHit: 0, targetKills: 0, precisionKills: 0, respawnElapsed: new Map() };
}

export function rangeSnapshot(state) {
  return { targets: state.targets.map(target => ({ ...target })),
    shotsFired: state.shotsFired, shotsHit: state.shotsHit, targetKills: state.targetKills,
    precisionKills: state.precisionKills, accuracy: state.shotsFired ? state.shotsHit / state.shotsFired * 100 : 0 };
}

function requireSolid(solid) {
  if (!solid || ![solid.x, solid.z, solid.w, solid.d, solid.minY ?? 0, solid.maxY ?? solid.height].every(Number.isFinite)
    || solid.w <= 0 || solid.d <= 0 || (solid.minY ?? 0) < 0
    || (solid.maxY ?? solid.height) <= (solid.minY ?? 0)) fail();
}

export function traceRangeRay(state, ray) {
  if (!ray || !pointValid(ray.origin) || !pointValid(ray.direction) || !nonnegative(ray.range)
    || !Array.isArray(ray.solids)) fail();
  const magnitude = Math.hypot(ray.direction.x, ray.direction.y, ray.direction.z);
  if (!Number.isFinite(magnitude) || magnitude === 0) fail();
  for (const solid of ray.solids) requireSolid(solid);
  let nearest = null;
  for (const target of state.targets) {
    if (target.health <= 0) continue;
    const hit = rayBoxHit(ray.origin, ray.direction, ray.range, rangeTargetBounds(target));
    if (hit && (!nearest || hit.distance < nearest.distance)) {
      nearest = { targetId: target.id, lifeId: target.lifeId, ...hit, region: rangeHitRegion(target, hit.point) };
    }
  }
  if (!nearest) return null;
  for (const solid of ray.solids) {
    const hit = rayBoxHit(ray.origin, ray.direction, nearest.distance, solidBounds(solid));
    if (hit && hit.distance <= nearest.distance) return null;
  }
  return nearest;
}

export function applyRangeHit(state, hit, bodyDamage) {
  if (!nonnegative(bodyDamage) || !hit || !positiveId(hit.targetId) || !Number.isSafeInteger(hit.lifeId)
    || hit.lifeId <= 0 || !pointValid(hit.point) || !nonnegative(hit.distance)
    || !['body', 'head', 'centre'].includes(hit.region)) fail();
  const target = state.targets.find(target => target.id === hit.targetId);
  if (target) {
    const bounds = rangeTargetBounds(target);
    // Floating-point ray intersections can land just beyond an exact face.
    if (hit.region !== rangeHitRegion(target, hit.point)
      || !['x', 'y', 'z'].every(axis => hit.point[axis] >= bounds.min[axis] - 1e-8
        && hit.point[axis] <= bounds.max[axis] + 1e-8)) fail();
  }
  if (!target || target.health <= 0 || hit.lifeId !== target.lifeId) return missed();
  const precision = hit.region === 'head' || hit.region === 'centre';
  const damage = precision ? HEADSHOT_DAMAGE : bodyDamage;
  target.health = Math.max(0, target.health - damage);
  if (target.health > 0) return { landed: true, killed: false, damage, kill: null };
  target.respawnRemaining = RESPAWN_SECONDS;
  state.respawnElapsed.set(target.id, { elapsed: 0, correction: 0 });
  state.targetKills = increment(state.targetKills);
  if (precision) state.precisionKills = Math.min(state.targetKills, increment(state.precisionKills));
  return { landed: true, killed: true, damage, kill: { targetId: target.id, lifeId: target.lifeId, region: hit.region } };
}

export function recordRangeShot(state, landed) {
  if (typeof landed !== 'boolean') fail();
  state.shotsFired = increment(state.shotsFired);
  if (landed) state.shotsHit = Math.min(state.shotsFired, increment(state.shotsHit));
}

export function tickRangeTargets(state, dt) {
  if (!nonnegative(dt)) fail();
  if (dt === 0) return;
  for (const target of state.targets) {
    if (target.health > 0) continue;
    const timer = state.respawnElapsed.get(target.id);
    // Compensated addition preserves the five-second boundary over frame substeps.
    const step = dt - timer.correction, elapsed = timer.elapsed + step;
    timer.correction = (elapsed - timer.elapsed) - step;
    timer.elapsed = elapsed;
    target.respawnRemaining = Math.max(0, RESPAWN_SECONDS - elapsed);
    if (target.respawnRemaining === 0) {
      target.health = HEALTH;
      target.lifeId += 1;
      state.respawnElapsed.delete(target.id);
    }
  }
}

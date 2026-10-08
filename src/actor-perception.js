import { hasLineOfSight } from './collision.js';
import { smokeBlocksSight } from './gear-combat.js';

export function canPerceive(observer, target, { world, smokes = [] }) {
  if (!observer || !target || observer.alive === false || target.alive === false || target.hiddenSpotId || observer.flashRemaining > 0) return false;
  const eye = actor => ({ x: actor.x, y: (actor.y ?? 0) + 1.35, z: actor.z });
  const a = eye(observer), b = eye(target);
  return [a.x, a.y, a.z, b.x, b.y, b.z].every(Number.isFinite)
    && hasLineOfSight(a, b, world.solids) && !smokeBlocksSight(a, b, smokes);
}

export function forgetTarget(brain, targetId) {
  const remembered = brain.lastKnownTargets?.get(targetId);
  brain.lastKnownTargets?.delete(targetId);
  const pursuit = brain.intent?.goal;
  const matches = brain.targetId === targetId || brain.intent?.targetId === targetId
    || (remembered && pursuit && pursuit.x === remembered.x && pursuit.z === remembered.z && (pursuit.y ?? 0) === (remembered.y ?? 0));
  if (!matches) return;
  brain.targetId = null;
  if ('goal' in brain) brain.goal = null;
  if (brain.intent) brain.intent = { goal: null, targetId: null };
  brain.waypoint = null; brain.pathTimer = 0; brain.pathRemaining = 0; brain.intentTimer = 0;
}

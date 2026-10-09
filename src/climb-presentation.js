import { projectLadder, sampleLadder } from './access-schema.js';
import { sweepBodyClear } from './spatial.js';

const point = p => ({ x:p.x, y:p.y, z:p.z });
const hiddenHint = () => ({ text:'', visible:false });

export function climbHint(body, world) {
  if (!body || !world || body.alive === false || body.health <= 0 || body.dead > 0
    || body.respawnRemaining > 0 || body.hiddenSpotId) return hiddenHint();
  const ladders = world.ladders ?? [];
  if (body.ladderId) return ladders.some(l => l.id === body.ladderId && projectLadder(l,body).error <= .0001)
    ? { text:'Climbing · Jump to let go', visible:true } : hiddenHint();
  if (body.grounded && ladders.some(l => [l.bottom,l.top].some(end => body.supportId === end.supportId
    && Math.abs(body.y-end.point.y) < 1e-6 && Math.hypot(body.x-end.point.x,body.z-end.point.z) <= 1.2
    && sweepBodyClear(body,end.point,.4,1.84,world)))) return { text:'Up / down to climb', visible:true };
  return hiddenHint();
}

export function renderClimbHint(element, view) {
  element.textContent = view.visible ? view.text : '';
  element.hidden = !view.visible;
}

export function interpolateClimber(previous, next, alpha, world) {
  if (!previous || previous.lifeId !== next.lifeId || previous.mapId !== next.mapId
    || (previous.ladderId ?? null) !== (next.ladderId ?? null)) return point(next);
  const t = Number.isFinite(alpha) ? Math.max(0,Math.min(1,alpha)) : 1;
  if (next.ladderId) {
    const ladder = world.ladders?.find(l => l.id === next.ladderId);
    if (!ladder) return point(next);
    const a = projectLadder(ladder,previous), b = projectLadder(ladder,next);
    if (a.error > .0001 || b.error > .0001) return point(next);
    return sampleLadder(ladder,a.distance+(b.distance-a.distance)*t);
  }
  return { x:previous.x+(next.x-previous.x)*t, y:previous.y+(next.y-previous.y)*t, z:previous.z+(next.z-previous.z)*t };
}

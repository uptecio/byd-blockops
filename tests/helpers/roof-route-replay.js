import { createSpatialWorld } from '../../src/spatial.js';
import { createNavigation, navigationIntent } from '../../src/navigation.js';
import { createBody, moveCharacter } from '../../src/character-movement.js';

const cache = new WeakMap();
export function replayRoof(map, roof, { speed, radius = .42, direction = 'up', jump = true } = {}) {
  let profiles = cache.get(map);
  if (!profiles) cache.set(map, profiles = new Map());
  if (!profiles.has(radius)) profiles.set(radius, { world: createSpatialWorld(map), nav: createNavigation(map, { radius }) });
  const { world, nav } = profiles.get(radius);
  const entry = map.traversal.links.find(l => l.id === roof.entryLinkId);
  const bottom = map.traversal.links.find(l => l.routeId === entry.routeId).from;
  const start = direction === 'up' ? bottom : roof.point, goal = direction === 'up' ? roof.point : bottom;
  let body = createBody(start, world, { radius });
  const intents = [], trace = [];
  for (let n = 0; n < 12000; n++) {
    if (body.grounded && Math.hypot(body.x-goal.x,body.y-goal.y,body.z-goal.z) < .02) break;
    const waypoint = nav.nextWaypoint(body, goal);
    const intent = navigationIntent(body, waypoint, Math.min(speed, waypoint ? Math.hypot(waypoint.x-body.x,waypoint.z-body.z)*60 : speed), world);
    if (!jump) intent.jump = false;
    const result = moveCharacter(body, intent, 1/60, { world, radius });
    intents.push(intent); trace.push(result); body = result.body;
    if (result.invalid || (!jump && n > 300)) break;
  }
  return { body, intents, trace, seconds: trace.length/60, stats: nav.stats() };
}

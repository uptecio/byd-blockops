import { hasLineOfSight } from './collision.js';
import { meleeTarget } from './gear-combat.js';
import { ZOMBIE_BALANCE as balance } from './zombie-survival.js';
import { createSpatialWorld, canOccupyBody } from './spatial.js';
import { moveCharacter } from './character-movement.js';
import { navigationIntent } from './navigation.js';
import { canPerceive, forgetTarget } from './actor-perception.js';

const radius = .4;
const point = a => ({ x: a.x, y: a.y ?? 0, z: a.z });
const distance = (a, b) => Math.hypot(a.x - b.x, (a.y ?? 0) - (b.y ?? 0), a.z - b.z);
const finite = a => a && [a.x, a.y, a.z, a.yaw, a.pitch].every(Number.isFinite);

export function selectZombieSpawn({ map, navigation, player, zombies, fovRadians }) {
  if (!finite(player) || !player.alive) return null;
  const world = createSpatialWorld(map), candidates = [], seen = new Set();
  const hidden = player.hiddenSpotId && map.hideSpots?.find(spot => spot.id === player.hiddenSpotId);
  const connectivity = hidden?.entry ?? player;
  const locations = [...map.spawns, map.playerSpawn, ...Object.values(map.teamSpawns).flat()];
  for (const source of locations) {
    if (!source || !Number.isFinite(source.x) || !Number.isFinite(source.z)) continue;
    const p = point(source), key = `${p.x}:${p.y}:${p.z}`;
    if (seen.has(key)) continue; seen.add(key);
    if (distance(p, player) < balance.spawnDistance || !canOccupyBody(p, radius, 1.84, world)
      || zombies.some(z => z.alive && distance(p, z) < balance.separation)
      || !navigation.nextApproachWaypoint(p, connectivity, .34)) continue;
    const dot = ((p.x - player.x) * -Math.sin(player.yaw) + (p.z - player.z) * -Math.cos(player.yaw)) / Math.hypot(p.x - player.x, p.z - player.z);
    candidates.push({ p, outside: dot < Math.cos((Number.isFinite(fovRadians) ? fovRadians : Math.PI / 2) / 2) });
  }
  return (candidates.find(c => c.outside) || candidates[0])?.p ?? null;
}

export function createZombieBrain(kind) {
  if (kind !== 'walker' && kind !== 'runner') throw new RangeError('Unknown zombie kind');
  return { goal: null, targetId: null, waypoint: null, pathRemaining: 0, attackRemaining: balance[kind].interval, patrolSequence: 0 };
}

export function stepZombieBrain(brain, { actor, player, zombies, navigation, solids, world, smokes, dt }) {
  const body = { ...point(actor), velocityY: actor.velocityY ?? 0, grounded: actor.grounded ?? true, supportId: actor.supportId ?? 'ground' };
  const result = { x: actor.x, y: actor.y, z: actor.z, yaw: actor.yaw, attack: false, body };
  if (!Number.isFinite(dt) || dt <= 0 || !finite(actor) || !finite(player) || !actor.alive || !player.alive) return result;
  const config = balance[actor.kind]; if (!config) return result;
  if (player.hiddenSpotId) forgetTarget(brain, player.id);
  if (actor.flashRemaining > 0) {
    result.body = moveCharacter(body, { vx: 0, vz: 0, jump: false }, dt, { world, radius }).body;
    return { ...result, ...point(result.body) };
  }
  brain.attackRemaining = Math.max(0, brain.attackRemaining - dt);
  brain.pathRemaining = Math.max(0, brain.pathRemaining - dt);
  const visible = canPerceive(actor, player, { world, smokes });
  if (visible) { brain.goal = point(player); brain.targetId = player.id; }
  if (!brain.goal || (brain.targetId === null && distance(actor, brain.goal) < .25)) {
    brain.goal = navigation.patrolPoint(actor.id, actor, brain.patrolSequence++);
    brain.waypoint = null; brain.pathRemaining = 0;
  }
  if (brain.goal && (brain.pathRemaining <= 1e-9 || (brain.waypoint && distance(actor, brain.waypoint) < .04))) {
    brain.waypoint = brain.targetId === player.id ? navigation.nextApproachWaypoint(body, brain.goal, .34) : navigation.nextWaypoint(body, brain.goal);
    brain.pathRemaining = balance.pathInterval;
  }
  let intent = { vx: 0, vz: 0, jump: false };
  const goal = brain.goal;
  const clearGoal = goal && hasLineOfSight({ ...point(actor), y: actor.y + 1.6 }, { ...goal, y: goal.y + 1.6 }, solids);
  if (actor.flashRemaining <= 0 && brain.waypoint && (!clearGoal || distance(actor, goal) > .9 || brain.targetId === null)) {
    const toWaypoint = Math.hypot(brain.waypoint.x - actor.x, brain.waypoint.z - actor.z);
    const speed = Math.min(config.speed, toWaypoint / dt, clearGoal && brain.targetId !== null ? Math.max(0, distance(actor, goal) - .9) / dt : Infinity);
    intent = navigationIntent(body, brain.waypoint, speed, world);
  }
  if (actor.flashRemaining <= 0) {
    let pushX = 0, pushZ = 0;
    for (const other of zombies) {
      if (other.id === actor.id || !other.alive || actor.y >= other.y + 1.84 || other.y >= actor.y + 1.84) continue;
      const dx = actor.x - other.x, dz = actor.z - other.z, length = Math.hypot(dx, dz);
      if (length >= balance.separation) continue;
      const push = (balance.separation - length) / 2;
      pushX += (length > 1e-9 ? dx / length : actor.id < other.id ? -1 : 1) * push;
      pushZ += (length > 1e-9 ? dz / length : 0) * push;
    }
    const length = Math.hypot(pushX, pushZ), scale = length ? Math.min(length, config.speed * dt) / length / dt : 0;
    intent.vx += pushX * scale; intent.vz += pushZ * scale;
  }
  result.body = moveCharacter(body, intent, dt, { world, radius }).body;
  Object.assign(result, point(result.body));
  if (goal && distance(result, goal) > 1e-9) result.yaw = Math.atan2(result.x - goal.x, result.z - goal.z);
  if (visible && brain.attackRemaining <= 1e-9 && meleeTarget({ ...actor, ...result }, [player], { solids, isEnemy: (a, b) => a === actor.id && b === player.id })) {
    result.attack = true; brain.attackRemaining = config.interval;
  }
  return result;
}

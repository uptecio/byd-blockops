import { GEAR_BALANCE, GRENADE_TYPES } from './equipment-catalog.js';
import { consumeGrenade } from './equipment.js';
import { hasLineOfSight } from './collision.js';
import { AVATAR_HITBOX } from './avatar-hitbox.js';
import { solidBounds } from './spatial.js';
import { spotDamageTargets, raySpotHit, spotBlastExposure } from './hiding-combat.js';

const physics = GEAR_BALANCE.grenadePhysics;
const axes = ['x', 'y', 'z'];
const epsilon = 1e-9;
const compareId = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
const eye = actor => ({ x: actor.x, y: actor.y + GEAR_BALANCE.eyeHeight, z: actor.z });
const aim = actor => ({ x: -Math.sin(actor.yaw) * Math.cos(actor.pitch),
  y: Math.sin(actor.pitch), z: -Math.cos(actor.yaw) * Math.cos(actor.pitch) });
const difference = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const length = v => Math.hypot(v.x, v.y, v.z);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const finiteActor = actor => actor && [actor.x, actor.y, actor.z, actor.yaw, actor.pitch].every(Number.isFinite);

export function createGearCombatState() {
  return { projectiles: [], smokes: [], reservedSmoke: 0, nextId: 1, events: [] };
}

// Center aim may hit a nearby torso while the target eye is outside the cone.
// Intersect the existing gun/avatar body box without expanding center reach.
function bodyRayContact(origin, direction, target) {
  const width = AVATAR_HITBOX.halfWidth;
  const box = { x: [target.x - width, target.x + width],
    y: [target.y + .05, target.y + AVATAR_HITBOX.height], z: [target.z - width, target.z + width] };
  let enter = 0, leave = Infinity;
  for (const axis of axes) {
    const [low, high] = box[axis], speed = direction[axis];
    if (Math.abs(speed) < epsilon) {
      if (origin[axis] < low || origin[axis] > high) return null;
    } else {
      const a = (low - origin[axis]) / speed, b = (high - origin[axis]) / speed;
      enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
      if (enter > leave) return null;
    }
  }
  return { x: origin.x + direction.x * enter, y: origin.y + direction.y * enter, z: origin.z + direction.z * enter };
}

// Selection alone does not spend a swing: adapters call beginMelee once, even on a miss.
export function meleeTarget(actor, actors, { solids, isEnemy, hiding }) {
  if (!finiteActor(actor) || !actor.alive) return null;
  const origin = eye(actor), direction = aim(actor);
  const candidates = [];
  const proxies = hiding ? spotDamageTargets(hiding.state, actors, hiding.map) : [];
  for (const target of actors) {
    if (target.id === actor.id || !target.alive || target.protectedRemaining > 0
      || !isEnemy(actor.id, target.id)) continue;
    if (target.hiddenSpotId) {
      const proxy = proxies.find(p => p.actorId === target.id);
      if (!proxy) continue;
      const exposure = spotBlastExposure(origin, proxy, hiding.world);
      const offset = difference(exposure.point, origin), distance = exposure.distance;
      const inCone = distance <= epsilon || dot(direction, offset) / distance >= Math.cos(GEAR_BALANCE.knife.halfAngle) - epsilon;
      if (distance <= GEAR_BALANCE.knife.reach + epsilon && inCone && exposure.visible) candidates.push({ id: target.id, distance });
      else {
        const hit = raySpotHit(origin, direction, GEAR_BALANCE.knife.reach, [proxy], hiding.world);
        if (hit) candidates.push({ id: target.id, distance: hit.distance });
      }
      continue;
    }
    const position = eye(target), offset = difference(position, origin), distance = length(offset);
    if (distance > GEAR_BALANCE.knife.reach + epsilon) continue;
    const inCone = distance <= epsilon || dot(direction, offset) / distance >= Math.cos(GEAR_BALANCE.knife.halfAngle) - epsilon;
    if (inCone && hasLineOfSight(origin, position, solids)) candidates.push({ id: target.id, distance });
    else {
      // Solo camera and server gun rays start at 1.65; keep the original
      // 1.6 eye-point cone/reach above and use the real ray for body contact.
      const rayOrigin = { ...origin, y: actor.y + 1.65 };
      const contact = bodyRayContact(rayOrigin, direction, target);
      if (contact && hasLineOfSight(rayOrigin, contact, solids)) candidates.push({ id: target.id, distance });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || compareId(a.id, b.id));
  return candidates[0]?.id ?? null;
}

function bounds(solid) {
  const r = physics.radius, box = solidBounds(solid);
  return { x: [box.min.x - r, box.max.x + r], y: [box.min.y - r, box.max.y + r], z: [box.min.z - r, box.max.z + r] };
}

// Sweeping the centre against radius-expanded AABBs conservatively protects corners.
function boxHit(position, delta, box) {
  let enter = -Infinity, leave = Infinity, normal = null;
  for (const axis of axes) {
    const [low, high] = box[axis], speed = delta[axis];
    if (Math.abs(speed) < epsilon) {
      if (position[axis] < low || position[axis] > high) return null;
      continue;
    }
    const first = (low - position[axis]) / speed, second = (high - position[axis]) / speed;
    const near = Math.min(first, second), far = Math.max(first, second);
    if (near > enter) { enter = near; normal = { x: 0, y: 0, z: 0, [axis]: speed > 0 ? -1 : 1 }; }
    leave = Math.min(leave, far);
    if (enter > leave) return null;
  }
  if (enter < -epsilon || enter > 1 || leave < 0 || !normal) return null;
  return { time: Math.max(0, enter), normal };
}

function firstHit(position, delta, solids) {
  let hit = null;
  if (delta.y < 0) {
    const time = (physics.radius - position.y) / delta.y;
    if (time >= -epsilon && time <= 1) hit = { time: Math.max(0, time), normal: { x: 0, y: 1, z: 0 } };
  }
  for (const solid of solids) {
    const candidate = boxHit(position, delta, bounds(solid));
    if (candidate && (!hit || candidate.time < hit.time)) hit = candidate;
  }
  return hit;
}

function insideSolid(position, solids) {
  return position.y < physics.radius || solids.some(solid => {
    const box = bounds(solid);
    return axes.every(axis => position[axis] > box[axis][0] && position[axis] < box[axis][1]);
  });
}

export function throwGrenade(state, actor, grenadeType, { solids }) {
  const denied = reason => ({ ok: false, reason });
  if (!finiteActor(actor) || !actor.alive) return denied('Cannot throw while inactive');
  if (!GRENADE_TYPES.includes(grenadeType)) return denied('Unknown grenade type');
  if (state.projectiles.length >= GEAR_BALANCE.maxProjectiles) return denied('Too many grenades in flight');
  if (grenadeType === 'smoke' && state.smokes.length + state.reservedSmoke >= GEAR_BALANCE.maxSmoke) return denied('Too many smoke areas');
  const origin = eye(actor), direction = aim(actor);
  const offset = Object.fromEntries(axes.map(axis => [axis, direction[axis] * physics.releaseDistance]));
  const position = Object.fromEntries(axes.map(axis => [axis, origin[axis] + offset[axis]]));
  if (insideSolid(origin, solids) || insideSolid(position, solids) || firstHit(origin, offset, solids)) return denied('Grenade release blocked');
  const result = consumeGrenade(actor.equipment, grenadeType);
  if (!result.ok) return result;
  const id = `grenade-${state.nextId++}`;
  state.projectiles.push({ id, grenadeType, ownerId: actor.id, ownerTeamId: actor.teamId,
    ownerLifeId: actor.lifeId, ...position, vx: direction.x * physics.launchSpeed,
    vy: direction.y * physics.launchSpeed + physics.launchLift, vz: direction.z * physics.launchSpeed,
    fuseRemaining: GEAR_BALANCE.grenades[grenadeType].fuse });
  if (grenadeType === 'smoke') state.reservedSmoke++;
  state.events.push({ type: 'grenade-throw', playerId: actor.id, grenadeId: id, grenadeType });
  return { ok: true };
}

function resting(projectile, solids) {
  if (projectile.vy !== 0) return false;
  if (projectile.y <= physics.radius + epsilon) return true;
  return solids.some(solid => {
    const box = bounds(solid);
    return Math.abs(projectile.y - box.y[1]) < epsilon
      && projectile.x > box.x[0] && projectile.x < box.x[1]
      && projectile.z > box.z[0] && projectile.z < box.z[1];
  });
}

function moveProjectile(projectile, duration, solids) {
  if (duration <= 0) return;
  // Fuse length caps the number of substeps, including after a long frame stall.
  const steps = Math.ceil(duration / physics.maxStep), dt = duration / steps;
  for (let step = 0; step < steps; step++) {
    if (!resting(projectile, solids)) projectile.vy -= physics.gravity * dt;
    let remaining = dt;
    // A bounded collision loop handles wall/ground intersections in one substep.
    for (let collision = 0; collision < 4 && remaining > epsilon; collision++) {
      const velocity = { x: projectile.vx, y: projectile.vy, z: projectile.vz };
      const delta = Object.fromEntries(axes.map(axis => [axis, velocity[axis] * remaining]));
      const hit = firstHit(projectile, delta, solids);
      for (const axis of axes) projectile[axis] += delta[axis] * (hit?.time ?? 1);
      if (!hit) break;
      const normalSpeed = dot(velocity, hit.normal);
      for (const axis of axes) projectile[`v${axis}`] =
        (velocity[axis] - normalSpeed * hit.normal[axis]) * physics.tangentialMultiplier
        - normalSpeed * hit.normal[axis] * physics.restitution;
      if (hit.normal.y > 0 && projectile.vy < physics.restSpeed) projectile.vy = 0;
      remaining *= 1 - hit.time;
    }
    if (Math.abs(projectile.y - physics.radius) < epsilon) projectile.y = physics.radius;
  }
}

function burst(state, projectile, actors, options, elapsedAfterBurst, result) {
  const { grenadeType, ownerId, id } = projectile;
  const balance = GEAR_BALANCE.grenades[grenadeType];
  const position = { x: projectile.x, y: projectile.y, z: projectile.z };
  result.events.push({ type: 'grenade-burst', playerId: ownerId, grenadeId: id, grenadeType, position });
  if (grenadeType === 'smoke') {
    state.reservedSmoke = Math.max(0, state.reservedSmoke - 1);
    const remaining = Math.max(0, balance.duration - elapsedAfterBurst);
    if (remaining > 0) state.smokes.push({ id, ownerId, x: position.x, y: position.y + physics.smokeHeight,
      z: position.z, radius: balance.radius, remaining });
    return;
  }
  // Death preserves eligibility; departure permanently disables existing throws.
  if (projectile.visualOnly || !actors.some(actor => actor.id === ownerId)) return;
  const proxies = options.hiding ? spotDamageTargets(options.hiding.state, actors, options.hiding.map) : [];
  for (const target of [...actors].sort((a, b) => compareId(a.id, b.id))) {
    if (target.id === ownerId || !target.alive || target.protectedRemaining > 0
      || !options.isEnemy(ownerId, target.id)) continue;
    const proxy = target.hiddenSpotId && proxies.find(p => p.actorId === target.id);
    if (target.hiddenSpotId && !proxy) continue;
    const exposure = proxy ? spotBlastExposure(position, proxy, options.hiding.world) : null;
    const targetEye = exposure?.point ?? eye(target), offset = difference(position, targetEye), distance = length(offset);
    const distanceFactor = Math.max(0, 1 - distance / balance.radius);
    if (distanceFactor <= 0 || !(exposure ? exposure.visible : hasLineOfSight(position, targetEye, options.solids))) continue;
    if (grenadeType === 'frag') result.damage.push({ sourceId: ownerId, sourceLifeId: projectile.ownerLifeId,
      targetId: target.id, amount: balance.maxDamage * distanceFactor });
    else {
      const angle = distance <= epsilon ? 0 : Math.acos(Math.max(-1, Math.min(1, dot(aim(target), offset) / distance)));
      const facingFactor = angle <= Math.PI / 3 ? 1 : 1 - .75 * (angle - Math.PI / 3) / (2 * Math.PI / 3);
      result.flashes.push({ targetId: target.id, duration: Math.min(balance.maxDuration, balance.maxDuration * distanceFactor * facingFactor) });
    }
  }
}

// Adapters apply ordered intents, stop on round end, and own actor/equipment timers.
export function stepGearCombat(state, actors, dt, options) {
  const result = { damage: [], flashes: [], events: [] };
  if (!Number.isFinite(dt) || dt <= 0) return result;
  result.events = state.events.splice(0);
  state.smokes = state.smokes.filter(smoke => {
    smoke.remaining = Math.max(0, smoke.remaining - dt);
    return smoke.remaining > 0;
  });
  const bursts = [], alive = [];
  for (const projectile of state.projectiles) {
    const time = Math.max(0, projectile.fuseRemaining);
    moveProjectile(projectile, Math.min(dt, time), options.solids);
    projectile.fuseRemaining = Math.max(0, time - dt);
    if (time <= dt) bursts.push({ projectile, time });
    else alive.push(projectile);
  }
  state.projectiles = alive;
  bursts.sort((a, b) => a.time - b.time || compareId(a.projectile.id, b.projectile.id));
  for (const { projectile, time } of bursts) burst(state, projectile, actors, options, dt - time, result);
  return result;
}

export function smokeBlocksSight(from, to, smokes) {
  const delta = difference(to, from), squaredLength = dot(delta, delta);
  return smokes.some(smoke => {
    if (smoke.remaining <= 0) return false;
    const offset = difference(smoke, from);
    const time = squaredLength === 0 ? 0 : Math.max(0, Math.min(1, dot(offset, delta) / squaredLength));
    const nearest = { x: from.x + delta.x * time, y: from.y + delta.y * time, z: from.z + delta.z * time };
    return length(difference(smoke, nearest)) <= smoke.radius;
  });
}

export function gearCombatDTO(state) {
  return { projectiles: state.projectiles.map(({ visualOnly, ...projectile }) => ({ ...projectile })),
    smokes: state.smokes.map(smoke => ({ ...smoke })) };
}

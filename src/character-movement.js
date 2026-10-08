import { canOccupyBody, overlapsFootprint, supportBelow } from './spatial.js';

import { MOVEMENT } from './movement-constants.js';
export { MOVEMENT } from './movement-constants.js';
const EPS = 1e-8;

export function humanMoveSpeed(classId, zoom = false) {
  return (classId === 'lmg' ? 4.4 : classId === 'smg' || classId === 'sidearm' ? 6 : 5.3) * (zoom ? .65 : 1);
}

export function createBody(position, world, { radius = .4, height = 1.84 } = {}) {
  const point = { x: position.x, y: position.y ?? 0, z: position.z };
  if (!canOccupyBody(point, radius, height, world)) throw new Error('Invalid initial character body');
  const support = supportBelow(point, radius, world);
  const grounded = !!support && Math.abs(support.y - point.y) < EPS;
  return { ...point, velocityY: 0, grounded, supportId: grounded ? support.id : null };
}

export function moveCharacter(body, intent, dt, { world, radius = .4, height = 1.84 }) {
  if (![dt, body.x, body.y, body.z, body.velocityY, intent.vx, intent.vz, radius, height].every(Number.isFinite)
    || dt < 0 || radius <= 0 || height <= 0 || !canOccupyBody(body, radius, height, world)) return { body, invalid: true };
  if (!dt) return { body, invalid: false };
  const next = { ...body }, duration = Math.min(dt, MOVEMENT.maxFrame);
  const support = supportBelow(next, radius, world);
  next.grounded = !!support && Math.abs(next.y - support.y) < EPS && next.velocityY <= 0;
  next.supportId = next.grounded ? support.id : null;
  if (intent.jump && next.grounded) {
    next.velocityY = MOVEMENT.jumpVelocity; next.grounded = false; next.supportId = null;
  }
  const maxSpeed = Math.hypot(intent.vx, intent.vz, Math.abs(next.velocityY) + MOVEMENT.gravity * duration);
  const steps = Math.max(1, Math.ceil(duration / MOVEMENT.maxStep), Math.ceil(duration * maxSpeed / .1));
  if (!Number.isSafeInteger(steps) || steps > 100000) return { body, invalid: true };
  const h = duration / steps;
  for (let step = 0; step < steps; step++) {
    for (const [axis, velocity] of [['x', intent.vx], ['z', intent.vz]]) {
      const candidate = { ...next, [axis]: Math.max(world.bounds.min + radius, Math.min(world.bounds.max - radius, next[axis] + velocity * h)) };
      if (canOccupyBody(candidate, radius, height, world)) next[axis] = candidate[axis];
    }
    next.velocityY -= MOVEMENT.gravity * h;
    let targetY = next.y + next.velocityY * h;
    if (next.velocityY > 0) {
      for (const solid of world.solids) {
        if (solid.minY >= next.y + height - EPS && solid.minY < targetY + height && overlapsFootprint(next, radius, solid)) {
          targetY = solid.minY - height; next.velocityY = 0;
        }
      }
      next.grounded = false; next.supportId = null;
    } else {
      const below = supportBelow(next, radius, world);
      next.grounded = false; next.supportId = null;
      if (below && below.y >= targetY - EPS && canOccupyBody({ ...next, y: below.y }, radius, height, world)) {
        targetY = below.y; next.velocityY = 0; next.grounded = true; next.supportId = below.id;
      }
    }
    next.y = targetY;
  }
  return { body: next, invalid: false };
}

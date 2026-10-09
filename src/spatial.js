// Feet positions and solid heights use world units. Ground is the implicit Y=0 plane.
import { MOVEMENT } from './movement-constants.js';
import { normalizeAccess } from './access-schema.js';
const EPS = 1e-8;
const finitePoint = point => point && [point.x, point.y, point.z].every(Number.isFinite);

export function solidBounds(solid) {
  return {
    min: { x: solid.x - solid.w / 2, y: solid.minY ?? 0, z: solid.z - solid.d / 2 },
    max: { x: solid.x + solid.w / 2, y: solid.maxY ?? solid.height, z: solid.z + solid.d / 2 },
  };
}

export function createSpatialWorld(map) {
  const bounds = { ...map.bounds };
  if (![bounds.min, bounds.max].every(Number.isFinite) || bounds.min >= bounds.max) throw new Error('Invalid world bounds');
  const ids = new Set();
  const solids = map.solids.map((source, index) => {
    const id = source.id ?? `${map.id}:solid:${index}`;
    const minY = source.minY ?? 0, maxY = source.maxY ?? source.height;
    if (typeof id !== 'string' || !id || ids.has(id)
      || ![source.x, source.z, source.w, source.d, minY, maxY].every(Number.isFinite)
      || source.w <= 0 || source.d <= 0 || minY < 0 || maxY <= minY) throw new Error(`Invalid solid ${id}`);
    ids.add(id);
    return { ...source, id, minY, maxY, height: maxY - minY };
  });
  return { mapId: map.id, bounds, solids, ...normalizeAccess(map), maxFeetY: Math.max(0, ...solids.map(solid => solid.maxY)) + MOVEMENT.jumpVelocity ** 2 / (2 * MOVEMENT.gravity) + .1 };
}

export function overlapsFootprint(position, radius, solid) {
  const dx = position.x - Math.max(solid.x - solid.w / 2, Math.min(position.x, solid.x + solid.w / 2));
  const dz = position.z - Math.max(solid.z - solid.d / 2, Math.min(position.z, solid.z + solid.d / 2));
  return dx * dx + dz * dz < radius * radius - EPS;
}

function inBounds(position, radius, world) {
  return position.x >= world.bounds.min + radius - EPS && position.x <= world.bounds.max - radius + EPS
    && position.z >= world.bounds.min + radius - EPS && position.z <= world.bounds.max - radius + EPS;
}

export function canOccupyBody(position, radius, height, world) {
  if (!finitePoint(position) || !Number.isFinite(radius) || radius <= 0 || !Number.isFinite(height) || height <= 0
    || position.y < -EPS || !inBounds(position, radius, world)) return false;
  return !world.solids.some(solid => position.y < solid.maxY - EPS && position.y + height > solid.minY + EPS
    && overlapsFootprint(position, radius, solid));
}

// Continuous upright cylinder sweep. Restrict each solid to its vertical
// overlap interval, then measure horizontal segment-to-rectangle distance.
export function sweepBodyClear(a, b, radius, height, world) {
  if (!canOccupyBody(a,radius,height,world) || !canOccupyBody(b,radius,height,world)) return false;
  const dy=b.y-a.y;
  for (const solid of world.solids) {
    const low=solid.minY-height+EPS,high=solid.maxY-EPS;
    let enter=0,leave=1;
    if (Math.abs(dy)<1e-12) { if (a.y<=low || a.y>=high) continue; }
    else {
      const u=(low-a.y)/dy,v=(high-a.y)/dy;
      enter=Math.max(0,Math.min(u,v)); leave=Math.min(1,Math.max(u,v));
      if (enter>=leave) continue;
    }
    const p={x:a.x+(b.x-a.x)*enter,z:a.z+(b.z-a.z)*enter};
    const q={x:a.x+(b.x-a.x)*leave,z:a.z+(b.z-a.z)*leave};
    const minX=solid.x-solid.w/2,maxX=solid.x+solid.w/2,minZ=solid.z-solid.d/2,maxZ=solid.z+solid.d/2;
    const dx=q.x-p.x,dz=q.z-p.z,square=dx*dx+dz*dz;
    const pointDistance = v => (v.x-Math.max(minX,Math.min(maxX,v.x)))**2+(v.z-Math.max(minZ,Math.min(maxZ,v.z)))**2;
    let nearest=Math.min(pointDistance(p),pointDistance(q));
    if (square>0 && rayBoxHit({x:p.x,y:0,z:p.z},{x:dx,y:0,z:dz},Math.sqrt(square),
      {min:{x:minX,y:-1,z:minZ},max:{x:maxX,y:1,z:maxZ}})) nearest=0;
    for (const x of [minX,maxX]) for (const z of [minZ,maxZ]) {
      const t=square?Math.max(0,Math.min(1,((x-p.x)*dx+(z-p.z)*dz)/square)):0;
      nearest=Math.min(nearest,(x-p.x-t*dx)**2+(z-p.z-t*dz)**2);
    }
    if (nearest<radius*radius-EPS) return false;
  }
  return true;
}

export function supportBelow(position, radius, world) {
  if (!finitePoint(position) || position.y < -EPS || !inBounds(position, radius, world)) return null;
  let support = { id: 'ground', y: 0 };
  for (const solid of world.solids) {
    if (solid.maxY <= position.y + EPS && solid.maxY > support.y && overlapsFootprint(position, radius, solid)) {
      support = { id: solid.id, y: solid.maxY };
    }
  }
  return support;
}

export function rayBoxHit(origin, direction, range, bounds) {
  if (!finitePoint(origin) || !finitePoint(direction) || !Number.isFinite(range) || range < 0) return null;
  const magnitude = Math.hypot(direction.x, direction.y, direction.z);
  if (!magnitude) return null;
  let enter = 0, leave = range;
  for (const axis of ['x', 'y', 'z']) {
    const delta = direction[axis] / magnitude;
    if (Math.abs(delta) < 1e-12) {
      if (origin[axis] < bounds.min[axis] || origin[axis] > bounds.max[axis]) return null;
    } else {
      const a = (bounds.min[axis] - origin[axis]) / delta, b = (bounds.max[axis] - origin[axis]) / delta;
      enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
      if (enter > leave) return null;
    }
  }
  return { distance: enter, point: {
    x: origin.x + direction.x / magnitude * enter,
    y: origin.y + direction.y / magnitude * enter,
    z: origin.z + direction.z / magnitude * enter,
  } };
}

export function segmentClear(a, b, world, { ignoreSolidIds = [] } = {}) {
  if (!finitePoint(a) || !finitePoint(b)) return false;
  const direction = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const range = Math.hypot(direction.x, direction.y, direction.z);
  return !world.solids.some(solid => {
    if (ignoreSolidIds.includes(solid.id)) return false;
    const bounds = solidBounds(solid);
    if (!range) return ['x', 'y', 'z'].every(axis => a[axis] >= bounds.min[axis] && a[axis] <= bounds.max[axis]);
    return rayBoxHit(a, direction, range, bounds) !== null;
  });
}

export function interactionReach(a, b, world, { horizontal = 1.2, vertical = .75 } = {}) {
  if (!finitePoint(a) || !finitePoint(b) || !Number.isFinite(horizontal) || horizontal < 0 || !Number.isFinite(vertical) || vertical < 0) return false;
  return Math.hypot(a.x - b.x, a.z - b.z) <= horizontal + 1e-10 && Math.abs(a.y - b.y) <= vertical + 1e-10
    && segmentClear({ ...a, y: a.y + .1 }, { ...b, y: b.y + .1 }, world);
}

export function dropAnchor(position, world, { radius = .34, height = .2 } = {}) {
  if (!finitePoint(position) || position.y < 0 || !Number.isFinite(radius) || radius <= 0 || !Number.isFinite(height) || height <= 0) return null;
  const support = supportBelow(position, radius, world);
  if (!support) return null;
  const anchor = { x: position.x, y: support.y, z: position.z };
  return canOccupyBody(anchor, radius, height, world) ? anchor : null;
}

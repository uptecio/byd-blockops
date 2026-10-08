// Feet positions and solid heights use world units. Ground is the implicit Y=0 plane.
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
  return { mapId: map.id, bounds, solids, maxFeetY: Math.max(0, ...solids.map(solid => solid.maxY)) + 4 };
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

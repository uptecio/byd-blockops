import { canOccupy, hasLineOfSight } from './collision.js';

const STEP = .5;
const MAX_FIELDS = 32;
const validPoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.z);

export function createNavigation(map, { radius = .42 } = {}) {
  const { min, max } = map.bounds;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min || !Number.isFinite(radius) || radius <= 0) {
    throw new Error('Navigation requires finite bounds and a positive radius.');
  }
  const clearance = Math.ceil(radius / STEP) * STEP;
  const origin = min + clearance;
  const size = Math.floor((max - clearance - origin) / STEP) + 1;
  if (size <= 0) throw new Error('Navigation radius does not fit within map bounds.');
  const count = size * size;
  const cover = map.solids.map(solid => ({
    solids: [solid],
    minX: solid.x - solid.w / 2, maxX: solid.x + solid.w / 2,
    minZ: solid.z - solid.d / 2, maxZ: solid.z + solid.d / 2,
  }));
  const inside = (point, clearance = radius) => validPoint(point) && point.x >= min + clearance && point.x <= max - clearance
    && point.z >= min + clearance && point.z <= max - clearance;
  function clear(from, to, segmentRadius = radius) {
    if (!canOccupy(from.x, from.z, segmentRadius, map.solids) || !canOccupy(to.x, to.z, segmentRadius, map.solids)) return false;
    const a = { x: from.x, z: from.z }, b = { x: to.x, z: to.z };
    const dx = b.x - a.x, dz = b.z - a.z, lengthSquared = dx * dx + dz * dz;
    if (lengthSquared === 0) return true;
    for (const box of cover) {
      if (Math.max(a.x, b.x) < box.minX - segmentRadius || Math.min(a.x, b.x) > box.maxX + segmentRadius
        || Math.max(a.z, b.z) < box.minZ - segmentRadius || Math.min(a.z, b.z) > box.maxZ + segmentRadius) continue;
      if (!hasLineOfSight(a, b, box.solids)) return false;
      // Without an intersection, closest separation is at an endpoint or a
      // box corner. Endpoints were checked above; test each corner's distance
      // to the segment so thin walls and rounded circle clearance both work.
      for (const x of [box.minX, box.maxX]) for (const z of [box.minZ, box.maxZ]) {
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lengthSquared));
        if ((x - a.x - t * dx) ** 2 + (z - a.z - t * dz) ** 2 < segmentRadius * segmentRadius - 1e-10) return false;
      }
    }
    return true;
  }
  const center = index => ({ x: origin + index % size * STEP, z: origin + Math.floor(index / size) * STEP });
  const open = new Uint8Array(count);
  const edges = new Uint8Array(count);
  const directions = [[-1, 1], [1, 2], [-size, 4], [size, 8]];
  const fields = new Map();

  for (let index = 0; index < count; index++) {
    const point = center(index);
    open[index] = Number(clear(point, point));
  }
  for (let index = 0; index < count; index++) {
    if (!open[index]) continue;
    for (const [next, bit, reverse] of [
      [index % size < size - 1 ? index + 1 : -1, 2, 1],
      [index + size < count ? index + size : -1, 8, 4],
    ]) {
      if (next >= 0 && open[next] && clear(center(index), center(next))) {
        edges[index] |= bit;
        edges[next] |= reverse;
      }
    }
  }

  function cellFor(point) {
    if (!inside(point) || !clear(point, point)) return -1;
    const x = Math.round((point.x - origin) / STEP), z = Math.round((point.z - origin) / STEP);
    let best = -1, distance = Infinity;
    // Only connect nearby centers over a clear segment; snapping never crosses
    // walls, and cannot turn an outside/blocked endpoint into a reachable goal.
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
      const index = nz * size + nx;
      if (!open[index]) continue;
      const candidate = center(index);
      const squared = (candidate.x - point.x) ** 2 + (candidate.z - point.z) ** 2;
      if (squared < distance && clear(point, candidate)) { best = index; distance = squared; }
    }
    return best;
  }

  function fieldFor(goal) {
    if (fields.has(goal)) {
      const field = fields.get(goal);
      fields.delete(goal);
      fields.set(goal, field);
      return field;
    }
    const field = new Int32Array(count).fill(-1);
    const queue = new Int32Array(count);
    let head = 0, tail = 1;
    queue[0] = goal; field[goal] = 0;
    while (head < tail) {
      const index = queue[head++];
      for (const [offset, bit] of directions) {
        if (!(edges[index] & bit)) continue;
        const next = index + offset;
        if (field[next] !== -1) continue;
        field[next] = field[index] + 1;
        queue[tail++] = next;
      }
    }
    if (fields.size === MAX_FIELDS) fields.delete(fields.keys().next().value);
    fields.set(goal, field);
    return field;
  }

  return {
    nextWaypoint(from, goal) {
      const start = cellFor(from), end = cellFor(goal);
      if (start < 0 || end < 0) return null;
      const field = fieldFor(end);
      if (field[start] < 0) return null;
      if (start === end && clear(from, goal)) return { x: goal.x, z: goal.z };
      const snapped = center(start);
      // Cardinal edges deliberately prohibit all diagonal corner cutting.
      for (const [offset, bit] of directions) {
        if (edges[start] & bit && field[start + offset] === field[start] - 1) {
          const next = center(start + offset);
          if (clear(from, next)) return next;
        }
      }
      if (Math.hypot(from.x - snapped.x, from.z - snapped.z) > 1e-8) return snapped;
      return null;
    },
    reachable(from, goal) {
      const start = cellFor(from), end = cellFor(goal);
      return start >= 0 && end >= 0 && fieldFor(end)[start] >= 0;
    },
    nextApproachWaypoint(from, goal, goalRadius) {
      // Smaller actors can stand closer to cover than this navigator's actor.
      // Keep strict routes strict; approach only a valid smaller footprint,
      // via one of nine nearby centers on the same clear side of the cover.
      if (!Number.isFinite(goalRadius) || goalRadius <= 0 || goalRadius > radius
        || !inside(goal, goalRadius) || !clear(goal, goal, goalRadius)) return null;
      if (cellFor(goal) >= 0) return this.nextWaypoint(from, goal);
      const x = Math.round((goal.x - origin) / STEP), z = Math.round((goal.z - origin) / STEP);
      const candidates = [];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= size || nz >= size || !open[nz * size + nx]) continue;
        const candidate = center(nz * size + nx);
        const distance = Math.hypot(candidate.x - goal.x, candidate.z - goal.z);
        if (distance <= .75 && clear(goal, candidate, goalRadius)) candidates.push({ point: candidate, distance });
      }
      candidates.sort((a, b) => a.distance - b.distance);
      for (const candidate of candidates) {
        if (this.reachable(from, candidate.point)) return this.nextWaypoint(from, candidate.point);
      }
      return null;
    },
    clearCache() { fields.clear(); },
  };
}

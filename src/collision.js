import { segmentClear } from './spatial.js';

// Legacy X/Z helpers remain available for ground-only callers during migration.
export function canOccupy(x, z, radius, solids) {
  for (const solid of solids) {
    const nearX = Math.max(solid.x - solid.w / 2, Math.min(x, solid.x + solid.w / 2));
    const nearZ = Math.max(solid.z - solid.d / 2, Math.min(z, solid.z + solid.d / 2));
    const dx = x - nearX;
    const dz = z - nearZ;
    if (dx * dx + dz * dz < radius * radius - 1e-10) return false;
  }
  return true;
}

export function moveCircle(position, dx, dz, radius, solids) {
  let { x, z } = position;
  // Small swept steps prevent crossing a wall even after a long frame stall.
  const stepLength = Math.max(0.01, Math.min(0.2, radius * 0.4));
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / stepLength));
  const sx = dx / steps;
  const sz = dz / steps;
  for (let step = 0; step < steps; step++) {
    if (canOccupy(x + sx, z, radius, solids)) x += sx;
    if (canOccupy(x, z + sz, radius, solids)) z += sz;
  }
  return { x, z };
}

export function hasLineOfSight(a, b, solids) {
  const hasHeight = a.y !== undefined || b.y !== undefined;
  if (hasHeight) return segmentClear({ ...a, y: a.y ?? 1.6 }, { ...b, y: b.y ?? 1.6 }, { solids });
  for (const solid of solids) {
    let enter = 0;
    let leave = 1;
    const axes = [
      [a.x, b.x, solid.x - solid.w / 2, solid.x + solid.w / 2],
      [a.z, b.z, solid.z - solid.d / 2, solid.z + solid.d / 2],
    ];
    let intersects = true;
    for (const [start, end, low, high] of axes) {
      const delta = end - start;
      if (Math.abs(delta) < 1e-10) {
        if (start < low || start > high) { intersects = false; break; }
      } else {
        const first = (low - start) / delta;
        const second = (high - start) / delta;
        enter = Math.max(enter, Math.min(first, second));
        leave = Math.min(leave, Math.max(first, second));
        if (enter > leave) { intersects = false; break; }
      }
    }
    if (intersects) return false;
  }
  return true;
}

import { createSpatialWorld } from '../../src/spatial.js';
import { moveCharacter } from '../../src/character-movement.js';

export function stackedFixture() {
  const world = createSpatialWorld({ id: 'stacked', bounds: { min: -10, max: 10 }, solids: [
    { id: 'roof', x: 0, z: 0, w: 6, d: 6, minY: 2.8, maxY: 3 },
    { id: 'step', x: -5, z: 0, w: 2, d: 3, height: .55 },
    { id: 'thin', x: 7, z: 0, w: .02, d: 8, height: 6 },
    { id: 'ceiling', x: 0, z: 6, w: 4, d: 2, minY: 2, maxY: 2.2 },
  ] });
  return { world, ground: { x: -8, y: 0, z: 0 }, roof: { x: 0, y: 3, z: 0 },
    underRoof: { x: 0, y: 0, z: 0 }, ceilingPoint: { x: 0, y: 0, z: 6 } };
}

export function advanceBody(body, intent, seconds, world, options = {}) {
  let left = seconds, first = true;
  while (left > 1e-9) {
    const dt = Math.min(left, 1 / 120);
    const result = moveCharacter(body, { ...intent, jump: first && !!intent.jump }, dt, { world, ...options });
    if (result.invalid) throw new Error('Invalid fixture movement');
    body = result.body; first = false; left -= dt;
  }
  return body;
}

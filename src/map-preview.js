import { getMap } from './maps.js';

export function drawMapPreview(canvas, mapId) {
  const map = getMap(mapId), context = canvas.getContext('2d');
  canvas.width = 220; canvas.height = 120;
  const extent = map.bounds.max - map.bounds.min, scale = 110 / extent;
  context.fillStyle = map.environment.sky; context.fillRect(0, 0, 220, 120);
  context.save(); context.translate(110, 60); context.scale(scale, scale);
  context.fillStyle = map.environment.ground; context.fillRect(map.bounds.min, map.bounds.min, extent, extent);
  for (const block of [...map.blocks].sort((a, b) => a.y + a.h / 2 - b.y - b.h / 2)) {
    if (block.y + block.h / 2 <= .1 || block.w > extent || block.d > extent) continue;
    context.fillStyle = '#14202b33'; context.fillRect(block.x - block.w / 2 + .5, block.z - block.d / 2 + .6, block.w, block.d);
    context.fillStyle = block.colour; context.fillRect(block.x - block.w / 2, block.z - block.d / 2, block.w, block.d);
  }
  for (const teamId of ['red', 'blue']) {
    const base = map.bases[teamId];
    context.fillStyle = '#ffffff'; context.fillRect(base.x - 1.3, base.z - 1.3, 2.6, 2.6);
    context.fillStyle = teamId === 'red' ? '#ff4141' : '#3185ff'; context.fillRect(base.x - .9, base.z - .9, 1.8, 1.8);
  }
  context.restore();
}

import { MAPS, getMap } from './maps.js';

const mapIds = new Set(MAPS.map(map => map.id));
const backgrounds = new Map();
const PADDING = 12;

export function teammateMapState({ mapId, modeId, selfId, actors } = {}) {
  const result = { mapId, visible: false, markers: [] };
  if (!mapIds.has(mapId) || !['tdm', 'ctf'].includes(modeId) || !Array.isArray(actors)
    || typeof selfId !== 'string' || !selfId) return result;
  const self = actors.find(actor => actor && actor.id === selfId);
  if (!self || !['red', 'blue'].includes(self.teamId)) return result;
  result.visible = true;
  const seen = new Set();
  for (const actor of actors) {
    if (!actor || actor.teamId !== self.teamId || actor.alive !== true
      || typeof actor.id !== 'string' || !actor.id || seen.has(actor.id)
      || ![actor.x, actor.z, actor.yaw].every(Number.isFinite)) continue;
    seen.add(actor.id);
    result.markers.push({
      id: actor.id, name: typeof actor.name === 'string' ? actor.name : actor.id,
      x: actor.x, z: actor.z, yaw: actor.yaw, kind: actor.id === selfId ? 'self' : 'teammate',
    });
  }
  return result;
}

export function projectTeammateMapPosition(mapId, x, z, width, height = width, padding = PADDING) {
  const { min, max } = getMap(mapId).bounds;
  const side = Math.min(width, height) - padding * 2;
  return {
    x: (width - side) / 2 + (x - min) / (max - min) * side,
    y: (height - side) / 2 + (z - min) / (max - min) * side,
  };
}

export function teammateMapHeading(yaw) {
  return { x: -Math.sin(yaw), y: -Math.cos(yaw) };
}

function backgroundFor(canvas, mapId) {
  const key = `${mapId}:${canvas.width}:${canvas.height}`;
  if (backgrounds.has(key)) return backgrounds.get(key);
  const background = canvas.ownerDocument.createElement('canvas');
  background.width = canvas.width;
  background.height = canvas.height;
  const context = background.getContext('2d');
  const map = getMap(mapId);
  const side = Math.min(canvas.width, canvas.height) - PADDING * 2;
  const left = (canvas.width - side) / 2;
  const top = (canvas.height - side) / 2;
  context.fillStyle = '#15212b';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.beginPath();
  context.rect(left, top, side, side);
  context.clip();
  context.fillStyle = map.environment.ground;
  context.fillRect(left, top, side, side);
  // Draw the uppermost footprint last, matching a fixed overhead view.
  for (const block of [...map.blocks].sort((a, b) => a.y + a.h / 2 - b.y - b.h / 2)) {
    const corner = projectTeammateMapPosition(mapId, block.x - block.w / 2, block.z - block.d / 2, canvas.width, canvas.height);
    const scale = side / (map.bounds.max - map.bounds.min);
    context.fillStyle = block.colour;
    context.fillRect(corner.x, corner.y, block.w * scale, block.d * scale);
  }
  context.fillStyle = 'rgba(10, 19, 27, 0.35)';
  context.fillRect(left, top, side, side);
  context.restore();
  context.strokeStyle = '#82949f';
  context.lineWidth = 1;
  context.strokeRect(left + .5, top + .5, side - 1, side - 1);
  if (backgrounds.size >= MAPS.length) backgrounds.delete(backgrounds.keys().next().value);
  backgrounds.set(key, background);
  return background;
}

function drawName(context, marker, point, canvas, labels, scale) {
  let name = marker.name.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 80);
  if (!name) return;
  const maxWidth = Math.min(150 * scale, canvas.width - 24 * scale);
  while (name.length > 1 && context.measureText(name).width > maxWidth - 12 * scale) name = name.slice(0, -2) + '…';
  const width = context.measureText(name).width + 10 * scale;
  const height = 20 * scale;
  const gap = 3 * scale;
  const candidates = [[point.x + 17 * scale, point.y - height / 2], [point.x - width - 17 * scale, point.y - height / 2],
    [point.x - width / 2, point.y - 36 * scale], [point.x - width / 2, point.y + 17 * scale]];
  // Nearby actors can exhaust the four nearest placements. Search a bounded
  // set of further rows, retaining enough room between readable name labels.
  const rowStep = height + gap;
  for (let row = 1; row <= Math.ceil(canvas.height / rowStep); row++) {
    for (const direction of [-1, 1]) {
      const y = point.y - height / 2 + direction * row * rowStep;
      for (const x of [point.x + 17 * scale, point.x - width - 17 * scale, point.x - width / 2]) candidates.push([x, y]);
    }
  }
  for (const [index, [x, y]] of candidates.entries()) {
    const rect = { x: Math.max(gap, Math.min(canvas.width - width - gap, x)), y: Math.max(gap, Math.min(canvas.height - height - gap, y)), width, height };
    if (labels.some(label => rect.x < label.x + label.width + gap && rect.x + width + gap > label.x
      && rect.y < label.y + label.height + gap && rect.y + height + gap > label.y)) continue;
    labels.push(rect);
    if (index >= 4) {
      context.beginPath();
      context.moveTo(point.x, point.y);
      context.lineTo(Math.max(rect.x, Math.min(rect.x + width, point.x)), Math.max(rect.y, Math.min(rect.y + height, point.y)));
      context.strokeStyle = '#b9d8e8';
      context.lineWidth = scale;
      context.stroke();
    }
    context.fillStyle = 'rgba(10, 19, 27, 0.9)';
    context.fillRect(rect.x, rect.y, width, height);
    context.fillStyle = '#ffffff';
    context.fillText(name, rect.x + 5 * scale, rect.y + height / 2);
    return;
  }
}

export function drawTeammateMap(canvas, state, { names = false } = {}) {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (!state?.visible || !mapIds.has(state.mapId)) return;
  context.drawImage(backgroundFor(canvas, state.mapId), 0, 0);
  const scale = Math.max(canvas.width / (canvas.clientWidth || canvas.width), canvas.height / (canvas.clientHeight || canvas.height));
  const markers = state.markers.map(marker => ({ marker, point: projectTeammateMapPosition(state.mapId, marker.x, marker.z, canvas.width, canvas.height) }));
  const radius = (names ? 7 : 4) * scale;
  const edge = (names ? 15 : 11) * scale;
  for (const { marker, point } of markers) {
    point.x = Math.max(edge, Math.min(canvas.width - edge, point.x));
    point.y = Math.max(edge, Math.min(canvas.height - edge, point.y));
  }
  if (names) {
    context.font = `600 ${13 * scale}px system-ui, sans-serif`;
    context.textBaseline = 'middle';
    const labels = markers.map(({ point }) => ({ x: point.x - 13 * scale, y: point.y - 13 * scale, width: 26 * scale, height: 26 * scale }));
    for (const { marker, point } of markers) drawName(context, marker, point, canvas, labels, scale);
  }
  // Keep the local facing arrow visible even when friendly positions overlap.
  for (const { marker, point } of [...markers].sort((a, b) => (a.marker.kind === 'self') - (b.marker.kind === 'self'))) {
    context.fillStyle = marker.kind === 'self' ? '#ffe45c' : '#55b8ff';
    context.strokeStyle = '#101b25';
    context.lineWidth = 2 * scale;
    context.beginPath();
    if (marker.kind === 'self') {
      const heading = teammateMapHeading(marker.yaw);
      const length = (names ? 12 : 8) * scale;
      context.moveTo(point.x + heading.x * length, point.y + heading.y * length);
      context.lineTo(point.x - heading.x * length * .65 - heading.y * length * .6, point.y - heading.y * length * .65 + heading.x * length * .6);
      context.lineTo(point.x - heading.x * length * .3, point.y - heading.y * length * .3);
      context.lineTo(point.x - heading.x * length * .65 + heading.y * length * .6, point.y - heading.y * length * .65 - heading.x * length * .6);
      context.closePath();
    } else context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
}

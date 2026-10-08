import { validProgressionId } from './progression-protocol.js';
import { createSpatialWorld } from './spatial.js';
import { PROTOCOL_VERSION } from './protocol.js';

const worlds = new WeakMap();
export function protocolWorld(map) {
  if (!worlds.has(map)) worlds.set(map, createSpatialWorld(map));
  return worlds.get(map);
}
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value))
  && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
const count = n => Number.isSafeInteger(n) && n >= 0;
const spotExists = (map, id) => typeof id === 'string' && map.hideSpots.some(spot => spot.id === id);
const identity = p => count(p.seq) && p.seq > 0 && count(p.lifeId) && validProgressionId(p.roundId);

export function validHideAction(packet, map) {
  return !!(exact(packet, ['type', 'seq', 'roundId', 'lifeId', 'kind', 'spotId']) && packet.type === 'hide-action' && identity(packet)
    && ['enter', 'exit'].includes(packet.kind) && spotExists(map, packet.spotId));
}
export function validHideResult(packet, map) {
  return !!(exact(packet, ['type', 'protocol', 'seq', 'roundId', 'lifeId', 'ok', 'reason', 'hiddenSpotId'])
    && packet.type === 'hide-result' && packet.protocol === PROTOCOL_VERSION && identity(packet) && typeof packet.ok === 'boolean'
    && (packet.ok ? packet.reason === null : typeof packet.reason === 'string' && packet.reason.length > 0 && packet.reason.length <= 160)
    && (packet.hiddenSpotId === null || spotExists(map, packet.hiddenSpotId)));
}
export function validPlayerSpatial(player, map) {
  const world = protocolWorld(map);
  if (![player.x, player.y, player.z].every(Number.isFinite) || player.y < 0 || player.y > world.maxFeetY
    || player.x < world.bounds.min || player.x > world.bounds.max || player.z < world.bounds.min || player.z > world.bounds.max
    || typeof player.grounded !== 'boolean') return false;
  if (player.grounded) {
    const height = player.supportId === 'ground' ? 0 : world.solids.find(s => s.id === player.supportId)?.maxY;
    if (height === undefined || Math.abs(player.y - height) > 1e-6) return false;
  } else if (player.supportId !== null) return false;
  if (player.hiddenSpotId !== null) {
    const spot = map.hideSpots.find(s => s.id === player.hiddenSpotId);
    if (!spot || !player.grounded || player.health <= 0 || player.respawnRemaining > 0
      || Math.hypot(player.x - spot.occupant.x, player.y - spot.occupant.y, player.z - spot.occupant.z) > 1e-6) return false;
  }
  return true;
}

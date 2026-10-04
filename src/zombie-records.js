import { MAPS } from './maps.js';

const key = 'block-ops-zombies-v1';
const validScore = value => value && !Array.isArray(value) && typeof value === 'object'
  && ['waves','kills'].every(field => Number.isSafeInteger(value[field]) && value[field] >= 0);
const copy = ({ waves,kills }) => ({ waves,kills });
function checkMap(id) {
  if (!MAPS.some(map => map.id === id)) throw new RangeError('Unknown record map');
}
export function createZombieRecords(storage) {
  const records = Object.create(null);
  try {
    const raw = JSON.parse(storage?.getItem(key) || '{}');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const map of MAPS) if (validScore(raw[map.id])) records[map.id] = copy(raw[map.id]);
    }
  } catch { /* Corrupt or disabled storage never prevents playing. */ }
  const best = mapId => { checkMap(mapId); return copy(records[mapId] || { waves:0,kills:0 }); };
  return {
    best,
    record(mapId, score) {
      checkMap(mapId);
      if (!validScore(score)) throw new RangeError('Invalid zombie record');
      const current = best(mapId);
      if (score.waves > current.waves || (score.waves === current.waves && score.kills > current.kills)) {
        records[mapId] = copy(score);
        try { storage?.setItem(key,JSON.stringify(records)); } catch { /* Keep the session's in-memory best. */ }
      }
      return best(mapId);
    },
  };
}

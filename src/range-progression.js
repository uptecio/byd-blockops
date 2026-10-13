import { MAX_XP, validXP } from './progression.js';
import { validReceiptKey } from './profile-store.js';
import { RANGE_TARGETS } from './range-map.js';

const FIELDS=['targetKills','precisionKills','earnedTotal'];
const REGIONS=['body','head','centre'];
const TARGET_IDS=new Set(RANGE_TARGETS.map(target=>target.id));
const weighted=tally=>Math.min(MAX_XP,10*tally.targetKills+10*tally.precisionKills);

export function emptyRangeTally() {
  return {targetKills:0,precisionKills:0,earnedTotal:0};
}

export function validateRangeTally(value) {
  if (!value || typeof value!=='object' || Array.isArray(value)) return false;
  if (Reflect.ownKeys(value).length!==FIELDS.length
    || !FIELDS.every(field=>Object.prototype.hasOwnProperty.call(value,field) && validXP(value[field]))) return false;
  return value.precisionKills<=value.targetKills && weighted(value)===value.earnedTotal;
}

export function awardRangeKill(tally,region) {
  if (!validateRangeTally(tally) || !REGIONS.includes(region)) throw new RangeError('Invalid range XP action');
  const next={targetKills:Math.min(MAX_XP,tally.targetKills+1),
    precisionKills:Math.min(MAX_XP,tally.precisionKills+(region==='body'?0:1)),earnedTotal:0};
  next.earnedTotal=weighted(next);
  return next;
}

export function createRangeProgression({runId,targetIds,onEvent=()=>{}}) {
  const key=JSON.stringify(['solo',runId]);
  if (!validReceiptKey(key) || !Array.isArray(targetIds) || targetIds.length!==TARGET_IDS.size
    || new Set(targetIds).size!==TARGET_IDS.size || ![...targetIds].every(id=>TARGET_IDS.has(id)))
    throw new RangeError('Invalid range progression session');
  let tally=emptyRangeTally(),closed=false;
  const lives=new Map();
  const emit=type=>onEvent({type,key,modeId:'range',tally:{...tally}});
  emit('start');
  return {
    kill({targetId,lifeId,region}) {
      if (closed || !TARGET_IDS.has(targetId) || !Number.isSafeInteger(lifeId) || lifeId<1
        || lifeId<=(lives.get(targetId)??0) || !REGIONS.includes(region)) return;
      tally=awardRangeKill(tally,region);lives.set(targetId,lifeId);emit('update');
    },
    snapshot() { return {...tally}; },
    close() { if (!closed) { closed=true;emit('stop'); } },
  };
}

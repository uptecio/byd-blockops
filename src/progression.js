// Cosmetic progression only. No renderer, persistence or networking dependencies.
export const MAX_XP = 2147483647;
export const FREE_SKIN_IDS = Object.freeze(['ranger', 'desert-ops', 'arctic-scout', 'jungle-scout',
  'neon-runner', 'shadow-ninja', 'robo-unit', 'space-guard']);
export const REWARDS = Object.freeze([
  ['skin','crimson-ninja','Crimson Ninja'], ['finish','crimson-red','Crimson Red'],
  ['skin','midnight-ops','Midnight Ops'], ['finish','ice-blue','Ice Blue'],
  ['skin','frost-unit','Frost Unit'], ['finish','forest-camo','Forest Camo'],
  ['skin','solar-guard','Solar Guard'], ['finish','violet','Violet'],
  ['skin','golden-ninja','Golden Ninja'], ['finish','orange','Orange'],
  ['skin','urban-ranger','Urban Ranger'], ['finish','arctic-white','Arctic White'],
  ['skin','lava-unit','Lava Unit'], ['finish','stealth-black','Stealth Black'],
  ['skin','void-guard','Void Guard'], ['finish','gold','Gold'],
].map(([kind,id,name],i) => Object.freeze({level:i+2,kind,id,name})));

export const validXP = value => Number.isInteger(value) && value >= 0 && value <= MAX_XP;
const requireXP = value => { if (!validXP(value)) throw new RangeError('Invalid XP'); };
export function rankForXP(xp) {
  requireXP(xp);
  let level = 1, intoLevel = xp;
  while (level < 17) {
    const levelCost = 150 + 50 * (level - 1);
    if (intoLevel < levelCost) return {level,intoLevel,levelCost,nextReward:REWARDS[level-1]};
    intoLevel -= levelCost; level++;
  }
  return {level:17,intoLevel:0,levelCost:0,nextReward:null};
}
export function ownsCosmetic(xp, kind, id) {
  requireXP(xp);
  if (kind === 'skin' && FREE_SKIN_IDS.includes(id)) return true;
  if (kind === 'finish' && id === 'standard') return true;
  const reward = REWARDS.find(r => r.kind === kind && r.id === id);
  return Boolean(reward && rankForXP(xp).level >= reward.level);
}
export function rewardsBetween(beforeXP, afterXP) {
  const before = rankForXP(beforeXP).level, after = rankForXP(afterXP).level;
  return REWARDS.filter(r => r.level > before && r.level <= after);
}

const RATES = Object.freeze({eliminations:10,zombieKills:2,flagCaptures:50,flagReturns:10,wavesCleared:25});
const COUNTS = Object.keys(RATES);
const FIELDS = [...COUNTS, 'completed', 'won', 'earnedTotal'];
const MODES = ['ffa','tdm','ctf','zombies'];
const allowed = (mode, action) => mode === 'zombies' ? ['zombieKills','wavesCleared'].includes(action)
  : action === 'eliminations' || mode === 'ctf' && ['flagCaptures','flagReturns'].includes(action);
const weighted = t => Math.min(MAX_XP, COUNTS.reduce((sum,k) => sum + t[k]*RATES[k], 0) + (t.completed?50:0) + (t.won?25:0));
const eligible = (t, mode) => mode === 'zombies' ? t.wavesCleared > 0 : t.eliminations+t.flagCaptures+t.flagReturns > 0;

export function emptyTally() {
  return {eliminations:0,zombieKills:0,flagCaptures:0,flagReturns:0,wavesCleared:0,completed:false,won:false,earnedTotal:0};
}
export function validateTally(value, modeId) {
  if (!MODES.includes(modeId) || !value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== FIELDS.length || !FIELDS.every(k => Object.prototype.hasOwnProperty.call(value,k))) return false;
  if (!COUNTS.every(k => validXP(value[k]) && (allowed(modeId,k) || value[k] === 0))) return false;
  if (typeof value.completed !== 'boolean' || typeof value.won !== 'boolean' || !validXP(value.earnedTotal)) return false;
  if (value.completed && !eligible(value,modeId) || value.won && (!value.completed || modeId === 'zombies')) return false;
  return weighted(value) === value.earnedTotal;
}
export function awardTally(tally, modeId, action, count = 1) {
  if (!validateTally(tally,modeId) || !COUNTS.includes(action) || !allowed(modeId,action) || !validXP(count) || count === 0)
    throw new RangeError('Invalid XP action');
  if (tally.completed) return {...tally};
  const next = {...tally, [action]:Math.min(MAX_XP,tally[action]+count)};
  next.earnedTotal = weighted(next); return next;
}
export function finishTally(tally, {modeId,naturalEnd,won}) {
  if (!validateTally(tally,modeId) || typeof naturalEnd !== 'boolean' || typeof won !== 'boolean') throw new RangeError('Invalid XP finish');
  if (tally.completed || !naturalEnd || !eligible(tally,modeId)) return {...tally};
  const next = {...tally,completed:true,won:modeId !== 'zombies' && won};
  next.earnedTotal = weighted(next); return next;
}

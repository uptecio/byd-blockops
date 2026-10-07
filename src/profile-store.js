import { MAX_XP, validXP, FREE_SKIN_IDS, ownsCosmetic, rankForXP, rewardsBetween } from './progression.js';

export const PROFILE_KEY = 'block-ops-progression-v1';
export const PROFILE_BACKUP_KEY = PROFILE_KEY + '-backup';
const fields = ['schemaVersion','lifetimeXP','skinId','finishId','receipts'];
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const exact = (o,keys) => o && typeof o === 'object' && !Array.isArray(o)
  && Reflect.ownKeys(o).length === keys.length && keys.every(k=>own(o,k));
const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(id);

export function validReceiptKey(key) {
  if (typeof key !== 'string' || key.length > 1024) return false;
  try {
    const parts = JSON.parse(key);
    if (!Array.isArray(parts) || JSON.stringify(parts) !== key) return false;
    if (parts.length === 2 && parts[0] === 'solo') return validId(parts[1]);
    if (parts.length !== 4 || parts[0] !== 'online' || !validId(parts[2]) || !validId(parts[3])
      || typeof parts[1] !== 'string' || parts[1].length > 512) return false;
    const url = new URL(parts[1]);
    return url.origin === parts[1] && (url.protocol === 'https:'
      || url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname));
  } catch { return false; }
}

function decode(raw) {
  if (raw === null) return {kind:'missing'};
  if (typeof raw !== 'string' || raw.length > 131072) return {kind:'invalid'};
  let value; try { value=JSON.parse(raw); } catch { return {kind:'invalid'}; }
  if (value && Number.isInteger(value.schemaVersion) && value.schemaVersion > 1) return {kind:'future'};
  if (!exact(value,fields) || value.schemaVersion !== 1 || !validXP(value.lifetimeXP)
    || !Array.isArray(value.receipts) || value.receipts.length > 64) return {kind:'invalid'};
  const seen=new Set();
  for (const receipt of value.receipts) {
    if (!exact(receipt,['key','total']) || !validReceiptKey(receipt.key) || !validXP(receipt.total) || seen.has(receipt.key)) return {kind:'invalid'};
    seen.add(receipt.key);
  }
  if (!ownsCosmetic(value.lifetimeXP,'skin',value.skinId)) value.skinId='ranger';
  if (!ownsCosmetic(value.lifetimeXP,'finish',value.finishId)) value.finishId='standard';
  return {kind:'valid',value};
}

export function createProfileStore({getStorage = () => localStorage, legacySkinId='ranger'} = {}) {
  const fresh=()=>({schemaVersion:1,lifetimeXP:0,skinId:FREE_SKIN_IDS.includes(legacySkinId)?legacySkinId:'ranger',finishId:'standard',receipts:[]});
  let profile=fresh(), storage, knownBase=false, protectedReason='', recovered=false, dirty=false;
  let confirmed=null, saveStatus='unavailable', saveMessage='Progress is not saved — storage unavailable';
  const changedAppearance=new Set();
  function unavailable() { saveStatus='unavailable'; saveMessage='Progress is not saved — storage unavailable'; }
  function status() {
    if (protectedReason) { saveStatus='temporary'; saveMessage=protectedReason; }
    else if (dirty || !knownBase) unavailable();
    else { saveStatus=recovered?'recovered':'saved'; saveMessage=recovered?'Recovered previous save':''; }
  }
  function readBase() {
    storage=getStorage();
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') throw Error('Storage unavailable');
    const primary=decode(storage.getItem(PROFILE_KEY));
    if (primary.kind === 'valid') return {value:primary.value,confirmed:JSON.stringify(primary.value)};
    const backup=decode(storage.getItem(PROFILE_BACKUP_KEY));
    const future=primary.kind === 'future' || backup.kind === 'future';
    const reason=future?'Progress is temporary — a newer save version is preserved':
      primary.kind === 'missing' && backup.kind === 'missing' || backup.kind === 'valid' ? '' : 'Progress is temporary — unreadable save preserved';
    return {value:backup.kind === 'valid'?backup.value:fresh(),confirmed:backup.kind === 'valid'?JSON.stringify(backup.value):null,
      recovered:backup.kind === 'valid',reason,missing:primary.kind === 'missing' && backup.kind === 'missing'};
  }
  function establishBase(merge) {
    const base=readBase();
    if (merge && (base.reason || profile.receipts.some(r=>base.value.receipts.some(old=>old.key===r.key)))) {
      protectedReason=base.reason || 'Progress is temporary — conflicting save preserved';
      knownBase=true; status(); return;
    }
    if (merge) {
      const pending=profile;
      profile={...base.value,lifetimeXP:Math.min(MAX_XP,base.value.lifetimeXP+pending.lifetimeXP),
        receipts:[...base.value.receipts,...pending.receipts].slice(-64)};
      for (const field of changedAppearance) profile[field]=pending[field];
    } else profile=base.value;
    confirmed=base.confirmed; recovered=Boolean(base.recovered); protectedReason=base.reason||'';
    knownBase=true; dirty=merge || Boolean(base.missing); status();
  }
  function retrySave() {
    if (protectedReason) return false;
    try {
      if (!knownBase) establishBase(true);
      if (protectedReason) return false;
      if (!dirty) return true;
      storage=getStorage();
      // Backup failure must not turn a successful primary save into lost progress.
      if (confirmed) {
        try {
          if (decode(storage.getItem(PROFILE_BACKUP_KEY)).kind !== 'future') storage.setItem(PROFILE_BACKUP_KEY,confirmed);
        } catch { /* Unknown/unwritable backup is preserved; primary can still save. */ }
      }
      const serialized=JSON.stringify(profile);
      storage.setItem(PROFILE_KEY,serialized);
      confirmed=serialized; dirty=false; status(); return true;
    } catch { unavailable(); return false; }
  }
  try { establishBase(false); if (dirty && !protectedReason) retrySave(); } catch { unavailable(); }
  return {
    view() { return {lifetimeXP:profile.lifetimeXP,skinId:profile.skinId,finishId:profile.finishId,
      rank:rankForXP(profile.lifetimeXP),saveStatus,saveMessage}; },
    credit(key,earnedTotal) {
      if (!validReceiptKey(key) || !validXP(earnedTotal)) throw new RangeError('Invalid XP receipt');
      const previous=profile.receipts.find(r=>r.key===key);
      const increase=Math.max(0,earnedTotal-(previous?.total??0));
      const before=profile.lifetimeXP;
      if (!previous || increase>0) {
        profile.lifetimeXP=Math.min(MAX_XP,before+increase);
        profile.receipts=profile.receipts.filter(r=>r.key!==key);
        profile.receipts.push({key,total:earnedTotal}); profile.receipts=profile.receipts.slice(-64); dirty=true;
      }
      const creditedXP=profile.lifetimeXP-before, newRewards=rewardsBetween(before,profile.lifetimeXP);
      return {creditedXP,newRewards,saved:retrySave()};
    },
    equip(patch) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)
        || !Reflect.ownKeys(patch).length || !Reflect.ownKeys(patch).every(k=>k==='skinId'||k==='finishId'))
        return {ok:false,saved:false,reason:'Invalid appearance'};
      for (const [field,kind] of [['skinId','skin'],['finishId','finish']])
        if (own(patch,field) && !ownsCosmetic(profile.lifetimeXP,kind,patch[field])) return {ok:false,saved:false,reason:'Reach the required level to unlock this look'};
      for (const field of Object.keys(patch)) if (profile[field] !== patch[field]) {
        profile[field]=patch[field]; changedAppearance.add(field); dirty=true;
      }
      return {ok:true,saved:retrySave()};
    },
    retrySave,
  };
}

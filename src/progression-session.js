import { emptyTally, validateTally } from './progression.js';
import { validReceiptKey } from './profile-store.js';
import { emptyRangeTally, validateRangeTally } from './range-progression.js';

const validSessionTally=(tally,modeId)=>modeId==='range'?validateRangeTally(tally):validateTally(tally,modeId);

// Only trusted lifecycle code may begin a participation. Rendering cannot award.
export function createProgressionSession(store) {
  let active=null, summary=null;
  const zero=()=>({creditedXP:0,newRewards:[],saved:['saved','recovered'].includes(store.view().saveStatus)});
  return {
    begin(key,modeId) {
      const tally=modeId==='range'?emptyRangeTally():emptyTally();
      if (!validReceiptKey(key) || modeId==='range' && JSON.parse(key)[0]!=='solo'
        || !validSessionTally(tally,modeId)) throw new RangeError('Invalid progression session');
      if (active === key) return;
      active=key; summary={key,modeId,tally,creditedXP:0,newRewards:[]};
    },
    accept(key,tally) {
      if (key !== active || !summary || !validSessionTally(tally,summary.modeId)) return zero();
      if (Object.keys(tally).some(k=>Number(tally[k]) < Number(summary.tally[k]))) {
        store.retrySave(); return zero();
      }
      const delta=store.credit(key,tally.earnedTotal);
      summary.tally={...tally}; summary.creditedXP+=delta.creditedXP; summary.newRewards.push(...delta.newRewards);
      return delta;
    },
    end(key) { if (key === active) active=null; },
    summary() { return summary?{...summary,tally:{...summary.tally},newRewards:[...summary.newRewards]}:null; },
  };
}

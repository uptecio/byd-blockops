import { emptyTally, awardTally, finishTally, validateTally, validXP } from './progression.js';
import { validReceiptKey } from './profile-store.js';

export function newSoloRunId() {
  const bytes=new Uint8Array(16); crypto.getRandomValues(bytes);
  return Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
}
export function createSoloProgression({runId,modeId,onEvent=()=>{}}) {
  const key=JSON.stringify(['solo',runId]);
  if (!validReceiptKey(key) || !validateTally(emptyTally(),modeId)) throw new RangeError('Invalid solo progression session');
  let tally=emptyTally(),closed=false;
  const lives=new Map(), objectives=new WeakSet();
  const emit=type=>onEvent({type,key,modeId,tally:{...tally}});
  const add=(action,count=1)=>{if(count>0){tally=awardTally(tally,modeId,action,count);emit('update');}};
  function close() { if(!closed){closed=true;emit('stop');} }
  function finish({winnerId=null,winnerTeamId=null,teamId=null}={}) {
    if(closed)return;
    tally=finishTally(tally,{modeId,naturalEnd:true,won:modeId==='ffa'?winnerId==='local':teamId!==null&&winnerTeamId===teamId});
    emit('update');close();
  }
  emit('start');
  return {
    elimination({killerId,victimId,victimLifeId,enemy}) {
      if(closed || modeId==='zombies' || killerId!=='local' || victimId==='local' || !enemy
        || typeof victimId!=='string' || !Number.isSafeInteger(victimLifeId) || victimLifeId<1
        || victimLifeId<=(lives.get(victimId)??0))return;
      lives.set(victimId,victimLifeId);add('eliminations');
    },
    objectives(events) {
      if(closed || modeId!=='ctf')return;
      for(const event of events) {
        if(!event || typeof event!=='object' || objectives.has(event))continue;
        objectives.add(event);
        if(event.playerId!=='local')continue;
        if(event.type==='flag-capture')add('flagCaptures');
        else if(event.type==='flag-return')add('flagReturns');
      }
    },
    survival({kills,wavesCleared,ended}) {
      if(closed || modeId!=='zombies' || !validXP(kills) || !validXP(wavesCleared) || typeof ended!=='boolean')return;
      add('zombieKills',Math.max(0,kills-tally.zombieKills));
      add('wavesCleared',Math.max(0,wavesCleared-tally.wavesCleared));
      if(ended)finish();
    },
    finish,close,
  };
}

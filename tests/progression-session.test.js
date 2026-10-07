import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyTally, awardTally, finishTally } from '../src/progression.js';
const mod=await import('../src/progression-session.js').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
const profiles=await import('../src/profile-store.js').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
const key=id=>JSON.stringify(['solo',id]);
function fixture(){
  assert.equal(typeof mod.createProgressionSession,'function'); const data=new Map();
  const store=profiles.createProfileStore({getStorage:()=>({getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)})});
  return {store,session:mod.createProgressionSession(store)};
}
test('only the active trusted session can earn and repeated/lower results are read-only',()=>{
  const {store,session}=fixture(),tally=awardTally(emptyTally(),'ffa','eliminations',15);
  assert.equal(session.accept(key('r'),tally).creditedXP,0);
  session.begin(key('r'),'ffa'); assert.equal(session.accept(key('r'),tally).creditedXP,150);
  session.begin(key('r'),'ffa'); assert.equal(session.accept(key('r'),tally).newRewards.length,0);
  session.accept(key('r'),emptyTally()); assert.equal(session.summary().tally.earnedTotal,150);
  const ended=finishTally(tally,{modeId:'ffa',naturalEnd:true,won:true});
  assert.equal(session.accept(key('r'),ended).creditedXP,75);
  assert.equal(session.summary().creditedXP,225); const snapshot=session.summary(); snapshot.tally.earnedTotal=999;
  assert.equal(session.summary().tally.earnedTotal,225); assert.equal(session.summary().newRewards.length,1);
  session.end(key('wrong')); assert.equal(session.accept(key('r'),ended).creditedXP,0);
  session.end(key('r')); assert.equal(session.accept(key('r'),awardTally(emptyTally(),'ffa','eliminations',30)).creditedXP,0);
  assert.equal(store.view().lifetimeXP,225); assert.equal(session.summary().creditedXP,225);
});
test('evicted stale session stays inactive and rematches earn only their own tally',()=>{
  const {store,session}=fixture(),tally=awardTally(emptyTally(),'ffa','eliminations');
  session.begin(key('old'),'ffa'); session.accept(key('old'),tally); session.end(key('old'));
  for(let i=0;i<65;i++){session.begin(key('r'+i),'ffa');session.accept(key('r'+i),tally);}
  assert.equal(store.view().lifetimeXP,660);
  assert.equal(session.accept(key('old'),awardTally(tally,'ffa','eliminations',20)).creditedXP,0);
  session.begin(key('rematch'),'ffa'); assert.equal(session.summary().creditedXP,0);
  assert.equal(session.accept(key('rematch'),tally).creditedXP,10); assert.equal(store.view().lifetimeXP,670);
});
test('mode incompatibility, forged totals and invalid session keys cannot enter profile',()=>{
  const {store,session}=fixture();
  assert.throws(()=>session.begin('bad','ffa'),RangeError); assert.throws(()=>session.begin(key('r'),'invalid'),RangeError);
  session.begin(key('r'),'ffa');
  for(const tally of [null,{...emptyTally(),earnedTotal:100},awardTally(emptyTally(),'ctf','flagCaptures')])
    assert.equal(session.accept(key('r'),tally).creditedXP,0);
  assert.equal(store.view().lifetimeXP,0);
});

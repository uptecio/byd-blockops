import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_XP, emptyTally, validateTally, ownsCosmetic } from '../src/progression.js';
import { createProfileStore, PROFILE_KEY, PROFILE_BACKUP_KEY } from '../src/profile-store.js';
import { createProgressionSession } from '../src/progression-session.js';
import { createProgressionController } from '../src/progression-controller.js';
import { validProgressionReceipt } from '../src/progression-protocol.js';
const range=await import('../src/range-progression.js').catch(error=>{
  if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;
  return {};
});
const targetIds=['close-dummy','close-bullseye','medium-dummy','medium-bullseye','far-dummy','far-bullseye'];
const key=id=>JSON.stringify(['solo',id]);
const record=(lifetimeXP=0,patch={})=>({schemaVersion:1,lifetimeXP,skinId:'ranger',finishId:'standard',receipts:[],...patch});
function requireRange() {
  for(const name of ['emptyRangeTally','validateRangeTally','awardRangeKill','createRangeProgression'])
    assert.equal(typeof range[name],'function',`${name} must be implemented`);
}
function fixture(entries=[]) {
  const data=new Map(entries),views=[],deltas=[];
  const storage={readDenied:false,writeDenied:false,
    getItem(k){if(this.readDenied)throw Error('read denied');return data.get(k)??null;},
    setItem(k,v){if(this.writeDenied)throw Error('write denied');data.set(k,v);}};
  let getterDenied=false;
  const open=()=>createProfileStore({getStorage:()=>{if(getterDenied)throw Error('storage denied');return storage;}});
  const connect=()=>{
    const store=open(),session=createProgressionSession(store);
    const controller=createProgressionController({store,session,onChange:view=>views.push(view),onDelta:delta=>deltas.push(delta)});
    return {store,session,controller};
  };
  const producer=(controller,runId)=>{
    requireRange();return range.createRangeProgression({runId,targetIds,onEvent:event=>controller.solo(event)});
  };
  return {data,storage,views,deltas,open,connect,producer,denyGetter(value){getterDenied=value;}};
}

// Catches awarding precision as a bonus on top of 20 or mutating the caller's tally.
test('range killing hits earn 10 for body and 20 total for either precision region',()=>{
  requireRange();const empty=range.emptyRangeTally(),body=range.awardRangeKill(empty,'body');
  assert.deepEqual(empty,{targetKills:0,precisionKills:0,earnedTotal:0});
  assert.deepEqual(body,{targetKills:1,precisionKills:0,earnedTotal:10});
  assert.deepEqual(range.awardRangeKill(body,'head'),{targetKills:2,precisionKills:1,earnedTotal:30});
  assert.deepEqual(range.awardRangeKill(body,'centre'),{targetKills:2,precisionKills:1,earnedTotal:30});
  assert.throws(()=>range.awardRangeKill(body,'arm'),RangeError);
  assert.deepEqual(body,{targetKills:1,precisionKills:0,earnedTotal:10});
});

test('range tallies reject forged totals, unknown fields, symbol fields and malformed counts',()=>{
  requireRange();const valid={targetKills:1,precisionKills:0,earnedTotal:10};
  assert.equal(range.validateRangeTally(valid),true);
  for(const invalid of [null,[],{}, {...valid,earnedTotal:20}, {...valid,completed:false},
    {...valid,[Symbol('bonus')]:0}, {...valid,precisionKills:2,earnedTotal:30},
    {...valid,targetKills:-1}, {...valid,targetKills:1.1}, {...valid,targetKills:'1'},
    {...valid,targetKills:Infinity}, {...valid,targetKills:MAX_XP+1}, {...valid,earnedTotal:NaN}]) {
    assert.equal(range.validateRangeTally(invalid),false);
    assert.throws(()=>range.awardRangeKill(invalid,'body'),RangeError);
  }
});

test('range XP and count saturation remain valid and never wrap or earn completion bonuses',()=>{
  requireRange();const tally={targetKills:214748364,precisionKills:0,earnedTotal:2147483640};
  const capped=range.awardRangeKill(tally,'body');
  assert.deepEqual(capped,{targetKills:214748365,precisionKills:0,earnedTotal:MAX_XP});
  assert.equal(range.validateRangeTally(capped),true);
  const full={targetKills:MAX_XP,precisionKills:MAX_XP,earnedTotal:MAX_XP};
  assert.deepEqual(range.awardRangeKill(full,'head'),full);
  assert.equal(range.validateRangeTally({...full,earnedTotal:MAX_XP-1}),false);
});

test('adapter starts first, rejects unknown and duplicate lives, and emits detached cumulative tallies',()=>{
  requireRange();const events=[],ids=[...targetIds];
  const adapter=range.createRangeProgression({runId:'visit',targetIds:ids,onEvent:event=>events.push(event)});
  ids.push('forged-target');
  assert.deepEqual(events,[{type:'start',key:key('visit'),modeId:'range',tally:{targetKills:0,precisionKills:0,earnedTotal:0}}]);
  for(const lifeId of [0,-1,1.5,'1',NaN,Infinity,Number.MAX_SAFE_INTEGER+1])
    adapter.kill({targetId:'close-dummy',lifeId,region:'body'});
  adapter.kill({targetId:'forged-target',lifeId:1,region:'body'});
  assert.equal(events.length,1);
  adapter.kill({targetId:'close-dummy',lifeId:3,region:'body'});
  adapter.kill({targetId:'close-dummy',lifeId:3,region:'head'});
  adapter.kill({targetId:'close-dummy',lifeId:2,region:'head'});
  adapter.kill({targetId:'close-dummy',lifeId:4,region:'head'});
  adapter.kill({targetId:'far-bullseye',lifeId:1,region:'centre'});
  assert.deepEqual(events.map(event=>event.type),['start','update','update','update']);
  assert.deepEqual(adapter.snapshot(),{targetKills:3,precisionKills:2,earnedTotal:50});
  events.at(-1).tally.earnedTotal=999;
  const snapshot=adapter.snapshot();snapshot.targetKills=999;
  assert.deepEqual(adapter.snapshot(),{targetKills:3,precisionKills:2,earnedTotal:50});
});

test('adapter validates run and fixed six-target allowlist before emitting a start',()=>{
  requireRange();const events=[];
  for(const ids of [[],['forged'],[...targetIds,'forged'],targetIds.slice(1),[...targetIds.slice(0,5),targetIds[0]]])
    assert.throws(()=>range.createRangeProgression({runId:'visit',targetIds:ids,onEvent:event=>events.push(event)}),RangeError);
  assert.throws(()=>range.createRangeProgression({runId:'bad id',targetIds,onEvent:event=>events.push(event)}),RangeError);
  assert.equal(events.length,0);
});

test('sparse target allowlists cannot omit one of the six required targets',()=>{
  requireRange();const sparse=[...targetIds];delete sparse[0];
  assert.throws(()=>range.createRangeProgression({runId:'sparse',targetIds:sparse}),RangeError);
});

test('close emits stop once with no match bonus and suppresses all later kill callbacks',()=>{
  requireRange();const events=[];
  const adapter=range.createRangeProgression({runId:'closed',targetIds,onEvent:event=>events.push(event)});
  adapter.kill({targetId:'close-dummy',lifeId:1,region:'body'});
  adapter.close();adapter.close();adapter.kill({targetId:'close-dummy',lifeId:2,region:'head'});
  assert.deepEqual(events.map(event=>event.type),['start','update','stop']);
  assert.deepEqual(events.at(-1).tally,{targetKills:1,precisionKills:0,earnedTotal:10});
});

test('controller saves each kill immediately and duplicate close and reload cannot award twice',()=>{
  const f=fixture(),{store,controller}=f.connect(),adapter=f.producer(controller,'first');
  adapter.kill({targetId:'close-dummy',lifeId:1,region:'body'});
  assert.equal(store.view().lifetimeXP,10);assert.equal(f.open().view().lifetimeXP,10);
  adapter.kill({targetId:'close-dummy',lifeId:1,region:'head'});adapter.close();adapter.close();
  assert.equal(f.open().view().lifetimeXP,10);
  const reopened=f.connect(),next=f.producer(reopened.controller,'second');
  next.kill({targetId:'medium-dummy',lifeId:1,region:'head'});
  assert.equal(reopened.store.view().lifetimeXP,30);assert.equal(f.open().view().lifetimeXP,30);
  assert.deepEqual(f.deltas.map(delta=>delta.creditedXP),[10,20]);
});

test('closed abandoned producer cannot reactivate or credit after its receipt is evicted',()=>{
  const f=fixture(),{store,session,controller}=f.connect(),abandoned=f.producer(controller,'abandoned');
  abandoned.kill({targetId:'close-dummy',lifeId:1,region:'body'});abandoned.close();
  for(let i=0;i<65;i++) {
    const next=f.producer(controller,'new-'+i);
    next.kill({targetId:'close-dummy',lifeId:1,region:'body'});next.close();
  }
  assert.equal(JSON.parse(f.data.get(PROFILE_KEY)).receipts.some(receipt=>receipt.key===key('abandoned')),false);
  const summary=session.summary(),notifications=f.views.length;
  abandoned.kill({targetId:'close-dummy',lifeId:2,region:'head'});abandoned.close();
  assert.equal(store.view().lifetimeXP,660);assert.equal(f.open().view().lifetimeXP,660);
  assert.deepEqual(session.summary(),summary);assert.equal(f.views.length,notifications);
});

test('range earnings unlock cosmetics and saved bytes reopen identical XP and ownership',()=>{
  const f=fixture(),{store,controller}=f.connect(),adapter=f.producer(controller,'cosmetics');
  for(let lifeId=1;lifeId<=15;lifeId++)adapter.kill({targetId:'far-dummy',lifeId,region:'body'});
  assert.equal(store.view().lifetimeXP,150);assert.equal(store.view().skinId,'ranger');
  assert.deepEqual(controller.equip({skinId:'crimson-ninja'}),{ok:true,saved:true});
  adapter.close();const reopened=f.open();assert.deepEqual(reopened.view(),store.view());
  assert.equal(ownsCosmetic(reopened.view().lifetimeXP,'skin','crimson-ninja'),true);
  assert.equal(ownsCosmetic(reopened.view().lifetimeXP,'finish','crimson-red'),false);
  assert.deepEqual(Object.keys(JSON.parse(f.data.get(PROFILE_KEY))).sort(),['finishId','lifetimeXP','receipts','schemaVersion','skinId']);
});

for(const failure of ['getter','read'])test(`range play survives throwing storage ${failure} and retries without losing existing XP`,()=>{
  const original=JSON.stringify(record(100)),f=fixture([[PROFILE_KEY,original]]);
  if(failure==='getter')f.denyGetter(true);else f.storage.readDenied=true;
  const {store,controller}=f.connect(),adapter=f.producer(controller,'pending');
  adapter.kill({targetId:'close-dummy',lifeId:1,region:'body'});
  assert.equal(store.view().lifetimeXP,10);assert.equal(f.data.get(PROFILE_KEY),original);
  assert.equal(f.views.at(-1).saveStatus,'unavailable');assert.match(f.views.at(-1).saveMessage,/not saved/);
  f.denyGetter(false);f.storage.readDenied=false;assert.equal(controller.retry(),true);
  assert.equal(f.open().view().lifetimeXP,110);assert.equal(f.views.at(-1).saveStatus,'saved');
  adapter.kill({targetId:'close-dummy',lifeId:1,region:'body'});adapter.close();assert.equal(f.open().view().lifetimeXP,110);
});

test('failed range writes retain in-memory credit and retry saves each reward only once',()=>{
  const f=fixture(),{store,controller}=f.connect(),adapter=f.producer(controller,'quota');
  f.storage.writeDenied=true;adapter.kill({targetId:'close-dummy',lifeId:1,region:'head'});
  assert.equal(store.view().lifetimeXP,20);assert.equal(f.open().view().lifetimeXP,0);
  assert.equal(f.views.at(-1).saveStatus,'unavailable');
  adapter.kill({targetId:'close-dummy',lifeId:1,region:'head'});
  f.storage.writeDenied=false;assert.equal(controller.retry(),true);adapter.close();
  assert.equal(f.open().view().lifetimeXP,20);assert.equal(f.views.at(-1).saveStatus,'saved');
});

test('range earnings continue from the valid backup after corrupt primary recovery',()=>{
  const f=fixture([[PROFILE_KEY,'{broken'],[PROFILE_BACKUP_KEY,JSON.stringify(record(150,{skinId:'crimson-ninja'}))]]);
  const {store,controller}=f.connect(),adapter=f.producer(controller,'backup');
  assert.equal(f.views.at(-1).saveStatus,'recovered');
  adapter.kill({targetId:'far-bullseye',lifeId:1,region:'centre'});adapter.close();
  assert.equal(store.view().lifetimeXP,170);assert.equal(f.open().view().lifetimeXP,170);
  assert.equal(f.open().view().skinId,'crimson-ninja');
});

test('range play with a newer save reports temporary progress and preserves primary and backup bytes',()=>{
  const future=JSON.stringify({...record(999),schemaVersion:7}),backup=JSON.stringify(record(150));
  const f=fixture([[PROFILE_KEY,future],[PROFILE_BACKUP_KEY,backup]]),{store,controller}=f.connect();
  const adapter=f.producer(controller,'future');adapter.kill({targetId:'close-dummy',lifeId:1,region:'body'});adapter.close();
  assert.equal(store.view().lifetimeXP,160);assert.equal(controller.retry(),false);
  assert.equal(f.views.at(-1).saveStatus,'temporary');assert.match(f.views.at(-1).saveMessage,/newer save/);
  assert.equal(f.data.get(PROFILE_KEY),future);assert.equal(f.data.get(PROFILE_BACKUP_KEY),backup);
  assert.equal(f.open().view().lifetimeXP,150);
});

test('normal and network tally validators reject range mode and range-only fields',()=>{
  const tally={targetKills:1,precisionKills:0,earnedTotal:10};
  assert.equal(validateTally(tally,'range'),false);assert.equal(validateTally(emptyTally(),'range'),false);
  assert.equal(validateTally({...emptyTally(),targetKills:0,precisionKills:0},'ffa'),false);
  const receipt={roundId:'round',playerId:'player',modeId:'range',tally};
  const room={roundId:'round',phase:'playing',modeId:'range',players:[{id:'player',teamId:null}]};
  assert.equal(validProgressionReceipt(receipt,room,'player'),false);
  assert.equal(validProgressionReceipt({...receipt,modeId:'ffa'},{...room,modeId:'ffa'},'player'),false);
});

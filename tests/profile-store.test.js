import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const mod = await import('../src/profile-store.js').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
const PRIMARY='block-ops-progression-v1', BACKUP=PRIMARY+'-backup';
const key = id => JSON.stringify(['solo',id]);
const record = (lifetimeXP=0, patch={}) => ({schemaVersion:1,lifetimeXP,skinId:'ranger',finishId:'standard',receipts:[],...patch});
function fixture(entries=[]) {
  const data=new Map(entries);
  const storage={data,readDenied:false,writeDenied:new Set(),getItem(k){if(this.readDenied)throw Error('denied');return data.get(k)??null;},
    setItem(k,v){if(this.writeDenied.has(k))throw Error('quota');data.set(k,v);}};
  const open=legacySkinId=>{assert.equal(typeof mod.createProfileStore,'function');return mod.createProfileStore({getStorage:()=>storage,legacySkinId});};
  return {storage,data,open};
}

test('first-run migration keeps original appearance and every unrelated save',()=>{
  const f=fixture([['block-ops-v1','legacy'],['block-ops-online','online'],['block-ops-zombies-v1','bests']]);
  const store=f.open('shadow-ninja');
  assert.equal(store.view().skinId,'shadow-ninja'); assert.equal(store.view().rank.level,1);
  assert.equal(store.view().saveStatus,'saved');
  assert.equal(f.open().view().skinId,'shadow-ninja');
  assert.deepEqual([...f.data].filter(([k])=>!k.startsWith(PRIMARY)),[['block-ops-v1','legacy'],['block-ops-online','online'],['block-ops-zombies-v1','bests']]);
  const invalid=fixture().open('crimson-ninja'); assert.equal(invalid.view().skinId,'ranger');
});

test('XP, ownership, desired appearance and receipt survive new store and new process',()=>{
  const f=fixture(),store=f.open();
  assert.deepEqual(store.credit(key('run-1'),150),{creditedXP:150,newRewards:[{level:2,kind:'skin',id:'crimson-ninja',name:'Crimson Ninja'}],saved:true});
  assert.equal(store.view().skinId,'ranger','unlock never auto-equips');
  assert.equal(store.equip({skinId:'crimson-ninja'}).ok,true);
  let reopened=f.open(); assert.equal(reopened.view().lifetimeXP,150); assert.equal(reopened.view().skinId,'crimson-ninja');
  assert.equal(reopened.credit(key('run-1'),150).creditedXP,0);
  assert.equal(reopened.credit(key('run-1'),140).creditedXP,0);
  assert.equal(reopened.credit(key('run-1'),350).creditedXP,200);
  assert.equal(reopened.equip({finishId:'crimson-red'}).ok,true);
  assert.equal(reopened.equip({finishId:'gold'}).ok,false);
  const snapshot=reopened.view(); snapshot.lifetimeXP=0;
  assert.equal(f.open().view().lifetimeXP,350);
  const child=spawnSync(process.execPath,['--input-type=module','-e',
    `import {createProfileStore} from ${JSON.stringify(new URL('../src/profile-store.js',import.meta.url).href)}; import {readFileSync} from 'node:fs'; const data=new Map(JSON.parse(readFileSync(0,'utf8'))); const store=createProfileStore({getStorage:()=>({getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)})}); process.stdout.write(JSON.stringify(store.view()));`],
    {input:JSON.stringify([...f.data]),encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
  const fresh=JSON.parse(child.stdout); assert.equal(fresh.lifetimeXP,350); assert.equal(fresh.rank.level,3);
  assert.equal(fresh.skinId,'crimson-ninja'); assert.equal(fresh.finishId,'crimson-red');
});

test('quota retry is atomic and duplicate safe',()=>{
  const f=fixture(),s=f.open();
  f.storage.writeDenied.add(PRIMARY);
  assert.equal(s.credit(key('r'),150).saved,false);
  assert.equal(s.view().saveMessage,'Progress is not saved — storage unavailable');
  assert.equal(f.open().view().lifetimeXP,0,'failed primary did not partly save the receipt');
  assert.equal(s.credit(key('r'),150).creditedXP,0);
  assert.equal(s.equip({skinId:'crimson-ninja'}).saved,false);
  f.storage.writeDenied.clear(); assert.equal(s.retrySave(),true);
  const restored=f.open(); assert.equal(restored.view().lifetimeXP,150); assert.equal(restored.view().skinId,'crimson-ninja');
  assert.equal(restored.credit(key('r'),150).creditedXP,0); assert.equal(s.view().saveStatus,'saved');
});

test('backup failure cannot suppress a successful primary write',()=>{
  const f=fixture(),s=f.open(); f.storage.writeDenied.add(BACKUP);
  assert.equal(s.credit(key('r'),150).saved,true); assert.equal(f.open().view().lifetimeXP,150);
  assert.equal(s.view().saveStatus,'saved');
});

test('valid primary wins; a corrupt primary recovers only previous valid backup',()=>{
  const f=fixture(),s=f.open(); s.credit(key('r'),150); s.credit(key('r'),200);
  assert.equal(f.open().view().lifetimeXP,200);
  f.data.set(PRIMARY,'{broken'); const restored=f.open();
  assert.equal(restored.view().lifetimeXP,150); assert.equal(restored.view().saveMessage,'Recovered previous save');
  restored.credit(key('r'),210); assert.equal(f.open().view().lifetimeXP,210);
  assert.equal(JSON.parse(f.data.get(BACKUP)).lifetimeXP,150,'malformed primary never becomes backup');
});

for(const bad of ['{broken',JSON.stringify(record(-1)),JSON.stringify(record(1.2)),JSON.stringify({...record(),receipts:[{key:key('r'),total:'10'}]}),
  JSON.stringify(record(10,{receipts:[{key:key('r'),total:10},{key:key('r'),total:10}]})), ' '.repeat(131073), JSON.stringify({...record(900),schemaVersion:2})]) {
  test('protected records are never overwritten: '+bad.slice(0,45),()=>{
    const f=fixture([[PRIMARY,bad]]),s=f.open(); assert.equal(s.view().saveStatus,'temporary');
    s.credit(key('new'),150); s.equip({skinId:'crimson-ninja'}); assert.equal(s.retrySave(),false);
    assert.equal(f.data.get(PRIMARY),bad); assert.equal(f.data.has(BACKUP),false); assert.equal(s.view().lifetimeXP,150);
  });
}

test('future primary may display backup but can never be downgraded by a write',()=>{
  const future=JSON.stringify({...record(800),schemaVersion:7});
  const f=fixture([[PRIMARY,future],[BACKUP,JSON.stringify(record(150))]]),s=f.open();
  assert.equal(s.view().lifetimeXP,150); assert.equal(s.view().saveStatus,'temporary');
  s.credit(key('new'),10); assert.equal(s.retrySave(),false); assert.equal(f.data.get(PRIMARY),future);
  assert.equal(JSON.parse(f.data.get(BACKUP)).lifetimeXP,150);
});

test('valid primary can save without overwriting a future-schema backup',()=>{
  const future=JSON.stringify({...record(800),schemaVersion:7});
  const f=fixture([[PRIMARY,JSON.stringify(record(100))],[BACKUP,future]]),s=f.open();
  assert.equal(s.view().lifetimeXP,100); assert.equal(s.credit(key('fresh'),10).saved,true);
  assert.equal(f.open().view().lifetimeXP,110); assert.equal(f.data.get(BACKUP),future);
});

test('unreadable backup alone cannot block a confirmed primary save',()=>{
  const f=fixture([[PRIMARY,JSON.stringify(record(100))]]);
  const original=f.storage.getItem.bind(f.storage);
  f.storage.getItem=k=>{if(k===BACKUP)throw Error('backup denied');return original(k);};
  const s=f.open(); assert.equal(s.view().lifetimeXP,100); assert.equal(s.credit(key('fresh'),10).saved,true);
  assert.equal(f.open().view().lifetimeXP,110);
});

test('missing primary recovers backup; unknown or locked looks never erase valid XP',()=>{
  const f=fixture([[BACKUP,JSON.stringify(record(150,{skinId:'void-guard',finishId:'missing'}))]]),s=f.open();
  assert.equal(s.view().lifetimeXP,150); assert.equal(s.view().skinId,'ranger'); assert.equal(s.view().finishId,'standard');
  assert.equal(s.view().saveStatus,'recovered');
  assert.equal(s.equip({skinId:'__proto__'}).ok,false); assert.equal(s.equip({finishId:null}).ok,false);
  assert.equal(s.equip({skinId:'crimson-ninja',finishId:'gold'}).ok,false,'patch rejects atomically');
  assert.equal(s.view().skinId,'ranger');
});

for(const kind of ['getter','read','missing']) test(`${kind} storage failure permits play and retries without overwriting existing progress`,()=>{
  const f=fixture([[PRIMARY,JSON.stringify(record(100,{skinId:'shadow-ninja'}))]]);
  let denied=true; f.storage.readDenied=kind==='read';
  assert.equal(typeof mod.createProfileStore,'function');
  const s=mod.createProfileStore({getStorage:()=>{if(denied && kind==='getter')throw Error('denied');return denied && kind==='missing'?undefined:f.storage;}});
  assert.equal(s.view().saveStatus,'unavailable'); s.credit(key('fresh'),150);
  assert.equal(s.view().lifetimeXP,150); assert.equal(JSON.parse(f.data.get(PRIMARY)).lifetimeXP,100);
  denied=false; f.storage.readDenied=false; assert.equal(s.retrySave(),true);
  assert.equal(f.open().view().lifetimeXP,250); assert.equal(s.view().skinId,'shadow-ninja');
  assert.equal(s.credit(key('fresh'),150).creditedXP,0); assert.equal(s.retrySave(),true);
  assert.equal(f.open().view().lifetimeXP,250);
});

test('recovered storage with overlapping unknown-base receipt keeps original data untouched',()=>{
  const original=JSON.stringify(record(100,{receipts:[{key:key('overlap'),total:100}]}));
  const f=fixture([[PRIMARY,original]]); f.storage.readDenied=true;
  const s=f.open(); s.credit(key('overlap'),150); f.storage.readDenied=false;
  assert.equal(s.retrySave(),false); assert.equal(f.data.get(PRIMARY),original); assert.equal(s.view().saveStatus,'temporary');
});

test('ledger bounds and saturation persist even when an award cannot raise total',()=>{
  const f=fixture(),s=f.open(); s.credit(key('cap'),2147483647);
  for(let i=0;i<70;i++)s.credit(key('r'+i),10);
  const stored=JSON.parse(f.data.get(PRIMARY)); assert.equal(stored.receipts.length,64);
  assert.equal(stored.receipts[0].key,key('r6')); assert.equal(stored.receipts.at(-1).key,key('r69'));
  assert.equal(f.open().view().lifetimeXP,2147483647); assert.equal(f.open().credit(key('r69'),10).creditedXP,0);
  for(const invalid of ['',null,'__proto__',JSON.stringify(['solo','x'.repeat(97)]),JSON.stringify(['online','https://example.org/path','r','p'])])
    assert.throws(()=>s.credit(invalid,10),RangeError);
  for(const total of [-1,1.1,NaN,Infinity,2147483648])assert.throws(()=>s.credit(key('bad'),total),RangeError);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, pbkdf2Sync } from 'node:crypto';
import { createSoloPowersPinGate } from '../src/solo-powers-pin.js';

const KEY = 'block-ops-solo-powers-pin-v1';
const existingSaves = [['block-ops-v1','settings'], ['block-ops-progression-v1','xp'],
  ['block-ops-progression-v1-backup','backup'], ['block-ops-zombies-v1','records']];
const storedRecord = (pin='0427') => ({schemaVersion:1,kdf:'PBKDF2-SHA256',iterations:100000,
  salt:'0123456789abcdef0123456789abcdef',
  verifier:pbkdf2Sync(pin, Buffer.from('0123456789abcdef0123456789abcdef','hex'),100000,32,'sha256').toString('hex')});
function fixture(raw=null, overrides={}) {
  const data = new Map(existingSaves);
  if (raw !== null) data.set(KEY, raw);
  const storage = {getItem:key=>data.get(key) ?? null, setItem:(key,value)=>data.set(key,value)};
  let time = 1000;
  const open = (extra={}) => createSoloPowersPinGate({getStorage:()=>storage,getCrypto:()=>webcrypto,now:()=>time,...overrides,...extra});
  return {data,storage,open,tick:ms=>{time+=ms;},unrelated:()=>assert.deepEqual([...data].filter(([key])=>key!==KEY),existingSaves)};
}
function deferred() { let resolve; const promise=new Promise(r=>{resolve=r;}); return {promise,resolve}; }
function heldCrypto() {
  const entered=deferred(), release=deferred();
  return {entered,release,crypto:{getRandomValues:v=>webcrypto.getRandomValues(v),subtle:{
    importKey:(...args)=>webcrypto.subtle.importKey(...args),
    async deriveBits(...args) { entered.resolve(); await release.promise; return webcrypto.subtle.deriveBits(...args); },
  }}};
}

test('construction does not access storage or crypto before the gate is requested', () => {
  let reads=0;
  const gate=createSoloPowersPinGate({getStorage:()=>{reads++;throw Error('denied');},getCrypto:()=>{reads++;throw Error('denied');}});
  assert.equal(reads,0);
  assert.equal(gate.status().kind,'unavailable');
});

test('PIN setup saves only an exact salted PBKDF2 verifier and preserves leading zeroes across reopening', async () => {
  const f=fixture(),gate=f.open();
  assert.deepEqual(gate.status(),{kind:'missing',reason:'',retryAfterMs:0});
  assert.deepEqual(await gate.setup('0427','0427'),{ok:true});
  const record=JSON.parse(f.data.get(KEY));
  assert.deepEqual(Object.keys(record).sort(),['iterations','kdf','salt','schemaVersion','verifier']);
  assert.equal(record.schemaVersion,1); assert.equal(record.kdf,'PBKDF2-SHA256'); assert.equal(record.iterations,100000);
  assert.match(record.salt,/^[0-9a-f]{32}$/); assert.match(record.verifier,/^[0-9a-f]{64}$/);
  assert.equal(record.verifier,pbkdf2Sync('0427',Buffer.from(record.salt,'hex'),100000,32,'sha256').toString('hex'));
  assert.equal(gate.status().kind,'ready');
  assert.equal((await gate.verify('427')).ok,false);
  assert.equal((await f.open().verify('0427')).ok,true);
  f.unrelated();
  const other=fixture(); await other.open().setup('0427','0427');
  assert.notEqual(JSON.parse(other.data.get(KEY)).salt,record.salt);
});

for (const pin of ['123', '123456789', 1234, null, '', '12a4', ' 1234', '１２３４', '1234\n']) {
  test(`setup rejects malformed input ${JSON.stringify(pin)} without a save`, async () => {
    const f=fixture(); assert.equal((await f.open().setup(pin,pin)).ok,false);
    assert.equal(f.data.has(KEY),false); f.unrelated();
  });
}

test('confirmation is required and a valid existing record cannot be replaced by setup', async () => {
  const f=fixture(),gate=f.open();
  assert.equal((await gate.setup('0000','0001')).ok,false); assert.equal(f.data.has(KEY),false);
  assert.equal((await gate.setup('00000000','00000000')).ok,true);
  const before=f.data.get(KEY);
  assert.equal((await gate.setup('1234','1234')).ok,false); assert.equal(f.data.get(KEY),before);
});

test('verification needs no writes and leaves every saved byte unchanged', async () => {
  const raw=JSON.stringify(storedRecord()),f=fixture(raw);
  const gate=f.open({getStorage:()=>({getItem:f.storage.getItem})});
  assert.equal(gate.status().kind,'ready'); assert.equal((await gate.verify('0427')).ok,true);
  assert.equal(f.data.get(KEY),raw); f.unrelated();
});

test('five wrong attempts lock for 30 seconds across repeated status reads, then recover', async () => {
  const f=fixture(JSON.stringify(storedRecord())),gate=f.open();
  for (let i=0;i<5;i++) assert.equal((await gate.verify('1111')).ok,false);
  assert.equal(gate.status().retryAfterMs,30000);
  assert.equal((await gate.verify('0427')).ok,false);
  f.tick(29999); assert.equal(gate.status().retryAfterMs,1); assert.equal((await gate.verify('0427')).ok,false);
  f.tick(1); assert.equal(gate.status().retryAfterMs,0); assert.equal((await gate.verify('0427')).ok,true);
  for(let i=0;i<4;i++) assert.equal((await gate.verify('1111')).ok,false);
  assert.equal((await gate.verify('0427')).ok,true,'success clears the previous failure count');
  assert.equal((await f.open().verify('0427')).ok,true,'a fresh app session may reset the cooldown');
});

const valid=storedRecord();
const badRecords = ['{broken',' '.repeat(1025),'null','[]',
  ...[{...valid,schemaVersion:2},{...valid,extra:true},{...valid,iterations:100001},{...valid,kdf:'SHA256'},
    {...valid,salt:'A'.repeat(32)},{...valid,salt:'0'.repeat(30)},{...valid,verifier:'g'.repeat(64)},
    {...valid,verifier:'0'.repeat(62)},{...valid,iterations:'100000'}].map(JSON.stringify)];
for (const [i,raw] of badRecords.entries()) test(`protected saved record ${i} never becomes first setup or gets overwritten`, async () => {
  const f=fixture(raw),gate=f.open(); assert.equal(gate.status().kind,'protected');
  assert.equal((await gate.setup('0427','0427')).ok,false); assert.equal((await gate.verify('0427')).ok,false);
  assert.equal(f.data.get(KEY),raw); f.unrelated();
});

for (const failure of ['getter','read','write','readback','readback-mismatch']) {
  test(`${failure} storage failure stays locked and never touches other save keys`, async () => {
    const f=fixture(); let wrote=false;
    const gate=f.open({getStorage:()=>{
      if(failure==='getter') throw Error('denied');
      return {
        getItem:key=>{if(failure==='read' || wrote && failure==='readback') throw Error('denied');
          return wrote && failure==='readback-mismatch' ? null : f.storage.getItem(key);},
        setItem:(key,value)=>{if(failure==='write')throw Error('quota'); wrote=true;f.storage.setItem(key,value);},
      };
    }});
    if (failure==='getter' || failure==='read') assert.equal(gate.status().kind,'unavailable');
    assert.equal((await gate.setup('0427','0427')).ok,false); f.unrelated();
  });
}

for (const failure of ['getter','absent','subtle','importKey','deriveBits','random','short-result']) {
  test(`crypto ${failure} failure cannot unlock, save plaintext or affect normal saves`, async () => {
    const f=fixture();
    const gate=f.open({getCrypto:()=>{
      if(failure==='getter')throw Error('no crypto');
      if(failure==='absent')return undefined;
      if(failure==='subtle')return {getRandomValues:v=>v};
      return {getRandomValues:v=>{if(failure==='random')throw Error('random denied');return webcrypto.getRandomValues(v);},subtle:{
        importKey:(...args)=>failure==='importKey'?Promise.reject(Error('not supported')):webcrypto.subtle.importKey(...args),
        deriveBits:(...args)=>failure==='deriveBits'?Promise.reject(Error('not supported')):
          failure==='short-result'?Promise.resolve(new ArrayBuffer(1)):webcrypto.subtle.deriveBits(...args),
      }};
    }});
    assert.equal((await gate.setup('0427','0427')).ok,false); assert.equal(f.data.has(KEY),false); f.unrelated();
  });
}

test('crypto errors do not consume wrong-PIN attempts', async () => {
  const f=fixture(JSON.stringify(storedRecord())); let rejecting=true;
  const gate=f.open({getCrypto:()=>rejecting?{getRandomValues:v=>v,subtle:{
    importKey:()=>Promise.reject(Error('unsupported')),deriveBits:()=>Promise.reject(Error('unsupported')),
  }}:webcrypto});
  for(let i=0;i<5;i++) assert.equal((await gate.verify('0427')).ok,false);
  assert.equal(gate.status().retryAfterMs,0); rejecting=false;
  for(let i=0;i<4;i++) assert.equal((await gate.verify('1111')).ok,false);
  assert.equal((await gate.verify('0427')).ok,true); f.unrelated();
});

test('concurrent calls stay busy and no success precedes completed crypto and confirmed save', async () => {
  const f=fixture(),held=heldCrypto(),gate=f.open({getCrypto:()=>held.crypto});
  let settled=false;
  const pending=gate.setup('0427','0427').then(result=>{settled=true;return result;});
  await held.entered.promise; assert.equal(settled,false); assert.equal(f.data.has(KEY),false);
  assert.equal((await gate.setup('1111','1111')).ok,false);
  assert.equal((await gate.verify('1111')).ok,false);
  assert.equal(gate.status().retryAfterMs,0);
  held.release.resolve(); assert.deepEqual(await pending,{ok:true});
  assert.equal((await gate.verify('0427')).ok,true);
});

test('another completed first setup cannot be overwritten by a delayed setup', async () => {
  const f=fixture(),held=heldCrypto(),slow=f.open({getCrypto:()=>held.crypto});
  const pending=slow.setup('0427','0427'); await held.entered.promise;
  assert.equal((await f.open().setup('1111','1111')).ok,true);
  const saved=f.data.get(KEY); held.release.resolve();
  assert.equal((await pending).ok,false); assert.equal(f.data.get(KEY),saved);
  assert.equal((await f.open().verify('1111')).ok,true);
});

test('a record changed during verification cannot authenticate a now-different saved PIN', async () => {
  const f=fixture(JSON.stringify(storedRecord())),held=heldCrypto(),gate=f.open({getCrypto:()=>held.crypto});
  const pending=gate.verify('0427'); await held.entered.promise;
  const replaced=JSON.stringify(storedRecord('1111')); f.data.set(KEY,replaced); held.release.resolve();
  assert.equal((await pending).ok,false); assert.equal(f.data.get(KEY),replaced);
});

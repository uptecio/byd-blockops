import test from 'node:test';
import assert from 'node:assert/strict';
import { createZombieRecords } from '../src/zombie-records.js';

function storage(initial=null) {
  let value=initial;
  return { getItem(key){ assert.equal(key,'block-ops-zombies-v1'); return value; },
    setItem(key,next){ assert.equal(key,'block-ops-zombies-v1'); value=next; } };
}
test('best scores persist by map, order waves before kills and return detached copies',()=>{
  const store=storage(),r=createZombieRecords(store);
  assert.deepEqual(r.best('courtyard'),{ waves:0,kills:0 });
  r.record('courtyard',{ waves:2,kills:14 }); r.record('courtyard',{ waves:1,kills:100 });
  assert.deepEqual(r.best('courtyard'),{ waves:2,kills:14 });
  r.record('courtyard',{ waves:2,kills:15 });
  const copied=r.best('courtyard'); copied.waves=99;
  assert.deepEqual(createZombieRecords(store).best('courtyard'),{ waves:2,kills:15 });
  assert.deepEqual(r.best('harbor'),{ waves:0,kills:0 });
  r.record('courtyard',{ waves:3,kills:12 }).kills=999;
  assert.deepEqual(r.best('courtyard'),{ waves:3,kills:12 });
});
test('denied storage remains usable in memory even when reads and writes throw',()=>{
  for(const s of [undefined,null,{ getItem(){throw Error('denied');},setItem(){throw Error('denied');} }]) {
    const r=createZombieRecords(s);
    assert.deepEqual(r.best('courtyard'),{ waves:0,kills:0 });
    assert.deepEqual(r.record('courtyard',{ waves:2,kills:14 }),{ waves:2,kills:14 });
    assert.deepEqual(r.best('courtyard'),{ waves:2,kills:14 });
  }
});
test('corrupt storage, arrays, unknown maps and invalid numbers never become scores',()=>{
  for(const raw of ['oops','null','[]','42','{"fake":{"waves":99,"kills":99}}',
    '{"courtyard":{"waves":-1,"kills":2}}','{"courtyard":{"waves":1e100,"kills":2}}',
    '{"courtyard":{"waves":2,"kills":null}}','{"courtyard":[2,14]}']) {
    assert.deepEqual(createZombieRecords(storage(raw)).best('courtyard'),{ waves:0,kills:0 });
  }
  const r=createZombieRecords(storage());
  for(const number of [-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1,'2',null]) {
    assert.throws(()=>r.record('courtyard',{ waves:number,kills:2 }),RangeError);
    assert.throws(()=>r.record('courtyard',{ waves:2,kills:number }),RangeError);
  }
  for(const id of ['fake','__proto__',null]) {
    assert.throws(()=>r.best(id),RangeError); assert.throws(()=>r.record(id,{ waves:1,kills:5 }),RangeError);
  }
});

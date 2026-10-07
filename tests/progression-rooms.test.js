import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/rooms.js';
import { equipmentDTO, pickupEquipment, setHeldItem } from '../src/equipment.js';
import { startSupplyUse } from '../src/supplies.js';
import { emptyTally } from '../src/progression.js';

function pair(modeId='ffa') {
  const manager=new RoomManager(), room=manager.create('a','A','m4a1',{modeId,finishId:'crimson-red'});
  manager.join('b',room.code,'B','g17');
  return {manager,room,a:room.players.get('a'),b:room.players.get('b'), tally:id=>manager.progressionSnapshot(id).tally};
}
const put=(p,x,z)=>Object.assign(p,{x,z,y:0,protectedRemaining:0});

test('round identities exist only after actual starts and receipts are private detached participation totals',()=>{
  const {manager,room,a,b,tally}=pair();
  assert.equal(manager.snapshot(room).roundId,null); assert.equal(manager.progressionSnapshot('a'),null);
  manager.configure('a',{mapId:'harbor',modeId:'ffa'}); assert.equal(room.roundId,null);
  manager.start('a'); const first=room.roundId;
  assert.match(first,/^[a-f0-9-]{36}$/); assert.throws(()=>manager.start('a')); assert.equal(room.roundId,first);
  manager.eliminate(room,'a',b); assert.equal(tally('a').earnedTotal,10); assert.equal(tally('b').earnedTotal,0);
  manager.eliminate(room,'a',b); assert.equal(tally('a').earnedTotal,10);
  for(let i=0;i<300;i++)manager.event(room,{type:'hit',playerId:'a',targetId:'b'});
  manager.snapshot(room); manager.snapshot(room); assert.equal(tally('a').earnedTotal,10);
  const copy=manager.progressionSnapshot('a'); copy.tally.earnedTotal=999; assert.equal(tally('a').earnedTotal,10);
  const publicState=manager.snapshot(room); assert.equal(publicState.progression,undefined);
  assert.ok(publicState.players.every(p=>!('tally' in p)&&!('lifetimeXP' in p)));
  manager.tick(180); assert.equal(tally('a').earnedTotal,85); assert.equal(tally('b').earnedTotal,0);
  manager.syncMode(room); manager.tick(10); assert.equal(tally('a').earnedTotal,85);
  manager.join('late',room.code,'Late'); assert.deepEqual(tally('late'),emptyTally());
  manager.leave('a'); assert.throws(()=>manager.progressionSnapshot('a'));
  manager.join('new',room.code,'A'); assert.deepEqual(tally('new'),emptyTally());
  manager.start('b'); assert.notEqual(room.roundId,first); assert.deepEqual(tally('b'),emptyTally());
  manager.tick(180);manager.configure('b',{mapId:'courtyard',modeId:'tdm'});
  assert.equal(room.roundId,null); assert.equal(manager.progressionSnapshot('b'),null);
  assert.equal(a.skinId,'ranger');
});

for(const modeId of ['ffa','tdm','ctf'])test(`${modeId} accepts scoring kills only and finish bonuses require action XP`,()=>{
  const {manager,room,a,b,tally}=pair(modeId); manager.join('idle',room.code,'Idle');manager.start('a');
  b.protectedRemaining=2; manager.damage(room,'a',b,100); assert.equal(tally('a').earnedTotal,0);
  manager.damage(room,'a',a,100); assert.equal(tally('a').earnedTotal,0);
  if(modeId!=='ffa') { const ally=room.players.get('idle'); ally.protectedRemaining=0;manager.damage(room,'a',ally,100);assert.equal(tally('a').earnedTotal,0); }
  b.protectedRemaining=0;manager.damage(room,'a',b,10);assert.equal(tally('a').earnedTotal,0);
  manager.damage(room,'a',b,1e10);assert.equal(tally('a').earnedTotal,10);
  manager.damage(room,'a',b,1e10);assert.equal(tally('a').earnedTotal,10);
  manager.tick(2.6); b.protectedRemaining=0;manager.damage(room,'a',b,100); assert.equal(tally('a').earnedTotal,20);
  manager.tick(180); assert.equal(tally('a').earnedTotal,modeId==='ctf'?70:95);assert.equal(tally('idle').earnedTotal,0);
});

for(const [modeId,limit] of [['ffa',15],['tdm',30]])test(`${modeId} winning elimination is credited before natural completion`,()=>{
  const {manager,room,b,tally}=pair(modeId);manager.start('a');
  for(let i=0;i<limit;i++){if(i)manager.spawn(room,b);manager.eliminate(room,'a',b);}
  assert.equal(room.phase,'ended');assert.equal(tally('a').earnedTotal,limit*10+75);
  assert.equal(tally('a').eliminations,limit);assert.equal(tally('a').won,true);
});

test('CTF actor capture/manual return awards exclude pickup drop automatic return and include final capture',()=>{
  const {manager,room,a,b,tally}=pair('ctf');manager.start('a');
  put(b,0,18);put(a,10,0);manager.tick(1/30);assert.equal(tally('b').earnedTotal,0);
  manager.eliminate(room,'a',b);assert.equal(tally('a').earnedTotal,10);
  put(a,0,18);manager.tick(1/30);assert.equal(tally('a').earnedTotal,20);assert.equal(tally('a').flagReturns,1);
  manager.spawn(room,b);put(b,0,18);put(a,10,0);manager.tick(1/30);manager.eliminate(room,'a',b);
  manager.tick(15);assert.equal(tally('a').earnedTotal,30);assert.equal(tally('a').flagReturns,1);
  put(b,10,0);
  for(let i=0;i<3;i++){put(a,0,-18);manager.tick(1/30);put(a,0,18);manager.tick(1/30);}
  assert.equal(room.phase,'ended');assert.equal(tally('a').earnedTotal,255);
  assert.equal(tally('a').flagCaptures,3);assert.equal(tally('a').won,true);
});

test('leaving preserves only delivered action XP and rejoining starts a fresh tally',()=>{
  const {manager,room,b,tally}=pair();manager.start('a');manager.eliminate(room,'a',b);
  const delivered=manager.progressionSnapshot('a');manager.leave('a');manager.tick(180);
  assert.equal(delivered.tally.earnedTotal,10);assert.equal(delivered.tally.completed,false);
  manager.join('new-a',room.code,'A');assert.deepEqual(tally('new-a'),emptyTally());
});

test('finish preferences validate before membership mutation and defer without changing equipment',()=>{
  const {manager,room,a}=pair();assert.equal(a.finishId,'crimson-red');assert.equal(a.pendingFinishId,null);
  for(const finishId of ['bad',null,{},'__proto__']) {
    assert.throws(()=>manager.create('bad','N','g17',{finishId}),/Unknown/);
    assert.throws(()=>manager.join('bad',room.code,'N','g17',{finishId}),/Unknown/);
    assert.throws(()=>manager.setFinish('a',finishId),/Unknown/);
    assert.equal(manager.roomFor('bad'),undefined);
  }
  manager.setFinish('a','ice-blue');assert.equal(a.finishId,'ice-blue');manager.start('a');
  pickupEquipment(a.equipment,{kind:'knife'});setHeldItem(a.equipment,'knife');
  const before=equipmentDTO(a.equipment);manager.setSkin('a','crimson-ninja');manager.setFinish('a','gold');
  assert.deepEqual(equipmentDTO(a.equipment),before);assert.equal(a.finishId,'ice-blue');assert.equal(a.pendingFinishId,'gold');
  manager.eliminate(room,'b',a);manager.setFinish('a','violet');manager.spawn(room,a);
  assert.equal(a.finishId,'violet');assert.equal(a.pendingFinishId,null);assert.equal(a.skinId,'crimson-ninja');
  a.health=10;pickupEquipment(a.equipment,{kind:'supply',supplyType:'health'});startSupplyUse(a.equipment,a,'health',{active:true,alive:true});
  const using=equipmentDTO(a.equipment);manager.setFinish('a','orange');assert.deepEqual(equipmentDTO(a.equipment),using);
  manager.tick(180);manager.start('a');assert.equal(a.finishId,'orange');assert.equal(a.pendingFinishId,null);
});

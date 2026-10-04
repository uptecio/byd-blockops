import test from 'node:test';
import assert from 'node:assert/strict';
import { waveConfig, createSurvival, tickSurvival, nextZombieSpawn, resolveZombieSpawn,
  recordZombieDeath, settleSurvival, survivalView } from '../src/zombie-survival.js';

function clearWave(s) {
  while (s.queued) {
    tickSurvival(s, 1);
    const next = nextZombieSpawn(s);
    assert.ok(next);
    assert.equal(resolveZombieSpawn(s, next.id, true), true);
    assert.equal(recordZombieDeath(s, next.id), true);
  }
  return settleSurvival(s, true);
}

test('wave sizes increase and runners enter at wave three with a bounded proportion', () => {
  for (const [wave, expected] of [[1,{total:5,walkers:5,runners:0}], [2,{total:7,walkers:7,runners:0}],
    [3,{total:9,walkers:7,runners:2}], [13,{total:29,walkers:15,runners:14}], [100,{total:203,walkers:102,runners:101}]])
    assert.deepEqual(waveConfig(wave), expected);
  for (const invalid of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER,'3']) assert.throws(() => waveConfig(invalid));
  assert.throws(() => createSurvival('missing-map'));
});

test('failed spawn waits one second without consuming its enemy or identity', () => {
  const s = createSurvival('courtyard'), next = nextZombieSpawn(s);
  assert.equal(next.kind, 'walker');
  assert.equal(resolveZombieSpawn(s, 'unrequested', true), false);
  assert.equal(resolveZombieSpawn(s, next.id, false), false);
  assert.equal(s.queued, 5); assert.equal(s.activeIds.size, 0);
  assert.equal(nextZombieSpawn(s), null);
  tickSurvival(s, .99); assert.equal(nextZombieSpawn(s), null);
  tickSurvival(s, .01); assert.deepEqual(nextZombieSpawn(s), next);
  assert.equal(resolveZombieSpawn(s, next.id, true), true);
  assert.equal(s.queued, 4); assert.equal(s.activeIds.size, 1);
  assert.equal(resolveZombieSpawn(s, next.id, true), false);
});

test('queued enemies prevent early recovery and duplicate deaths score once', () => {
  const s = createSurvival('courtyard'), next = nextZombieSpawn(s);
  resolveZombieSpawn(s, next.id, true);
  assert.equal(recordZombieDeath(s, next.id), true);
  assert.equal(recordZombieDeath(s, next.id), false);
  assert.equal(recordZombieDeath(s, 'other'), false);
  assert.equal(s.kills, 1);
  assert.deepEqual(settleSurvival(s, true), []);
  assert.equal(s.phase, 'fighting'); assert.equal(survivalView(s).remaining, 4);
});

test('ten seconds advances exactly one wave and recovery is awarded only once', () => {
  const s = createSurvival('courtyard');
  assert.deepEqual(clearWave(s), [{type:'recovery',completedWaves:1}]);
  assert.equal(s.recoveryRemaining, 10); assert.equal(nextZombieSpawn(s), null);
  assert.deepEqual(settleSurvival(s, true), []);
  tickSurvival(s, 9.99); assert.equal(s.wave, 1);
  assert.deepEqual(tickSurvival(s, .01), [{type:'wave-start',wave:2}]);
  assert.equal(s.phase, 'fighting'); assert.equal(s.queued, 7);
  assert.equal(s.completedWaves, 1); assert.equal(s.kills, 5);
});

test('death wins over a pending wave clear and terminal state cannot be revived', () => {
  const s = createSurvival('courtyard');
  for (let i=0;i<5;i++) {
    tickSurvival(s,1); const next=nextZombieSpawn(s);
    resolveZombieSpawn(s,next.id,true); recordZombieDeath(s,next.id);
  }
  assert.deepEqual(settleSurvival(s,false), [{type:'ended'}]);
  assert.equal(s.completedWaves,0); assert.equal(s.ended,true);
  const before=survivalView(s);
  assert.deepEqual(tickSurvival(s,100),[]);
  assert.deepEqual(settleSurvival(s,true),[]);
  assert.deepEqual(survivalView(s),before); assert.equal(nextZombieSpawn(s),null);
});

test('at most eight living zombies and late frames cannot burst the queue', () => {
  const s=createSurvival('courtyard');
  clearWave(s); tickSurvival(s,10); clearWave(s); tickSurvival(s,10);
  const kinds=[];
  for(let i=0;i<8;i++) {
    tickSurvival(s,100); const next=nextZombieSpawn(s); kinds.push(next.kind);
    assert.ok(resolveZombieSpawn(s,next.id,true));
    assert.equal(nextZombieSpawn(s),null);
  }
  tickSurvival(s,100); assert.equal(nextZombieSpawn(s),null);
  assert.equal(s.queued,1); assert.equal(s.activeIds.size,8);
  assert.equal(survivalView(s).remaining,9);
  recordZombieDeath(s,s.activeIds.values().next().value);
  const next=nextZombieSpawn(s); kinds.push(next.kind); resolveZombieSpawn(s,next.id,true);
  assert.equal(kinds.filter(k=>k==='runner').length,2);
  assert.ok(kinds.indexOf('runner')>0 && kinds.indexOf('runner')<7);
});

test('invalid durations do not mutate clocks and projections are detached', () => {
  const s=createSurvival('courtyard'), before=survivalView(s);
  for(const dt of [0,-1,NaN,Infinity,'1',undefined]) assert.deepEqual(tickSurvival(s,dt),[]);
  assert.deepEqual(survivalView(s),before);
  const view=survivalView(s); view.wave=999; view.queued=0;
  assert.equal(s.wave,1); assert.equal(s.queued,5);
});

test('one thousand wave cycles retain no enemy history or reused identities', () => {
  const s=createSurvival('courtyard'); let previousNumber=0;
  for(let wave=1;wave<=1000;wave++) {
    while(s.queued) {
      tickSurvival(s,1); const next=nextZombieSpawn(s);
      assert.ok(Number(next.id.split('-').pop())>previousNumber);
      previousNumber=Number(next.id.split('-').pop());
      resolveZombieSpawn(s,next.id,true); recordZombieDeath(s,next.id);
    }
    settleSurvival(s,true);
    assert.equal(s.activeIds.size,0); assert.equal(s.completedWaves,wave);
    assert.ok(JSON.stringify({...s,activeIds:[...s.activeIds]}).length<500);
    tickSurvival(s,10);
  }
  assert.equal(s.kills,1004000);
});

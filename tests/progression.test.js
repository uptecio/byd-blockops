import test from 'node:test';
import assert from 'node:assert/strict';

// A missing progression module is an assertion failure, not a fixture/import error.
const xp = await import('../src/progression.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const { rankForXP, ownsCosmetic, rewardsBetween, emptyTally, awardTally, finishTally, validateTally } = xp;

test('rank boundaries unlock the fixed track and never reset at the cap', () => {
  assert.equal(typeof rankForXP, 'function');
  const thresholds = [0,150,350,600,900,1250,1650,2100,2600,3150,3750,4400,5100,5850,6650,7500,8400];
  for (let i=0; i<thresholds.length; i++) {
    assert.equal(rankForXP(thresholds[i]).level, i+1);
    assert.equal(rankForXP(thresholds[i]).intoLevel, 0);
    if (i) assert.equal(rankForXP(thresholds[i]-1).level, i);
  }
  assert.deepEqual(rankForXP(149), {level:1,intoLevel:149,levelCost:150,nextReward:{level:2,kind:'skin',id:'crimson-ninja',name:'Crimson Ninja'}});
  assert.deepEqual(rankForXP(2147483647), {level:17,intoLevel:0,levelCost:0,nextReward:null});
  for (const value of [-1, 1.5, NaN, Infinity, '150', null, 2147483648]) assert.throws(()=>rankForXP(value), RangeError);
});

test('ownership is derived from XP and preserves every original free skin', () => {
  assert.equal(typeof ownsCosmetic, 'function');
  for (const id of ['ranger','desert-ops','arctic-scout','jungle-scout','neon-runner','shadow-ninja','robo-unit','space-guard'])
    assert.equal(ownsCosmetic(0,'skin',id), true);
  assert.equal(ownsCosmetic(0,'finish','standard'), true);
  assert.equal(ownsCosmetic(149,'skin','crimson-ninja'), false);
  assert.equal(ownsCosmetic(150,'skin','crimson-ninja'), true);
  assert.equal(ownsCosmetic(349,'finish','crimson-red'), false);
  assert.equal(ownsCosmetic(350,'finish','crimson-red'), true);
  for (const id of ['missing','__proto__','constructor',null]) assert.equal(ownsCosmetic(8400,'skin',id), false);
  assert.equal(ownsCosmetic(8400,'weapon','gold'), false);
  assert.deepEqual(rewardsBetween(0,8400).map(r=>r.id), ['crimson-ninja','crimson-red','midnight-ops','ice-blue','frost-unit','forest-camo','solar-guard','violet','golden-ninja','orange','urban-ranger','arctic-white','lava-unit','stealth-black','void-guard','gold']);
  assert.deepEqual(rewardsBetween(350,600).map(r=>r.id), ['midnight-ops']);
  assert.deepEqual(rewardsBetween(600,350), []);
  assert.deepEqual(rewardsBetween(8400,2147483647), []);
  assert.throws(()=>{ xp.REWARDS[0].id='changed'; }, TypeError);
});

for (const [mode,action,want] of [['ffa','eliminations',10],['tdm','eliminations',10],['ctf','eliminations',10],['ctf','flagCaptures',50],['ctf','flagReturns',10],['zombies','zombieKills',2],['zombies','wavesCleared',25]]) {
  test(`${mode} accepted ${action} credits ${want} XP per action without mutating input`, ()=>{
    assert.equal(typeof emptyTally,'function');
    const before=emptyTally(), after=awardTally(before,mode,action,3);
    assert.equal(after.earnedTotal,want*3); assert.equal(after[action],3);
    assert.equal(before.earnedTotal,0); assert.equal(validateTally(after,mode),true);
  });
}

for (const modeId of ['ffa','tdm','ctf']) test(`${modeId} completion requires action and gives finish/win once`, ()=>{
  assert.equal(typeof emptyTally,'function');
  const action=awardTally(emptyTally(),modeId,'eliminations');
  assert.equal(finishTally(emptyTally(),{modeId,naturalEnd:true,won:true}).earnedTotal,0);
  assert.equal(finishTally(action,{modeId,naturalEnd:false,won:true}).earnedTotal,10);
  assert.equal(finishTally(action,{modeId,naturalEnd:true,won:false}).earnedTotal,60);
  const won=finishTally(action,{modeId,naturalEnd:true,won:true});
  assert.equal(won.earnedTotal,85); assert.equal(won.completed,true); assert.equal(won.won,true);
  assert.deepEqual(finishTally(won,{modeId,naturalEnd:true,won:true}),won);
  assert.deepEqual(awardTally(won,modeId,'eliminations'),won);
});

test('Zombies kills stack with waves but only a cleared-wave game-over earns finish, never win', ()=>{
  assert.equal(typeof emptyTally,'function');
  const kills=awardTally(emptyTally(),'zombies','zombieKills',5);
  assert.equal(finishTally(kills,{modeId:'zombies',naturalEnd:true,won:true}).earnedTotal,10);
  const wave=awardTally(kills,'zombies','wavesCleared');
  assert.equal(wave.earnedTotal,35);
  assert.equal(finishTally(wave,{modeId:'zombies',naturalEnd:false,won:false}).earnedTotal,35);
  const ended=finishTally(wave,{modeId:'zombies',naturalEnd:true,won:true});
  assert.equal(ended.earnedTotal,85); assert.equal(ended.won,false);
});

test('non-actions and mode-incompatible awards cannot grant XP', ()=>{
  assert.equal(typeof emptyTally,'function');
  for (const action of ['damage','headshot','friendly-fire','self-damage','death','loot','flag-pickup','flag-drop','auto-return','lobby','results','__proto__'])
    assert.throws(()=>awardTally(emptyTally(),'ctf',action),RangeError);
  for (const [mode,action] of [['ffa','flagCaptures'],['tdm','flagReturns'],['ctf','zombieKills'],['zombies','eliminations'],['unknown','eliminations']])
    assert.throws(()=>awardTally(emptyTally(),mode,action),RangeError);
  for (const count of [-1,0,.5,NaN,Infinity,2147483648,'1']) assert.throws(()=>awardTally(emptyTally(),'ffa','eliminations',count),RangeError);
});

test('tallies enforce weighted totals, exact keys, boolean eligibility and saturation', ()=>{
  assert.equal(typeof emptyTally,'function');
  const tally=awardTally(emptyTally(),'ctf','flagCaptures',2147483647);
  assert.equal(tally.earnedTotal,2147483647);
  assert.equal(awardTally(tally,'ctf','flagCaptures').flagCaptures,2147483647);
  assert.equal(finishTally(tally,{modeId:'ctf',naturalEnd:true,won:true}).earnedTotal,2147483647);
  for (const bad of [null,[],{}, {...emptyTally(),earnedTotal:1}, {...emptyTally(),completed:true}, {...emptyTally(),won:true}, {...emptyTally(),extra:1}, {...emptyTally(),eliminations:NaN}, {...emptyTally(),completed:1}])
    assert.equal(validateTally(bad,'ffa'),false);
  assert.equal(validateTally(awardTally(emptyTally(),'ctf','flagReturns'),'ffa'),false);
  assert.equal(validateTally(emptyTally(),'unknown'),false);
  assert.equal(validateTally(Object.create(emptyTally()),'ffa'),false);
});

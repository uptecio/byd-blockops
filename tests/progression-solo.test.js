import test from 'node:test';
import assert from 'node:assert/strict';
import {createHeadlessGame,cleanupGame, positionBot, setWorldSolids } from './helpers/game-fixture.js';
import {pickupEquipment,equipmentDTO} from '../src/equipment.js';
import {OnlineArena} from '../src/online-game.js';
import {RoomManager} from '../server/rooms.js';
const mod=await import('../src/solo-progression.js').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
function arena(t,settings={}) {
  const game=createHeadlessGame(),events=[]; t.after(()=>cleanupGame(game));
  game.events.onProgression=e=>events.push(e);
  game.start('m4a1',{bots:2,...settings});
  setWorldSolids(game, []); game.botTuning={speed:0,interval:1,accuracy:0,damage:8};
  Object.assign(game.player,{x:0,z:10,protected:0});
  game.bots.forEach((b,i)=>{positionBot(b, i*2,0,0);b.protected=0;b.cooldown=100;});
  return {game,events,last:()=>events.at(-1)?.tally};
}
function wave(game) {
  for(let i=0;i<200 && game.modeState.phase==='fighting';i++) {
    game.player.protected=1000;game.update(.25);
    for(const zombie of game.bots)if(zombie.health>0)game.damageActor('local',zombie,100);
    game.zombieRuntime.finishStep();
  }
  assert.equal(game.modeState.phase,'recovery');
}

test('offline adapter rejects stale lives and repeated cumulative zombie reports',()=>{
  assert.equal(typeof mod.createSoloProgression,'function');
  const events=[],adapter=mod.createSoloProgression({runId:'round-1',modeId:'ffa',onEvent:e=>events.push(e)});
  const kill={killerId:'local',victimId:'bot-0',victimLifeId:1,enemy:true};
  adapter.elimination(kill);adapter.elimination(kill); assert.equal(events.at(-1).tally.earnedTotal,10);
  adapter.elimination({...kill,victimLifeId:2}); assert.equal(events.at(-1).tally.earnedTotal,20);
  adapter.close();adapter.elimination({...kill,victimLifeId:3}); assert.equal(events.at(-1).tally.earnedTotal,20);
  assert.equal(events.at(-1).tally.completed,false);
  const z=mod.createSoloProgression({runId:'z',modeId:'zombies',onEvent:e=>events.push(e)});
  z.survival({kills:5,wavesCleared:1,ended:false}); z.survival({kills:5,wavesCleared:1,ended:false});
  assert.equal(events.at(-1).tally.earnedTotal,35);
  z.survival({kills:5,wavesCleared:1,ended:true}); z.survival({kills:5,wavesCleared:1,ended:true});
  assert.equal(events.at(-1).tally.earnedTotal,85);assert.equal(events.at(-1).tally.won,false);
});

test('solo run identity does not require newer globalThis or randomUUID APIs',()=>{
  assert.equal(typeof mod.newSoloRunId,'function');
  const root=globalThis, oldUUID=crypto.randomUUID;
  let first,second;
  try {
    crypto.randomUUID=undefined; root.globalThis=undefined;
    first=mod.newSoloRunId();second=mod.newSoloRunId();
  } finally {root.globalThis=root;crypto.randomUUID=oldUUID;}
  assert.match(first,/^[a-f0-9]{32}$/);assert.notEqual(first,second);
});

for(const fault of ['absent','getter','random'])test(`ordinary solo still starts and earns separate receipts with ${fault} crypto`,t=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
  t.after(()=>Object.defineProperty(globalThis,'crypto',descriptor));
  Object.defineProperty(globalThis,'crypto',fault==='getter'
    ? {configurable:true,get(){throw Error('crypto denied');}}
    : {configurable:true,value:fault==='absent'?undefined:{getRandomValues(){throw Error('rng denied');}}});
  t.mock.method(Date,'now',()=>1000);t.mock.method(Math,'random',()=>.5);
  const {game,events,last}=arena(t,{bots:1});
  const first=events[0].key;
  game.damageActor('local',game.bots[0],100);assert.equal(last().earnedTotal,10);
  game.quit();game.start('m4a1',{bots:1});
  assert.notEqual(events.at(-1).key,first,'separate rounds do not reuse an XP receipt even at the same clock and random value');
  assert.equal(last().earnedTotal,0);
});

for(const difficulty of ['easy','normal','hard'])test(`${difficulty} live kills credit once per life and natural finish precedes results`,t=>{
  const {game,events,last}=arena(t,{bots:1,difficulty});
  assert.equal(events[0]?.type,'start'); const bot=game.bots[0];
  game.damageActor('local',bot,100); assert.equal(last().earnedTotal,10);
  game.damageActor('local',bot,100); assert.equal(last().earnedTotal,10);
  game.spawnBot(bot);bot.protected=0;game.damageActor('local',bot,100);assert.equal(last().earnedTotal,20);
  let atResults;game.events.onEnd=()=>{atResults=last().earnedTotal;};
  game.modeState.timeLeft=.01;game.update(.01);
  assert.equal(atResults,95);assert.equal(last().completed,true); assert.equal(last().won,true);
  game.finishRound();game.events.onEnd();assert.equal(last().earnedTotal,95);
  const oldKey=events[0].key;game.start('m4a1',{bots:1}); assert.notEqual(events.at(-1).key,oldKey); assert.equal(last().earnedTotal,0);
});

test('no XP for friendly/self/protected damage, loot, death or an idle finish',t=>{
  const {game,last}=arena(t,{modeId:'tdm',bots:2}); assert.ok(last());
  const enemy=game.bots.find(b=>b.teamId!==game.player.teamId),friend=game.bots.find(b=>b.teamId===game.player.teamId);
  game.damageActor('local',friend,100);game.damageActor('local',game.player,100);
  enemy.protected=1;game.damageActor('local',enemy,100);enemy.protected=0;game.damageActor('local',enemy,1);
  pickupEquipment(game.player.equipment,{kind:'knife'});game.damageActor(enemy.id,game.player,100);
  game.modeState.timeLeft=.01;game.update(.01);assert.equal(last().earnedTotal,0);assert.equal(last().completed,false);
});

test('early quit keeps only action XP and a natural draw has no win bonus',t=>{
  const {game,last}=arena(t,{bots:1}); const bot=game.bots[0];
  game.damageActor('local',bot,100);game.quit();assert.equal(last()?.earnedTotal,10);assert.equal(last().completed,false);
  game.start('m4a1',{bots:1});game.botTuning={speed:0,interval:1,accuracy:0,damage:8};
  const opponent=game.bots[0];opponent.protected=0;game.player.protected=0;
  game.damageActor('local',opponent,100);game.spawnBot(opponent);opponent.protected=0;
  game.damageActor(opponent.id,game.player,100);game.modeState.timeLeft=.01;game.update(.01);
  assert.equal(last().earnedTotal,60);assert.equal(last().won,false);
});

test('manual flag return earns ten, automatic return and pickup earn zero',t=>{
  const {game,last}=arena(t,{modeId:'ctf'});assert.ok(last());
  const flag=game.modeState.flags.red;
  Object.assign(flag,{status:'dropped',x:game.player.x,z:game.player.z,returnRemaining:10});
  game.update(.01);assert.equal(last().earnedTotal,10);
  Object.assign(flag,{status:'dropped',x:20,z:20,returnRemaining:.01});game.update(.01);assert.equal(last().earnedTotal,10);
  const blue=game.world.definition.bases.blue;Object.assign(game.player,blue,{protected:0});game.update(.01);
  assert.equal(game.modeState.flags.blue.carrierId,'local');assert.equal(last().earnedTotal,10);
  Object.assign(game.player,game.world.definition.bases.red);game.update(.01);assert.equal(last().earnedTotal,60);
});

test('winning capture is credited before CTF finish and team bonus',t=>{
  const {game,last}=arena(t,{modeId:'ctf'});assert.ok(last());
  for(let i=0;i<3;i++){
    Object.assign(game.player,game.world.definition.bases.blue,{protected:0});game.update(.01);
    Object.assign(game.player,game.world.definition.bases.red);game.update(.01);
  }
  assert.equal(game.modeState.ended,true); assert.equal(last().flagCaptures,3);assert.equal(last().earnedTotal,225);
});

for(const weapon of ['gun','knife','frag'])test(`${weapon} actual damage awards XP without a separate headshot award`,t=>{
  t.mock.method(Math,'random',()=>.5);
  const {game,last}=arena(t,{bots:weapon==='frag'?2:1});assert.ok(last());
  if(weapon==='gun') {game.player.z=1.2;game.placeCamera();game.shoot(false);game.shoot(false);}
  if(weapon==='knife') {
    game.player.z=1.2;pickupEquipment(game.player.equipment,{kind:'knife'});
    game.requestEquipment({kind:'held-item',heldItem:'knife'});game.slash(game.getActors()[0]);
    assert.equal(last().earnedTotal,0);game.player.equipment.meleeRemaining=0;game.slash(game.getActors()[0]);
  }
  if(weapon==='frag') {
    game.bots.forEach(b=>{b.health=50;});pickupEquipment(game.player.equipment,{kind:'grenade',grenadeType:'frag'});
    game.requestEquipment({kind:'throw',grenadeType:'frag'});
    Object.assign(game.gearCombatState.projectiles[0],{x:1,y:.12,z:0,vx:0,vy:0,vz:0,fuseRemaining:.01});game.update(.02);
  }
  assert.equal(last().earnedTotal,weapon==='frag'?20:10);
});

test('zombie waves stack once and recovery never applies pending appearance',t=>{
  const {game,last}=arena(t,{modeId:'zombies',skinId:'ranger'});assert.ok(last());
  game.setPendingAppearance({skinId:'crimson-ninja',finishId:'crimson-red'});wave(game);
  assert.equal(last().earnedTotal,35);assert.equal(game.player.skinId,'ranger');assert.equal(game.player.finishId,'standard');
  game.zombieRuntime.record();game.zombieRuntime.finishStep();assert.equal(last().earnedTotal,35);
  game.player.health=0;game.zombieRuntime.finishStep();assert.equal(last().earnedTotal,85);assert.equal(last().completed,true);
  game.start('m4a1',{modeId:'zombies',skinId:'crimson-ninja',finishId:'crimson-red'});
  assert.equal(game.player.skinId,'crimson-ninja');assert.equal(game.player.finishId,'crimson-red');assert.equal(last().earnedTotal,0);
  game.player.health=0;game.zombieRuntime.finishStep();assert.equal(last().earnedTotal,0);assert.equal(last().completed,false);
});

for(const state of ['live','dead','knife','supply'])test(`pending appearance is not equipment: ${state}`,t=>{
  const {game}=arena(t);assert.equal(typeof game.setPendingAppearance,'function');
  const e=game.player.equipment;e.owned.get('m4a1').ammo=7;
  pickupEquipment(e,{kind:'knife'});pickupEquipment(e,{kind:'supply',supplyType:'health'});
  if(state==='dead'){game.player.health=0;game.player.dead=2;}
  if(state==='knife')game.requestEquipment({kind:'held-item',heldItem:'knife'});
  if(state==='supply'){game.player.health=50;game.requestEquipment({kind:'use-supply',supplyType:'health'});}
  const before=equipmentDTO(e),model=game.weaponModel;
  game.setPendingAppearance({skinId:'crimson-ninja',finishId:'crimson-red'});game.syncPlayerEquipment();
  assert.deepEqual(equipmentDTO(e),before);assert.equal(game.weaponModel,model);
  assert.equal(game.player.skinId,'ranger');assert.equal(game.player.finishId,'standard');
  assert.equal(game.player.pendingFinishId,'crimson-red');game.setPendingSkin('robo-unit');
  assert.equal(game.player.pendingFinishId,'crimson-red');game.resetPlayer();
  assert.equal(game.player.skinId,'robo-unit');assert.equal(game.player.finishId,'crimson-red');
  assert.equal(game.weaponState.ammo+game.weaponState.reserve,500,'ordinary respawn rule preserved');
});

test('online renderer starts no solo progression participation',t=>{
  const game=createHeadlessGame();t.after(()=>cleanupGame(game));const events=[];game.events.onProgression=e=>events.push(e);
  const manager=new RoomManager(),room=manager.create('a','A','m4a1');manager.join('b',room.code,'B','m4a1');manager.start('a');
  const snapshot={...manager.snapshot(room),selfEquipment:manager.equipmentSnapshot('a')};
  const online=new OnlineArena(game,{send:()=>true});online.start(snapshot,'a',{});
  assert.deepEqual(events,[]);assert.equal(game.settings.progressionSource,'online');online.stop();
});

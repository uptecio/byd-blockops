import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS } from '../src/maps.js';
import { createBody, moveCharacter } from '../src/character-movement.js';
import { canOccupyBody } from '../src/spatial.js';
import { createNavigation } from '../src/navigation.js';
import { createZombieBrain, stepZombieBrain } from '../src/zombie-brain.js';
import { ZOMBIE_BALANCE, waveConfig } from '../src/zombie-survival.js';
import { createHeadlessGame, cleanupGame } from './helpers/game-fixture.js';
import { accessFixture } from './helpers/access-fixture.js';

const reset = body => assert.deepEqual([body.ladderId,body.ladderDistance,body.ladderBlockedId],[null,0,null]);
function arena(t,settings={}) {
  const game=createHeadlessGame(); t.after(()=>cleanupGame(game));
  game.start('m4a1',{bots:1,mapId:'harbor',...settings});
  game.player.protected=1000; for(const b of game.bots) b.cooldown=1000;
  return game;
}
function place(game,p) {
  const body=createBody(p,game.world.spatial,{radius:.34});
  Object.assign(game.player,body,{jump:body.y}); game.placeCamera();
}
function climb(game) {
  const ladder=game.world.spatial.ladders[0]; place(game,ladder.bottom.point);
  game.input.keys.add('KeyW'); game.update(.5); game.input.clear();
  assert.equal(game.player.ladderId,ladder.id); assert.ok(game.player.jump>1);
  return ladder;
}

test('solo pause freezes attached height, resume is neutral, damage holds and death clears traversal',t=>{
  const game=arena(t); game.bots[0].respawn=1000;
  const ladder=climb(game),height=game.player.jump;
  assert.equal(game.camera.position.y,height+1.65);
  game.input.fire=true; game.input.keys.add('KeyW'); game.pause(); game.update(.5);
  assert.equal(game.player.jump,height); assert.equal(game.input.fire,false); assert.equal(game.input.keys.size,0);
  game.resume(); game.update(.1); assert.equal(game.player.jump,height); assert.equal(game.player.ladderId,ladder.id);
  game.player.protected=0; game.damageActor(game.bots[0].id,game.player,10);
  assert.equal(game.player.health,90); assert.equal(game.player.ladderId,ladder.id);
  game.damageActor(game.bots[0].id,game.player,1000); reset(game.player);
  assert.equal(game.getActors()[0].ladderId,null);
  assert.ok(game.lootState.drops.every(d=>d.y<=height));
  game.resetPlayer(); reset(game.player); assert.equal(game.player.jump,0);
});

test('Home, invalid-map recovery, rematches and repeated map changes discard old attachments and held input',t=>{
  const game=arena(t);
  for(const map of MAPS) {
    game.start('m4a1',{bots:0,mapId:'harbor'}); climb(game);
    const oldNavigation=game.navigation,oldGroup=game.world.group;
    game.input.keys.add('KeyW'); game.input.fire=true;
    game.start('m4a1',{bots:0,mapId:map.id}); reset(game.player);
    assert.equal(game.input.keys.size,0); assert.equal(game.input.fire,false);
    assert.equal(oldNavigation.stats().cachedFields,0); assert.notEqual(game.navigation,oldNavigation);
    if(oldGroup) assert.equal(oldGroup.parent,null);
  }
  game.start('m4a1',{bots:0,mapId:'harbor'}); climb(game); game.quit(); reset(game.player);
  game.start('m4a1',{bots:0,mapId:'harbor'}); climb(game);
  game.input.fire=true; assert.equal(game.tryStart('m4a1',{mapId:'missing-map'}).ok,false);
  assert.equal(game.hasRound,false); assert.equal(game.active,false); reset(game.player); assert.equal(game.input.fire,false);
});

test('actual Hide clears old climb guards and immediately erases remembered ladder goals',t=>{
  const game=arena(t),spot=game.world.definition.hideSpots[0],bot=game.bots[0];
  place(game,spot.entry); game.player.ladderBlockedId=game.world.spatial.ladders[0].id;
  bot.lastKnownTargets.set('local',{...game.getActors()[0],ladderId:game.world.spatial.ladders[0].id});
  bot.intent={goal:bot.lastKnownTargets.get('local'),targetId:'local'};
  assert.equal(game.requestHide({kind:'enter',spotId:spot.id}).ok,true);
  reset(game.player); assert.equal(bot.intent.targetId,null); assert.equal(bot.intent.goal,null);
  assert.equal(bot.lastKnownTargets.has('local'),false);
});

for(const kind of ['walker','runner']) test(`${kind} follows a perceived intermediate ladder goal and shares the shaft without separation`,()=>{
  const f=accessFixture(),navigation=createNavigation(f.map,{radius:.4});
  const player={id:'local',x:0,y:1.6,z:-1.5,ladderId:f.ladderId,alive:true,yaw:0,pitch:0,protectedRemaining:0};
  let actor={id:'z1',kind,...createBody(f.start,f.world),alive:true,yaw:0,pitch:0,flashRemaining:0};
  const brain=createZombieBrain(kind),context=()=>({actor,player,zombies:[{...actor,id:'z2'}],navigation,world:f.world,solids:f.world.solids,smokes:[],dt:1/60});
  for(let n=0;n<100;n++) {
    const next=stepZombieBrain(brain,context()); actor={...actor,...next.body,yaw:next.yaw};
    assert.equal(brain.goal?.ladderId,f.ladderId);
  }
  assert.ok(Math.abs(actor.y-player.y)<.01); assert.equal(actor.ladderId,f.ladderId);
  const held=stepZombieBrain(brain,{...context(),actor:{...actor,flashRemaining:1}});
  for(const key of ['x','y','z','velocityY','grounded','supportId','ladderId','ladderDistance','ladderBlockedId']) assert.equal(held.body[key],actor[key],key);
  player.hiddenSpotId='hidden'; stepZombieBrain(brain,context()); assert.equal(brain.targetId,null);
});

test('ordinary bots retain perceived ladder identity and reach the actual intermediate height',t=>{
  const game=arena(t),f=accessFixture();
  Object.assign(game.world,{definition:f.map,spatial:f.world,solids:f.world.solids}); game.navigation=createNavigation(f.map,{radius:.4});
  const body=moveCharacter(createBody(f.start,f.world),{vx:0,vz:0,climb:1},.25,{world:f.world}).body;
  const target=moveCharacter(body,{vx:0,vz:0,climb:1},.25,{world:f.world}).body;
  Object.assign(game.player,target,{jump:target.y,protected:0});
  const bot=game.bots[0]; bot.body=createBody(f.start,f.world); bot.model.position.set(bot.body.x,bot.body.y,bot.body.z);
  for(let n=0;n<90;n++) {
    game.updateBots(1/60); assert.equal(bot.intent.goal?.ladderId,f.ladderId);
  }
  assert.equal(bot.body.ladderId,f.ladderId); assert.ok(Math.abs(bot.body.y-target.y)<.01);
  assert.equal(bot.model.position.y,bot.body.y); assert.equal(bot.lastKnownTargets.get('local').ladderId,f.ladderId);
  bot.protected=0; game.damageActor('local',bot,1000); reset(bot.body);
  game.start('m4a1',{bots:1,mapId:'harbor'}); reset(game.bots[0].body);
});

test('two off-center zombies can enter the same ladder without crowd forces barring access',()=>{
  const f=accessFixture(),navigation=createNavigation(f.map,{radius:.4});
  const player={id:'local',x:0,y:1.6,z:-1.5,ladderId:f.ladderId,alive:true,yaw:0,pitch:0,protectedRemaining:0};
  const brains=[createZombieBrain('walker'),createZombieBrain('walker')];
  let actors=[-.2,.2].map((x,i)=>({id:`z${i}`,kind:'walker',...createBody({...f.start,x},f.world),alive:true,yaw:0,pitch:0,flashRemaining:0}));
  for(let n=0;n<300;n++) {
    const previous=actors;
    actors=previous.map((actor,i)=>{
      const next=stepZombieBrain(brains[i],{actor,player,zombies:previous,navigation,world:f.world,solids:f.world.solids,smokes:[],dt:1/60});
      return {...actor,...next.body,yaw:next.yaw};
    });
  }
  for(const actor of actors) { assert.equal(actor.ladderId,f.ladderId); assert.ok(Math.abs(actor.y-player.y)<.01); }
});

for(const map of MAPS) test(`${map.id}: live bot and both zombie brains reach an original roof without teleporting`,t=>{
  const game=arena(t,{mapId:map.id}),roof=map.traversal.roofs.find(r=>r.source==='original');
  const start=map.traversal.links.find(l=>l.routeId===roof.routeId).from,bot=game.bots[0];
  bot.body=createBody(start,game.world.spatial); bot.model.position.set(start.x,start.y,start.z);
  bot.intent={goal:roof.point,targetId:null}; bot.intentTimer=1000;
  for(let n=0;n<3000 && bot.body.supportId!==roof.supportId;n++) game.updateBots(1/60);
  assert.equal(bot.body.supportId,roof.supportId); assert.equal(bot.model.position.y,roof.point.y);
  const a=roof.standingArea,player={id:'local',x:(a.minX+a.maxX)/2,y:roof.point.y,z:(a.minZ+a.maxZ)/2,alive:true,yaw:0,pitch:0,protectedRemaining:0};
  for(const kind of ['walker','runner']) {
    const brain=createZombieBrain(kind); brain.goal={...player}; brain.targetId=player.id;
    let actor={id:`z-${kind}`,kind,...createBody(start,game.world.spatial),alive:true,yaw:0,pitch:0,flashRemaining:0};
    for(let n=0;n<3000 && actor.supportId!==roof.supportId;n++) {
      const next=stepZombieBrain(brain,{actor,player,zombies:[],navigation:game.navigation,world:game.world.spatial,solids:game.world.solids,smokes:[],dt:1/60});
      assert.ok(canOccupyBody(next.body,.4,1.84,game.world.spatial));
      assert.ok(Math.hypot(next.body.x-actor.x,next.body.z-actor.z)<=Math.max(2.4,ZOMBIE_BALANCE[kind].speed)/60+1e-7);
      actor={...actor,...next.body,yaw:next.yaw};
    }
    assert.equal(actor.supportId,roof.supportId,`${kind}: ${JSON.stringify(actor)}`);
  }
});

test('maximum-population waves spawn and make physical ladder progress while the player holds midway',t=>{
  const game=arena(t,{bots:0,modeId:'zombies'}),ladder=climb(game),state=game.modeState;
  game.player.protected=1000;
  // Advance to the first runner wave using the production wave configuration.
  for(const z of [...game.bots]) game.damageActor('local',z,1000);
  game.zombieRuntime.finishStep();
  Object.assign(state,{wave:3,queued:waveConfig(3).total,spawned:0,spawnRemaining:0,completedWaves:2});
  let maximum=0; const climbed=new Set();
  for(let n=0;n<2400 && state.phase==='fighting';n++) {
    game.update(.05); maximum=Math.max(maximum,game.bots.length);
    for(const z of [...game.bots]) {
      assert.ok(game.navigation.reachable(z.body,game.getActors()[0]));
      if(n>200 && z.body.ladderId===ladder.id && z.body.y>.25) {
        climbed.add(z.id); game.damageActor('local',z,1000);
      }
    }
    game.zombieRuntime.finishStep();
  }
  assert.equal(maximum,ZOMBIE_BALANCE.maxAlive); assert.equal(climbed.size,waveConfig(3).total);
  assert.equal(state.phase,'recovery'); assert.equal(state.completedWaves,3); assert.equal(game.player.ladderId,ladder.id);
  game.update(ZOMBIE_BALANCE.recoverySeconds); assert.equal(state.wave,4); assert.equal(state.phase,'fighting');
  assert.equal(game.player.ladderId,ladder.id);
});

test('Zombies death while climbing clears attachment before the terminal view and rematch',t=>{
  const game=arena(t,{bots:0,modeId:'zombies'}); climb(game);
  game.player.protected=0; game.input.fire=true;
  game.damageActor(game.bots[0].id,game.player,1000);
  reset(game.player); assert.equal(game.modeState.ended,true); assert.equal(game.active,false); assert.equal(game.input.fire,false);
  game.start('m4a1',{modeId:'zombies',mapId:'harbor'}); reset(game.player);
  assert.equal(game.modeState.wave,1); assert.equal(game.player.health,100);
});

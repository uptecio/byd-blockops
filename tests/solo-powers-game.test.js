import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeadlessGame, cleanupGame, positionBot, setWorldSolids } from './helpers/game-fixture.js';
import { defaultSoloPowers } from '../src/solo-powers.js';
import { WEAPONS } from '../src/weapons.js';
import { MAPS } from '../src/maps.js';
import { pickupEquipment, equipmentDTO, equipmentFromDTO } from '../src/equipment.js';
import { createBody } from '../src/character-movement.js';
import { canOccupyBody } from '../src/spatial.js';
import { OnlineArena } from '../src/online-game.js';
import { RoomManager } from '../server/rooms.js';

const all = {invincible:true,unlimitedAmmo:true,superSpeed:true,speedMultiplier:5};
const off = {invincible:false,unlimitedAmmo:false,superSpeed:false,speedMultiplier:2};
const powers = patch => ({...off,...patch});
const near = (actual,want,tolerance=1e-8) => assert.ok(Math.abs(actual-want)<tolerance,`${actual} != ${want}`);
function arena(t, settings={}, config=all, weaponId='m4a1') {
  const game=createHeadlessGame(); t.after(()=>cleanupGame(game));
  game.start(weaponId,{bots:0,...settings},config);
  return game;
}
function place(game, point) {
  const body=createBody(point,game.world.spatial,{radius:.34});
  Object.assign(game.player,body,{jump:body.y,protected:0}); game.placeCamera();
}
function empty(game) { setWorldSolids(game,[]); place(game,{x:0,y:0,z:10}); }
function assertValidEquipment(game) {
  const dto=equipmentDTO(game.player.equipment);
  assert.deepEqual(equipmentDTO(equipmentFromDTO(dto)),dto);
  assert.ok(dto.owned.every(g=>Number.isFinite(g.ammo) && Number.isFinite(g.reserve) && g.ammo+g.reserve<=500));
}
function clearWave(game) {
  for(let i=0;i<200 && game.modeState.phase==='fighting';i++) {
    game.update(.25);
    for(const zombie of game.bots) if(zombie.health>0) game.damageActor('local',zombie,100);
    game.zombieRuntime.finishStep();
  }
  assert.equal(game.modeState.phase,'recovery');
}

test('power updates require an exact valid live solo round and return detached copies', t=>{
  const game=createHeadlessGame();t.after(()=>cleanupGame(game));
  assert.deepEqual(game.getSoloPowers(),off); assert.equal(game.setSoloPowers(all).ok,false);
  game.start('m4a1',{bots:0},all);
  assert.deepEqual(game.getSoloPowers(),all);
  const copy=game.getSoloPowers();copy.invincible=false;assert.equal(game.getSoloPowers().invincible,true);
  for(const bad of [null,{}, {...all,speedMultiplier:6}, {...all,extra:true}]) {
    assert.equal(game.setSoloPowers(bad).ok,false);assert.deepEqual(game.getSoloPowers(),all);
  }
  const previous=game.modeState;
  game.pause();assert.equal(game.setSoloPowers(powers({superSpeed:true,speedMultiplier:2.34}),previous).ok,true);
  assert.equal(game.active,false);assert.equal(game.getSoloPowers().speedMultiplier,2.3);
  game.start('m4a1',{bots:0});assert.equal(game.setSoloPowers(all,previous).ok,false);
  assert.deepEqual(game.getSoloPowers(),off);
  game.quit(); assert.equal(game.setSoloPowers(all).ok,false);
});

for(const modeId of ['ffa','tdm','ctf','zombies']) test(`${modeId}: pause retains powers; finish, quit, failed start and replay reset`,t=>{
  const game=arena(t,{modeId});assert.deepEqual(game.getSoloPowers(),all);
  game.pause();game.update(.25);assert.deepEqual(game.getSoloPowers(),all);game.resume();
  game.quit();assert.deepEqual(game.getSoloPowers(),off);
  game.start('m4a1',{modeId,bots:0},all);
  game.modeState.ended=true;game.finishRound();assert.deepEqual(game.getSoloPowers(),off);
  assert.equal(game.setSoloPowers(all).ok,false);
  game.start('m4a1',{modeId,bots:0});assert.deepEqual(game.getSoloPowers(),off);
  game.setSoloPowers(all);
  assert.equal(game.tryStart('m4a1',{modeId,mapId:'missing-map'},all).ok,false);
  assert.deepEqual(game.getSoloPowers(),off);assert.equal(game.active,false);
  assert.equal(game.tryStart('m4a1',{modeId,bots:0},{...all,unlimitedAmmo:'yes'}).ok,true);
  assert.deepEqual(game.getSoloPowers(),off);
});

test('invincibility blocks lethal health/armour damage before death and never heals or revives',t=>{
  const game=arena(t,{bots:1},off),bot=game.bots[0];
  game.player.protected=0;game.player.health=43;game.player.armour=17;
  game.setSoloPowers(powers({invincible:true}));
  assert.equal(game.damageActor(bot.id,game.player,10000000000,game.getActors()),false);
  assert.deepEqual([game.player.health,game.player.armour,game.player.dead],[43,17,0]);
  game.setSoloPowers(off);assert.equal(game.damageActor(bot.id,game.player,10),true);
  assert.ok(game.player.health<43 || game.player.armour<17);
  game.damageActor(bot.id,game.player,10000000000);
  game.setSoloPowers(powers({invincible:true}));assert.equal(game.player.health,0);assert.ok(game.player.dead>0);
  game.resetPlayer();game.player.protected=0;
  assert.equal(game.damageActor(bot.id,game.player,10000000000),false);
  assert.equal(game.player.health,100);assert.equal(game.getSoloPowers().invincible,true);
});

for(const kind of ['bullet','knife','frag']) test(`real bot ${kind} respects only local invincibility`,t=>{
  t.mock.method(Math,'random',()=>0);
  const game=arena(t,{bots:1}),bot=game.bots[0];empty(game);
  positionBot(bot,0,0,kind==='knife'?11.2:0);bot.protected=0;
  game.botTuning={speed:0,interval:.95,accuracy:1,damage:8};
  const attack=()=>{
    if(kind==='bullet') {bot.cooldown=0;bot.weaponState.cooldown=0;game.updateBots(.01);}
    if(kind==='knife') {
      pickupEquipment(bot.equipment,{kind:'knife'});bot.equipment.heldItem='knife';bot.equipment.meleeRemaining=0;bot.yaw=0;
      game.slash(game.actorRecord(bot));
    }
    if(kind==='frag') {
      game.gearCombatState.projectiles.push({id:'power-test',grenadeType:'frag',ownerId:bot.id,ownerLifeId:bot.lifeId,
        x:0,y:.12,z:10,vx:0,vy:0,vz:0,fuseRemaining:0});
      bot.cooldown=100;game.update(.01);
    }
  };
  attack();assert.equal(game.player.health,100);
  if(kind==='bullet')assert.equal(bot.weaponState.ammo,29,'bot ammo still decreases');
  game.setSoloPowers(off);attack();assert.ok(game.player.health<100,`${kind} must really reach the player`);
});

test('team bots are not invincible and friendly fire remains blocked',t=>{
  const game=arena(t,{modeId:'tdm',bots:2});
  const enemy=game.bots.find(b=>b.teamId!==game.player.teamId),friend=game.bots.find(b=>b.teamId===game.player.teamId);
  friend.protected=enemy.protected=0;
  assert.equal(game.damageActor('local',friend,10),false);
  assert.equal(game.damageActor(enemy.id,friend,10),true);assert.equal(friend.health,90);
  assert.equal(game.damageActor('local',enemy,10),true);assert.equal(enemy.health,90);
});

test('real zombie slash cannot end an invincible run, then ordinary damage resumes',t=>{
  const game=arena(t,{modeId:'zombies'});game.update(.01);empty(game);
  const zombie=game.bots[0];positionBot(zombie,0,0,8.9);zombie.brain.attackRemaining=0;
  game.player.health=5;game.update(.01);
  assert.equal(game.player.health,5);assert.equal(game.modeState.ended,false);
  game.setSoloPowers(off);zombie.brain.attackRemaining=0;game.update(.01);
  assert.equal(game.player.health,0);assert.equal(game.modeState.ended,true);
  assert.equal(game.setSoloPowers(all).ok,false);assert.deepEqual(game.getSoloPowers(),off);
});

for(const weapon of WEAPONS) test(`${weapon.name}: unlimited ammo preserves fire interval, trigger semantics, finite DTO and normal disable`,t=>{
  const game=arena(t,{},off,weapon.id);empty(game);
  let shots=0,reloads=0;game.audio.shoot=()=>shots++;game.audio.reload=()=>reloads++;
  Object.assign(game.weaponState,{ammo:0,reserve:500,cooldown:.02,reloadRemaining:weapon.reloadTime});
  game.setSoloPowers(powers({unlimitedAmmo:true}));
  assert.equal(game.weaponState.ammo,weapon.magazine);assert.equal(game.weaponState.reserve,500-weapon.magazine);
  assert.equal(game.weaponState.reloadRemaining,0);assert.equal(game.weaponState.cooldown,.02);
  game.input.fire=game.input.firePressed=game.input.reload=true;game.update(.001);assert.equal(shots,0);assert.equal(reloads,0);
  game.input.fire=false;game.update(.021);game.input.fire=game.input.firePressed=true;game.update(.001);
  assert.equal(shots,1);assert.equal(game.weaponState.ammo,weapon.magazine);
  game.setSoloPowers(off);game.setSoloPowers(powers({unlimitedAmmo:true}));
  game.input.firePressed=true;game.update(.001);assert.equal(shots,1,'toggle cannot remove the existing cooldown');
  if(!weapon.automatic) {game.update(weapon.fireInterval+.01);assert.equal(shots,1,'holding semiauto is not rapid fire');}
  else {game.input.fire=false;game.update(weapon.fireInterval+.01);}
  game.input.fire=game.input.firePressed=true;game.update(.001);assert.equal(shots,2);
  assertValidEquipment(game);
  const before=equipmentDTO(game.player.equipment);game.setSoloPowers(off);assert.deepEqual(equipmentDTO(game.player.equipment),before);
  game.input.fire=false;game.update(weapon.fireInterval+.01);
  game.input.firePressed=true;game.update(.001);assert.equal(game.weaponState.ammo,weapon.magazine-1);
  game.input.reload=true;game.update(.001);assert.ok(game.weaponState.reloadRemaining>0);assert.equal(reloads,1);
});

test('pickups, switching, respawn and supplies retain the ammo invariant without granting other loot',t=>{
  const game=arena(t);empty(game);const e=game.player.equipment;
  assert.equal(pickupEquipment(e,{kind:'gun',weaponId:'awp',ammo:0,reserve:0}).ok,true);
  pickupEquipment(e,{kind:'knife'});pickupEquipment(e,{kind:'grenade',grenadeType:'frag'});
  pickupEquipment(e,{kind:'supply',supplyType:'health'});
  assert.equal(game.requestEquipment({kind:'equip-gun',weaponId:'awp',source:'inventory'}).ok,true);
  assert.equal(game.weaponState.ammo,5);assert.equal(game.weaponState.reserve,0);assertValidEquipment(game);
  game.setSoloPowers(off);assert.equal(game.weaponState.reserve,0,'no fresh reserve granted');game.setSoloPowers(all);
  const inventory={grenades:{...e.grenades},supplies:{...e.supplies},knife:e.knife};
  game.player.health=40;assert.equal(game.requestEquipment({kind:'use-supply',supplyType:'health'}).ok,true);
  let shots=0;game.audio.shoot=()=>shots++;game.input.fire=game.input.firePressed=true;game.update(.1);
  assert.equal(shots,0);assert.deepEqual({grenades:e.grenades,supplies:e.supplies,knife:e.knife},inventory);
  game.requestEquipment({kind:'cancel-supply'});game.input.clear();
  assert.equal(game.requestEquipment({kind:'throw',grenadeType:'frag'}).ok,true);assert.equal(e.grenades.frag,0);
  game.input.fire=game.input.firePressed=true;game.update(.01);assert.equal(shots,0,'throw lock remains');
  game.resetPlayer();assert.deepEqual(game.getSoloPowers(),all);assertValidEquipment(game);
});

test('normal powered kill, completion and early-quit XP are unchanged and awarded once',t=>{
  const game=arena(t,{bots:1}),events=[];game.events.onProgression=e=>events.push(e);
  const bot=game.bots[0];bot.protected=0;
  game.damageActor('local',bot,10000000000);assert.equal(events.at(-1).tally.earnedTotal,10);
  game.modeState.timeLeft=.01;game.update(.01);
  assert.equal(events.at(-1).tally.earnedTotal,85);assert.deepEqual(game.getSoloPowers(),off);
  const count=events.length;game.finishRound();assert.equal(events.length,count);
  game.start('m4a1',{bots:1},all);game.bots[0].protected=0;game.damageActor('local',game.bots[0],10000000000);
  game.quit();assert.equal(events.at(-1).tally.earnedTotal,10);assert.equal(events.at(-1).tally.completed,false);
});

test('assisted zombie wave earns ordinary XP and best-record events while recovery still blocks gunfire',t=>{
  const game=arena(t,{modeId:'zombies'}),events=[],records=[];
  game.events.onProgression=e=>events.push(e);game.events.onSurvivalRecord=r=>records.push(r);
  clearWave(game);assert.equal(events.at(-1).tally.earnedTotal,35);
  assert.deepEqual(records.at(-1),{mapId:'courtyard',waves:1,kills:5});
  let shots=0;game.audio.shoot=()=>shots++;game.input.fire=game.input.firePressed=true;game.update(.25);
  assert.equal(shots,0);assert.deepEqual(game.getSoloPowers(),all);
  game.quit();assert.equal(events.at(-1).tally.earnedTotal,35);assert.deepEqual(records.at(-1),{mapId:'courtyard',waves:1,kills:5});
});

for(const [weaponId,speed] of [['m4a1',5.3],['m249',4.4],['mp5',6],['g17',6]]) {
  for(const zoom of [false,true]) for(const multiplier of [1,2,5]) test(`${weaponId}, aim=${zoom}: horizontal speed is ${multiplier}x including airborne input`,t=>{
    const game=arena(t,{},powers({superSpeed:multiplier!==1,speedMultiplier:multiplier===1?2:multiplier}),weaponId);empty(game);
    game.input.zoom=zoom;game.input.keys.add('KeyD');game.update(.1);
    near(game.player.x,speed*(zoom?.65:1)*multiplier*.1);
    place(game,{x:0,y:2,z:10});game.input.keys.add('KeyD');game.input.zoom=zoom;game.update(.1);
    near(game.player.x,speed*(zoom?.65:1)*multiplier*.1);assert.ok(game.player.jump<2);
  });
}

test('speed affects neither jump/gravity nor ladder climbing speed',t=>{
  const outcomes=[];
  for(const config of [off,all]) {
    const game=arena(t,{mapId:'harbor'},config),ladder=game.world.spatial.ladders[0];
    place(game,ladder.bottom.point);game.input.keys.add('KeyW');game.update(.25);
    outcomes.push({height:game.player.jump,id:game.player.ladderId});
    assert.equal(game.player.ladderId,ladder.id);near(game.player.jump,.6);
    empty(game);game.input.clear();game.input.jump=true;game.update(1/120);
    outcomes.at(-1).jump=game.player.jump;outcomes.at(-1).velocity=game.player.velocityY;
  }
  near(outcomes[0].height,outcomes[1].height);
  assert.equal(outcomes[0].id,outcomes[1].id);
  assert.equal(outcomes[0].jump,outcomes[1].jump);
  assert.equal(outcomes[0].velocity,outcomes[1].velocity);
});

for(const map of MAPS) test(`${map.id}: maximum speed respects authored walls, roofs, hiding and bounds at low and high frame rates`,t=>{
  const game=arena(t,{mapId:map.id});
  for(const dt of [1/120,1/30,.25]) {
    const valid=()=>{
      const body={...game.player,y:game.player.jump};
      assert.equal(canOccupyBody(body,.34,1.84,game.world.spatial),true);
      assert.ok([body.x,body.y,body.z,body.velocityY].every(Number.isFinite));
      assert.ok(body.y>=0 && body.x>=map.bounds.min+.34-1e-8 && body.x<=map.bounds.max-.34+1e-8);
      assert.ok(body.z>=map.bounds.min+.34-1e-8 && body.z<=map.bounds.max-.34+1e-8);
    };
    const wall=map.solids.find(s=>s.minY===0 && s.maxY>2
      && canOccupyBody({x:s.x-s.w/2-.4,y:0,z:s.z},.34,1.84,game.world.spatial));
    assert.ok(wall,'authored wall with a clear approach');
    place(game,{x:wall.x-wall.w/2-.4,y:0,z:wall.z});game.yaw=0;game.input.clear();game.input.keys.add('KeyD');
    for(let i=0;i<10;i++){game.update(dt);valid();}
    assert.ok(game.player.x<=wall.x-wall.w/2-.34+1e-8,'does not tunnel through building');
    for(const roof of map.traversal.roofs) {
      place(game,roof.point);game.input.clear();game.input.keys.add('KeyD');
      for(let i=0;i<3;i++){game.update(dt);valid();}
    }
    const spot=map.hideSpots[0];place(game,spot.entry);game.input.clear();
    assert.equal(game.requestHide({kind:'enter',spotId:spot.id}).ok,true);
    game.input.keys.add('KeyW');game.input.jump=true;game.update(dt);valid();
    assert.equal(game.player.hiddenSpotId,spot.id);near(game.player.x,spot.occupant.x);near(game.player.z,spot.occupant.z);
    game.requestHide({kind:'exit',spotId:spot.id});
    place(game,map.playerSpawn);game.input.clear();game.input.keys.add('KeyS');
    for(let i=0;i<12;i++){game.update(dt);valid();}
  }
});

for(const mapId of ['courtyard','neon-city','desert-fort']) test(`${mapId}: 5x speed climbs a real stair segment without a jump`,t=>{
  const game=arena(t,{mapId}),link=game.world.definition.traversal.links.find(l=>l.kind==='stair');
  place(game,link.from);const dx=link.to.x-link.from.x,dz=link.to.z-link.from.z;
  game.yaw=Math.atan2(-dx,-dz);game.input.keys.add('KeyW');
  game.update(Math.min(.05,Math.hypot(dx,dz)/(5.3*5)));
  assert.ok(game.player.jump>link.from.y);assert.equal(game.player.grounded,true);
  assert.equal(canOccupyBody({...game.player,y:game.player.jump},.34,1.84,game.world.spatial),true);
});

test('real online start and rematch clear powers; snapshots retain normal movement, damage and ammo',t=>{
  const game=arena(t),oldRound=game.modeState;
  const manager=new RoomManager({random:()=>.5}),room=manager.create('a','A','m4a1');
  manager.join('b',room.code,'B','m4a1');manager.start('a');
  const snapshot=()=>({...manager.snapshot(room),selfEquipment:manager.equipmentSnapshot('a')});
  const online=new OnlineArena(game,{send:()=>true});t.after(()=>online.stop());
  online.start(snapshot(),'a',{});assert.deepEqual(game.getSoloPowers(),off);
  assert.equal(game.setSoloPowers(all,oldRound).ok,false);assert.equal(game.setSoloPowers(all).ok,false);
  const a=room.players.get('a');a.protectedRemaining=0;
  manager.damage(room,'b',a,10);
  manager.input('a',{lifeId:a.lifeId,x:1,y:0,yaw:0,pitch:0,fire:true,firePressed:true});
  const start=a.x;manager.tick(1/30);const state=snapshot();online.sync(state,true);
  assert.equal(game.player.health,90);assert.equal(game.weaponState.ammo,29);near(a.x-start,5.3/30);
  assert.equal(game.player.x,a.x);assertValidEquipment(game);
  manager.tick(180);manager.start('a');online.start(snapshot(),'a',{});
  assert.deepEqual(game.getSoloPowers(),off);assert.equal(game.setSoloPowers(all).ok,false);
  online.stop();game.start('m4a1',{bots:0});assert.deepEqual(game.getSoloPowers(),off);
});

test('online source explicitly ignores valid third-argument powers and settings cannot enable solo powers',t=>{
  const game=arena(t,{progressionSource:'online'},all);
  assert.deepEqual(game.getSoloPowers(),off);assert.equal(game.setSoloPowers(all).ok,false);
  game.start('m4a1',{bots:0,soloPowers:all});assert.deepEqual(game.getSoloPowers(),off);
  game.resetSoloPowers();assert.deepEqual(game.getSoloPowers(),defaultSoloPowers());
});

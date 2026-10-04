import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeadlessGame, cleanupGame } from './helpers/game-fixture.js';
import { pickupEquipment, equipmentDTO } from '../src/equipment.js';
import { OnlineArena } from '../src/online-game.js';
import { RoomManager } from '../server/rooms.js';

function arena(t,gun='m4a1') {
  const game=createHeadlessGame(); t.after(()=>cleanupGame(game));
  game.start(gun,{ modeId:'zombies',mapId:'courtyard',skinId:'shadow-ninja' });
  return game;
}
function clearWave(game) {
  for (let i=0;i<1000 && game.modeState.phase==='fighting';i++) {
    game.player.protected=1000; game.update(.25);
    for (const z of game.bots) if (z.health>0) game.damageActor('local',z,100);
    game.zombieRuntime.finishStep();
  }
  assert.equal(game.modeState.phase,'recovery');
}
function target(game) {
  game.update(.05); const z=game.bots[0];
  game.world.solids=[]; z.model.position.set(0,0,0);
  Object.assign(game.player,{ x:0,z:10,protected:0 }); game.yaw=0; game.pitch=0; game.placeCamera();
  return z;
}

test('solo survival starts chosen skin/gun with no armed bots, stable identity and endless timer', t=>{
  const game=arena(t),identity=game.modeState;
  assert.equal(game.player.skinId,'shadow-ninja');
  game.player.protected=1000; game.update(.05);
  assert.equal(game.getMatchView().survival.wave,1);
  assert.equal(game.getMatchView().survival.remaining,5);
  assert.ok(game.bots.every(z=>!z.equipment && !z.model.getObjectByName('weapon')));
  game.pause(); const before=game.getMatchView().survival.elapsed;
  game.update(1); assert.equal(game.getMatchView().survival.elapsed,before);
  game.resume(); game.update(181);
  assert.ok(game.getMatchView().survival.elapsed>180);
  assert.equal(game.modeState.ended,false); assert.equal(game.modeState,identity);
  assert.equal(game.bots.length,5);
});

for (const gun of ['m4a1','m870']) test(`${gun} headshot is exactly ten billion once and corpses cannot absorb later pellets`, t=>{
  t.mock.method(Math,'random',()=>.5);
  const game=arena(t,gun),z=target(game),amounts=[],damage=game.damageActor.bind(game);
  game.damageActor=(...args)=>{ amounts.push(args[2]); return damage(...args); };
  game.shoot(false);
  assert.deepEqual(amounts,[10000000000]); assert.equal(z.health,0);
  assert.equal(game.modeState.kills,1); assert.equal(game.modeState.activeIds.size,0);
  game.shoot(false); assert.equal(amounts.length,1);
  assert.equal(game.lootState.drops.length,0); assert.equal(z.respawn,0);
  game.zombieRuntime.finishStep(); assert.equal(z.model.parent,null); assert.equal(game.bots.length,0);
  assert.equal(game.modeState.queued,4);
});

test('two real knife slashes kill a zombie without loot or duplicate death', t=>{
  const game=arena(t),z=target(game); game.player.z=1.2;
  pickupEquipment(game.player.equipment,{ kind:'knife' });
  game.requestEquipment({ kind:'held-item',heldItem:'knife' });
  game.input.fire=true; game.update(.01); assert.equal(z.health,50);
  game.update(.61); assert.equal(z.health,0); assert.equal(game.modeState.kills,1);
  assert.equal(game.lootState.drops.length,0);
});

test('frag uses existing falloff and cap, smoke/flash affect only pursuit and slash', t=>{
  const game=arena(t),z=target(game);
  game.player.equipment.grenades.frag=1;
  assert.equal(game.requestEquipment({ kind:'throw',grenadeType:'frag' }).ok,true);
  Object.assign(game.gearCombatState.projectiles[0],{ x:0,y:.12,z:0,vx:0,vy:0,vz:0,fuseRemaining:.01 });
  game.update(.02); assert.ok(z.health>=10 && z.health<100);
  z.model.position.set(0,0,8.9); z.brain.attackRemaining=0; z.flashRemaining=1;
  const health=game.player.health; game.update(.05);
  assert.equal(game.player.health,health); assert.equal(z.model.position.z,8.9);
  z.flashRemaining=0;
  game.gearCombatState.smokes.push({ id:'smoke',x:0,y:1.6,z:9.5,radius:3,remaining:3 });
  game.update(.05); assert.equal(game.player.health,health);
  game.gearCombatState.smokes=[]; game.player.protected=1; game.update(.05);
  assert.equal(game.player.health,health);
  game.player.protected=0; game.update(.05); assert.equal(game.player.health,health-20);
});

test('recovery retains inventory and choice, refills 500 each and blocks all attacks for ten seconds', t=>{
  const game=arena(t),identity=game.modeState,e=game.player.equipment,records=[];
  game.events.onSurvivalRecord=r=>records.push(r);
  game.requestEquipment({ kind:'equip-gun',weaponId:'mp5',source:'armory' });
  assert.equal(pickupEquipment(e,{ kind:'gun',weaponId:'scar',ammo:1,reserve:3 }).ok,true);
  pickupEquipment(e,{ kind:'knife' });
  e.grenades.smoke=2; e.selectedGrenade='smoke'; e.heldItem='knife'; game.syncPlayerEquipment();
  for (const gun of e.owned.values()) { gun.ammo=1; gun.reserve=3; gun.reloadRemaining=1; }
  game.player.health=5;
  clearWave(game);
  assert.equal(game.modeState,identity); assert.equal(game.player.health,100);
  assert.deepEqual([...e.owned.keys()],['mp5','scar']); assert.equal(e.startingGunRemoved,true);
  assert.equal(e.heldItem,'knife'); assert.equal(e.activeGunId,'mp5'); assert.equal(e.grenades.smoke,2);
  for (const gun of e.owned.values()) assert.equal(gun.ammo+gun.reserve,500);
  assert.equal(game.modeState.recoveryRemaining,10); assert.equal(records.length,1);
  game.input.fire=true; game.update(.05); assert.equal(e.meleeRemaining,0);
  game.requestEquipment({ kind:'held-item',heldItem:'gun' });
  assert.equal(game.requestEquipment({ kind:'throw',grenadeType:'smoke' }).ok,false);
  const ammo=game.weaponState.ammo; game.update(.05); assert.equal(game.weaponState.ammo,ammo);
  assert.equal(game.gearCombatState.projectiles.length,0);
  game.pause(); const left=game.modeState.recoveryRemaining; game.update(20); assert.equal(game.modeState.recoveryRemaining,left);
  game.resume(); game.input.fire=false; game.update(9.85); assert.equal(game.modeState.phase,'recovery');
  game.update(.05); assert.equal(game.modeState.phase,'fighting'); assert.equal(game.modeState.wave,2);
  e.owned.get('scar').ammo=1; e.owned.get('scar').reserve=2;
  game.requestEquipment({ kind:'equip-gun',weaponId:'scar',source:'inventory' });
  assert.equal(game.weaponState.ammo+game.weaponState.reserve,3,'switching alone never refills');
});

test('recovery removes pending smoke and combat visuals while retaining loot and equipment', t=>{
  const game=arena(t),loot=game.lootState,e=game.player.equipment;
  game.player.protected=1000;
  for(let i=0;i<4;i++) {
    game.update(1.01);for(const z of game.bots)game.damageActor('local',z,100);game.zombieRuntime.finishStep();
  }
  game.update(1.01);
  assert.equal(game.modeState.queued,0);assert.equal(game.bots.length,1);
  pickupEquipment(e,{kind:'knife'});e.grenades.smoke=2;e.selectedGrenade='smoke';
  assert.equal(game.requestEquipment({kind:'throw',grenadeType:'smoke'}).ok,true);
  game.gearCombatState.smokes.push({id:'existing',x:0,y:1.6,z:0,radius:3,remaining:8});
  game.gearView.event({id:999,type:'grenade-burst',grenadeType:'frag',position:{x:0,y:0,z:0}});
  game.refreshGearView();
  const slots=loot.slots.map(s=>({id:s.id,present:s.present}));
  assert.ok(game.gearView.loot.size>0);assert.ok(game.gearView.projectiles.size>0);
  assert.ok(game.gearView.smokes.size>0);assert.ok(game.gearView.bursts.size>0);
  game.tracer(game.camera.position.clone(),game.camera.position.clone().addScalar(1),'#ffffff');
  const tracer=game.effects[0].line;let released=0;
  tracer.geometry.addEventListener('dispose',()=>released++);
  game.player.flashRemaining=3;
  game.damageActor('local',game.bots[0],100);game.zombieRuntime.finishStep();
  assert.equal(game.modeState.phase,'recovery');
  assert.equal(game.gearCombatState.projectiles.length,0);
  assert.equal(game.gearCombatState.smokes.length,0);assert.equal(game.gearCombatState.reservedSmoke,0);
  assert.equal(game.gearCombatState.events.length,0);assert.equal(game.effects.length,0);
  assert.equal(tracer.parent,null);assert.equal(released,1);
  assert.equal(game.player.flashRemaining,0);
  assert.equal(game.gearView.projectiles.size,0);assert.equal(game.gearView.smokes.size,0);
  assert.equal(game.gearView.bursts.size,0);assert.equal(game.gearView.flash.visible,false);
  assert.ok(game.gearView.loot.size>0,'map loot stays visible immediately after cleanup');
  assert.equal(game.lootState,loot);assert.deepEqual(loot.slots.map(s=>({id:s.id,present:s.present})),slots);
  assert.equal(game.player.equipment,e);assert.equal(e.knife,true);assert.equal(e.grenades.smoke,1);
  assert.equal(e.selectedGrenade,'smoke');assert.equal(game.weaponState.ammo+game.weaponState.reserve,500);
  game.update(2.05);assert.equal(game.modeState.phase,'recovery');
  assert.equal(game.gearCombatState.smokes.length,0);assert.equal(game.gearCombatState.projectiles.length,0);
});

test('human death ends once, takes priority over wave recovery and cannot resume or respawn', t=>{
  const game=arena(t),records=[]; let ended=0;
  game.events.onEnd=()=>ended++; game.events.onSurvivalRecord=r=>records.push(r);
  game.update(.05); const z=game.bots[0]; game.player.protected=0;
  game.damageActor(z.id,game.player,100);
  assert.equal(ended,1); assert.equal(records.length,1); assert.equal(game.player.health,0);
  game.zombieRuntime.finishStep(); game.resume(); game.update(10);
  assert.equal(game.active,false); assert.equal(ended,1); assert.equal(game.modeState.completedWaves,0);
  assert.equal(game.lootState.drops.length,0);
});

test('dead-player terminal state takes priority over the last zombie death before settlement', t=>{
  const game=arena(t); game.player.protected=1000;
  for (let i=0;i<4;i++) { game.update(1.01); for(const z of game.bots) game.damageActor('local',z,100); game.zombieRuntime.finishStep(); }
  game.update(1.01); const z=game.bots.find(z=>z.health>0);
  assert.equal(game.modeState.queued,0);
  game.damageActor('local',z,100); game.player.health=0; game.zombieRuntime.finishStep();
  assert.equal(game.modeState.ended,true); assert.equal(game.modeState.completedWaves,0); assert.equal(game.player.health,0);
});

test('failed occupied spawn retries, enemies never collect loot, and actor positions follow movement', t=>{
  const game=arena(t); game.update(.05);
  const z=game.bots[0],slot=game.lootState.slots.find(s=>s.item.kind==='knife');
  z.model.position.set(slot.x,0,slot.z); z.flashRemaining=5; game.update(.05);
  assert.equal(slot.present,true); assert.equal(z.equipment,undefined);
  const before=game.getActors().find(a=>a.id===z.id); z.flashRemaining=0; game.update(.05);
  const after=game.getActors().find(a=>a.id===z.id);
  assert.notDeepEqual([after.x,after.z],[before.x,before.z]);
  assert.equal(after.x,z.model.position.x); assert.equal(after.z,z.model.position.z);
  const old=game.world.definition;
  game.world.definition={ ...old,spawns:[{ x:z.model.position.x,z:z.model.position.z }],playerSpawn:{ x:game.player.x,z:game.player.z },teamSpawns:{ red:[],blue:[] } };
  game.modeState.spawnRemaining=0; const queued=game.modeState.queued;
  game.zombieRuntime.beginStep(.05);
  assert.equal(game.modeState.queued,queued); assert.equal(game.modeState.spawnRemaining,1);
});

test('twenty runtime waves bound live models and dispose all dead resources without history', t=>{
  const game=arena(t); const ids=new Set();
  for(let wave=1;wave<=20;wave++) {
    for(let steps=0;steps<1000 && game.modeState.phase==='fighting';steps++) {
      game.player.protected=1000; game.update(.5);
      assert.ok(game.bots.length<=8); assert.equal(game.world.botGroup.children.length,game.bots.length);
      for(const z of game.bots) { assert.equal(ids.has(z.id),false); ids.add(z.id); game.damageActor('local',z,100); }
      game.zombieRuntime.finishStep();
    }
    assert.equal(game.modeState.completedWaves,wave); assert.equal(game.bots.length,0);
    assert.equal(game.modeState.activeIds.size,0); assert.equal(game.modeState.stats,undefined);
    if(wave<20) game.update(10);
  }
});

test('switching Zombies to ordinary solo and online disposes runtime and restores ordinary rules', t=>{
  const game=arena(t); game.update(.05); const runtime=game.zombieRuntime,model=game.bots[0].model;
  let disposed=0; model.getObjectByName('head').geometry.addEventListener('dispose',()=>disposed++);
  game.input.fire=true; game.start('m4a1',{ modeId:'ffa',bots:1 });
  assert.equal(game.zombieRuntime,null); assert.equal(model.parent,null); assert.equal(disposed,1);
  runtime.dispose(); assert.equal(disposed,1); assert.equal(game.input.fire,false);
  assert.equal(game.modeState.timeLeft,180);
  game.bots[0].protected=0; game.damageActor('local',game.bots[0],100); game.update(2.6); assert.equal(game.bots[0].health,100);
  game.start('m4a1',{ modeId:'zombies' }); game.update(.05); const second=game.bots[0].model;
  const manager=new RoomManager(),room=manager.create('a','Tester','m4a1');
  manager.join('b',room.code,'Friend','m4a1'); manager.start('a');
  const online=new OnlineArena(game,{ send(){ return true; } });
  const snapshot=manager.snapshot(room);
  snapshot.selfEquipment={ equipment:equipmentDTO(room.players.get('a').equipment) };
  online.start(snapshot,'a',{});
  assert.equal(game.zombieRuntime,null); assert.equal(second.parent,null); assert.equal(game.bots.length,0);
  online.stop();
});

test('quit records progress and safely disposes owned enemies', t=>{
  const game=arena(t); const records=[]; game.events.onSurvivalRecord=r=>records.push(r);
  game.update(.05); const model=game.bots[0].model; game.quit(); game.quit();
  assert.equal(model.parent,null); assert.equal(game.bots.length,0); assert.equal(game.zombieRuntime,null);
  assert.equal(records.length,1); assert.equal(game.input.enabled,false);
});

test('wide-screen spawning prefers outside the actual horizontal camera view', t=>{
  const game=arena(t),map=game.world.definition;
  Object.assign(game.player,{ x:0,z:0 }); game.camera.aspect=2; game.camera.fov=75;
  game.world.definition={ ...map,spawns:[{ x:10,z:-10 },{ x:0,z:10 }],playerSpawn:{ x:0,z:0 },teamSpawns:{ red:[],blue:[] } };
  game.zombieRuntime.beginStep(.05);
  assert.equal(game.bots[0].model.position.x,0); assert.equal(game.bots[0].model.position.z,10);
});

test('knife adapter supports omitted snapshots and recovery still allows movement and loot', t=>{
  const game=arena(t),z=target(game); game.player.z=1;
  pickupEquipment(game.player.equipment,{ kind:'knife' }); game.requestEquipment({ kind:'held-item',heldItem:'knife' });
  game.slash(game.getActors()[0]); assert.equal(z.health,50);
  clearWave(game);
  const slot=game.lootState.slots.find(s=>s.present && s.item.kind==='gun' && s.item.weaponId!=='m4a1');
  Object.assign(game.player,{ x:slot.x,z:slot.z }); game.update(.05);
  assert.ok(game.player.equipment.owned.has(slot.item.weaponId));
  const before=game.player.z; game.input.keys.add('KeyW'); game.update(.05);
  assert.notEqual(game.player.z,before); assert.equal(game.modeState.phase,'recovery');
});

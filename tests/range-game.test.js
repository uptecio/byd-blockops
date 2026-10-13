import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeadlessGame, cleanupGame, setWorldSolids } from './helpers/game-fixture.js';
import { WEAPONS } from '../src/weapons.js';
import { equipmentDTO, equipmentFromDTO } from '../src/equipment.js';
import { createBody } from '../src/character-movement.js';
import { RANGE_TARGETS } from '../src/range-map.js';
import { OnlineArena } from '../src/online-game.js';
import { RoomManager } from '../server/rooms.js';

const off = { invincible:false, unlimitedAmmo:false, superSpeed:false, speedMultiplier:2 };
const all = { invincible:true, unlimitedAmmo:true, superSpeed:true, speedMultiplier:5 };
// Only the browser canvas sink is replaced, and only during construction.
function withCanvas(callback, createElement = () => ({ getContext: () => ({ clearRect() {}, fillRect() {}, fillText() {} }) })) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable:true, value:{ createElement } });
  try { return callback(); }
  finally { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; }
}
function arena(t, weaponId='m4a1', powers=null) {
  t.mock.method(Math, 'random', () => .5);
  const game=createHeadlessGame(); t.after(()=>cleanupGame(game));
  assert.equal(typeof game.tryStartRange, 'function', 'live game exposes practice startup');
  assert.deepEqual(withCanvas(()=>game.tryStartRange(weaponId, {progressionSource:'solo'}, powers)), {ok:true});
  return game;
}
function aim(game, targetId='close-dummy', height=1.65, distance=4) {
  const target=RANGE_TARGETS.find(target=>target.id===targetId);
  const body=createBody({x:target.x,y:0,z:target.z+distance},game.world.spatial,{radius:.34});
  Object.assign(game.player,body,{jump:body.y});
  game.yaw=0; game.pitch=Math.atan2(height-1.65,distance); game.recoil=0; game.placeCamera();
}
function fire(game) { game.input.fire=game.input.firePressed=true; game.update(.001); game.input.fire=false; }
function stats(game) { return game.getMatchView().range; }
function validEquipment(game) {
  const dto=equipmentDTO(game.player.equipment);
  assert.deepEqual(equipmentDTO(equipmentFromDTO(dto)),dto);
}

test('practice starts only locally without bots, loot, objectives or enemy actors',t=>{
  const game=arena(t);
  assert.equal(game.bots.length,0); assert.equal(game.lootState,null);
  assert.equal(game.objectives,null); assert.equal(game.navigation,null);
  assert.deepEqual(game.modeState,{kind:'range',ended:false});
  assert.equal(game.getActors().length,1); assert.equal(game.isEnemy('local','close-dummy'),false);
  assert.equal(game.matchView.modeId,'range'); assert.equal(game.matchView.mapId,'shooting-range');
  assert.deepEqual(stats(game),{targetKills:0,shotsFired:0,shotsHit:0,accuracy:0,earnedXP:0});
  assert.deepEqual([game.player.health,game.player.armour,game.player.dead,game.player.lifeId],[100,0,0,1]);
  assert.equal(game.requestEquipment({kind:'held-item',heldItem:'knife'}).ok,false);
  assert.equal(game.requestEquipment({kind:'throw',grenadeType:'frag'}).ok,false);
});

for (const weapon of WEAPONS) test(`${weapon.name}: live trigger consumes one round and awards one precision kill per shot`,t=>{
  const game=arena(t,weapon.id), events=[]; game.events.onProgression=event=>events.push(event);
  aim(game); fire(game);
  assert.equal(game.weaponState.ammo,weapon.magazine-1);
  assert.equal(game.weaponState.cooldown,weapon.fireInterval);
  assert.deepEqual(stats(game),{targetKills:1,shotsFired:1,shotsHit:1,accuracy:100,earnedXP:20});
  assert.equal(events.at(-1).tally.earnedTotal,20);
  assert.equal(game.scene.getObjectByName('close-dummy').visible,false);
  assert.ok(game.effects.length>0); assert.ok(game.recoil>0); assert.ok(game.hitFlash>0);
  fire(game); assert.equal(stats(game).shotsFired,1,'cooldown blocks a second shot');
  validEquipment(game);
});

test('body damage kills for ten XP while bullseye centre kills for twenty immediately',t=>{
  const game=arena(t,'awp'),events=[]; game.events.onProgression=event=>events.push(event);
  aim(game,'close-dummy',1); fire(game);
  assert.equal(stats(game).earnedXP,10); assert.equal(events.at(-1).tally.earnedTotal,10);
  game.update(1.4); aim(game,'close-bullseye',1.35); fire(game);
  assert.equal(stats(game).earnedXP,30); assert.equal(events.at(-1).tally.earnedTotal,30);
  assert.equal(stats(game).targetKills,2);
});

test('real cover blocks hits and damage while misses still count for accuracy',t=>{
  const game=arena(t); aim(game);
  setWorldSolids(game,[{x:-10.3,z:18,w:2,d:.3,height:3}]); fire(game);
  assert.deepEqual(stats(game),{targetKills:0,shotsFired:1,shotsHit:0,accuracy:0,earnedXP:0});
  assert.equal(game.scene.getObjectByName('close-dummy').visible,true);
  setWorldSolids(game,[]); game.update(.1); aim(game); fire(game);
  assert.equal(stats(game).accuracy,50);
});

test('shotgun pellets use falloff and count one shell even when several pellets land',t=>{
  const game=arena(t,'m870'); aim(game,'close-dummy',1,4); fire(game);
  assert.equal(stats(game).targetKills,0,'falloff prevents an otherwise lethal 104-damage shell');
  assert.deepEqual([stats(game).shotsFired,stats(game).shotsHit,stats(game).accuracy],[1,1,100]);
  game.update(.9); aim(game,'close-dummy',1,4); fire(game);
  assert.equal(stats(game).earnedXP,10); assert.equal(stats(game).shotsFired,2);
});

test('targets respawn after exactly five active seconds; pause freezes targets and clears FIRE',t=>{
  const game=arena(t); aim(game); fire(game);
  game.update(4.9); game.input.fire=true; game.pause(); game.update(181);
  assert.equal(game.scene.getObjectByName('close-dummy').visible,false);
  assert.equal(game.input.fire,false); game.resume(); game.update(.1);
  assert.equal(game.scene.getObjectByName('close-dummy').visible,true);
  assert.equal(stats(game).shotsFired,1); aim(game); fire(game);
  assert.equal(stats(game).earnedXP,40);
});

test('a fresh range remains active and nonended after 181 simulated seconds',t=>{
  const game=arena(t); let ended=0; game.events.onEnd=()=>ended++;
  game.update(181);
  assert.equal(game.match.ended,false); assert.equal(game.active,true); assert.equal(ended,0);
  assert.equal(game.bots.length,0); assert.equal(game.lootState,null); assert.equal(stats(game).earnedXP,0);
});

test('switching during reload retains starter, cancels reload, and pause prevents held FIRE leakage',t=>{
  const game=arena(t); aim(game); fire(game); game.input.reload=true; game.update(.01);
  const starter=game.weaponState; assert.ok(starter.reloadRemaining>0);
  game.input.fire=true; game.input.keys.add('KeyF'); game.pause();
  assert.equal(game.requestEquipment({kind:'equip-gun',weaponId:'minigun',source:'armory'}).ok,true);
  assert.equal(starter.reloadRemaining,0);
  assert.equal(game.requestEquipment({kind:'equip-gun',weaponId:'m4a1',source:'inventory'}).ok,true);
  assert.equal(game.weaponState,starter); assert.equal(starter.ammo,29);
  game.resume(); game.update(.2); assert.equal(stats(game).shotsFired,1); validEquipment(game);
  starter.reserve=0; game.input.reload=true; game.update(.01); assert.ok(starter.reloadRemaining>0);
  game.update(2); assert.equal(starter.ammo,30); validEquipment(game);
});

test('range uses the same scoped powers and disabling unlimited ammo restores real magazine depletion',t=>{
  const game=arena(t,'m4a1',all); const session=game.modeState;
  assert.deepEqual(game.getSoloPowers(),all); aim(game); fire(game); assert.equal(game.weaponState.ammo,30);
  game.input.keys.add('KeyD'); const x=game.player.x; game.update(.1); game.input.clear();
  assert.ok(Math.abs(game.player.x-x-2.65)<1e-8);
  assert.equal(game.setSoloPowers(off,session).ok,true); aim(game,'close-bullseye',1.35); fire(game);
  assert.equal(game.weaponState.ammo,29); assert.equal(stats(game).earnedXP,40); validEquipment(game);
  game.quit(); assert.deepEqual(game.getSoloPowers(),off); assert.equal(game.setSoloPowers(all,session).ok,false);
});

test('range substeps respect Minigun fire interval during sustained input',t=>{
  const game=arena(t,'minigun'); game.input.fire=true; game.update(.2);
  assert.ok(stats(game).shotsFired>=6,`only ${stats(game).shotsFired} shots`);
  assert.equal(game.weaponState.ammo,game.weapon.magazine-stats(game).shotsFired);
});

test('Minigun retains thirty shots per second across repeated fifty millisecond frames',t=>{
  const game=arena(t,'minigun'); game.input.fire=true;
  for(let frame=0;frame<30;frame++)game.update(.05);
  assert.equal(stats(game).shotsFired,45);
  assert.equal(game.weaponState.ammo,155); validEquipment(game);
});

test('invalid range source, gun, appearance and ordinary practice starts fail without private attachments',t=>{
  const game=createHeadlessGame(); t.after(()=>cleanupGame(game));
  assert.equal(typeof game.tryStartRange,'function');
  for (const [gun,settings] of [['m4a1',{progressionSource:'online'}],['missing',{}],['m4a1',{skinId:'missing'}],['m4a1',{finishId:'missing'}]]) {
    assert.equal(withCanvas(()=>game.tryStartRange(gun,settings)).ok,false);
    assert.equal(game.scene.getObjectByName('Shooting Range'),undefined); assert.equal(game.active,false);
  }
  assert.equal(game.tryStart('m4a1',{modeId:'range',progressionSource:'online'}).ok,false);
  assert.equal(game.tryStart('m4a1',{mapId:'shooting-range',modeId:'zombies'}).ok,false);
});

test('an unknown range gun is rejected before allocating its private world or target canvases',t=>{
  const game=createHeadlessGame(); t.after(()=>cleanupGame(game)); const originalWorld=game.world;
  let canvases=0;
  const result=withCanvas(()=>game.tryStartRange('unknown-gun'),()=>{canvases++; throw new Error('unexpected canvas allocation');});
  assert.equal(result.ok,false); assert.equal(canvases,0); assert.equal(game.world,originalWorld);
});

test('startup canvas failure disposes attached private world and a fresh retry succeeds',t=>{
  const game=createHeadlessGame(); t.after(()=>cleanupGame(game));
  assert.equal(typeof game.tryStartRange,'function');
  const result=withCanvas(()=>game.tryStartRange('m4a1',{},all),()=>({getContext:()=>null}));
  assert.equal(result.ok,false); assert.equal(game.active,false); assert.equal(game.hasRound,false);
  assert.equal(game.scene.getObjectByName('Shooting Range'),undefined);
  assert.equal(game.scene.getObjectByName('Range view'),undefined); assert.deepEqual(game.getSoloPowers(),off);
  assert.deepEqual(withCanvas(()=>game.tryStartRange('m4a1')), {ok:true}); fire(game);
  assert.equal(stats(game).shotsFired,1);
});

test('failure after progression and powers are live closes the visit and permits normal restart',t=>{
  const game=createHeadlessGame(); t.after(()=>cleanupGame(game)); const events=[];
  assert.equal(typeof game.tryStartRange,'function');
  game.events.onProgression=event=>events.push(event);
  const resume=game.resume; game.resume=()=>{throw new Error('startup interruption');};
  assert.equal(withCanvas(()=>game.tryStartRange('m4a1',{},all)).ok,false); game.resume=resume;
  assert.deepEqual(events.map(event=>event.type),['start','stop']); assert.deepEqual(game.getSoloPowers(),off);
  assert.equal(game.scene.getObjectByName('Range view'),undefined);
  assert.equal(game.scene.getObjectByName('Shooting Range'),undefined);
  game.start('m4a1',{bots:0}); game.update(.01); assert.equal(game.matchView.modeId,'ffa');
});

test('legacy WebViews without Object.hasOwn can start, fire and respawn targets',t=>{
  const original=Object.getOwnPropertyDescriptor(Object,'hasOwn');
  try {
    Object.defineProperty(Object,'hasOwn',{...original,value:undefined});
    const game=arena(t); aim(game); fire(game); game.update(5);
    assert.equal(stats(game).earnedXP,20); assert.equal(game.scene.getObjectByName('close-dummy').visible,true);
  } finally { Object.defineProperty(Object,'hasOwn',original); }
});

test('a thrown initial progression callback still receives stop and cannot leave an open range',t=>{
  const game=createHeadlessGame(); t.after(()=>cleanupGame(game)); const events=[];
  game.events.onProgression=event=>{events.push(event.type); if(event.type==='start')throw new Error('start callback failed');};
  assert.equal(withCanvas(()=>game.tryStartRange('m4a1')).ok,false);
  assert.deepEqual(events,['start','stop']); assert.equal(game.hasRound,false);
  assert.equal(game.scene.getObjectByName('Shooting Range'),undefined);
});

test('a thrown stop callback still clears input, powers and active range resources',t=>{
  const game=arena(t,'m4a1',all);
  game.events.onProgression=event=>{if(event.type==='stop')throw new Error('stop callback failed');};
  game.input.fire=true; assert.throws(()=>game.quit(),/stop callback failed/);
  assert.equal(game.hasRound,false); assert.equal(game.active,false); assert.equal(game.input.fire,false);
  assert.deepEqual(game.getSoloPowers(),off); assert.equal(game.rangeRuntime,null);
  assert.equal(game.scene.getObjectByName('Range view'),undefined);
});

test('Home HUD reads and inactive updates remain safe after quit and failed startup',t=>{
  const game=arena(t);
  game.events.onHud=()=>{game.getHidingView(); game.getClimbView();};
  game.quit(); game.update(1); assert.equal(game.getHidingView().enabled,false);
  assert.equal(withCanvas(()=>game.tryStartRange('m4a1'),()=>({getContext:()=>null})).ok,false);
  game.update(1); assert.equal(game.getHidingView().enabled,false);
  assert.equal(game.scene.getObjectByName('Shooting Range'),undefined);
  assert.equal(withCanvas(()=>game.tryStartRange('m4a1')).ok,true);
});

test('range to Zombies to online to range disposes visits, powers and stale HUD and never refills online ammo',t=>{
  const game=arena(t,'m4a1',all),events=[]; game.events.onProgression=event=>events.push(event);
  aim(game); fire(game); const previous=game.rangeRuntime, oldSession=game.modeState;
  game.start('m4a1',{modeId:'zombies'}); game.update(.01);
  assert.equal(events.find(event=>event.type==='stop').tally.earnedTotal,20);
  assert.equal(game.rangeRuntime,null); assert.equal(game.scene.getObjectByName('Range view'),undefined);
  assert.equal(game.matchView.range,undefined); assert.ok(game.bots.length>0); assert.deepEqual(game.getSoloPowers(),off);
  previous.dispose(); assert.equal(game.world.definition.id,'courtyard');
  const manager=new RoomManager({random:()=>.5}),room=manager.create('a','A','m4a1');
  manager.join('b',room.code,'B','m4a1'); manager.start('a');
  const online=new OnlineArena(game,{send:()=>true}); t.after(()=>online.stop());
  online.start({...manager.snapshot(room),selfEquipment:manager.equipmentSnapshot('a')},'a',{});
  assert.equal(game.rangeRuntime,null); assert.equal(game.zombieRuntime,null); assert.equal(game.matchView.range,undefined);
  game.weaponState.reserve=7; game.update(.1); assert.equal(game.weaponState.reserve,7);
  assert.equal(game.setSoloPowers(all,oldSession).ok,false); online.stop();
  assert.deepEqual(withCanvas(()=>game.tryStartRange('m4a1')),{ok:true});
  assert.equal(game.bots.length,0); assert.deepEqual(stats(game),{targetKills:0,shotsFired:0,shotsHit:0,accuracy:0,earnedXP:0});
  assert.deepEqual(game.getSoloPowers(),off); game.quit(); game.quit();
  assert.equal(game.scene.getObjectByName('Range view'),undefined); assert.equal(game.scene.getObjectByName('Shooting Range'),undefined);
});

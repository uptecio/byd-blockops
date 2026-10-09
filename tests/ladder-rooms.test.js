import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RoomManager } from '../server/rooms.js';
import { createBody } from '../src/character-movement.js';
import { solidBounds, interactionReach } from '../src/spatial.js';
import { getWeapon } from '../src/weapons.js';
import { createModeState } from '../src/modes.js';
import { accessFixture } from './helpers/access-fixture.js';

const input=(p,extra={})=>({lifeId:p.lifeId,x:0,y:0,yaw:0,pitch:0,...extra});
const reset=p=>assert.deepEqual([p.ladderId,p.ladderDistance,p.ladderBlockedId],[null,0,null]);
function pair(modeId='ffa',isolated=false) {
  const manager=new RoomManager({random:()=>.5}),room=manager.create('a','A','m4a1',{mapId:'harbor',modeId});
  manager.join('b',room.code,'B');manager.start('a');
  if(isolated) {
    const f=accessFixture(),world=f.world;
    room.physics={spatial:world,solids:world.solids,wallBoxes:world.solids.map(s=>{
      const b=solidBounds(s);return new THREE.Box3(new THREE.Vector3(b.min.x,b.min.y,b.min.z),new THREE.Vector3(b.max.x,b.max.y,b.max.z));
    })};
  }
  const a=room.players.get('a'),b=room.players.get('b'),ladder=room.physics.spatial.ladders[0];
  if(isolated)Object.assign(b,createBody({x:8,y:0,z:0},room.physics.spatial));
  b.protectedRemaining=0;
  function climb(p=a,seconds=.5) {
    Object.assign(p,createBody(ladder.bottom.point,room.physics.spatial),{protectedRemaining:0});
    for(let n=0;n<Math.round(seconds*60);n++){manager.input(p.id,input(p,{y:1,yaw:n/10}));manager.tick(1/60);}
    manager.input(p.id,input(p));assert.equal(p.ladderId,ladder.id);return p.y;
  }
  return {manager,room,a,b,ladder,climb};
}

test('stale-life movement and Jump never replace current controls or attach a new life',()=>{
  const {manager,room,a,climb,ladder}=pair();const old=input(a,{y:1,jump:true,fire:true});
  manager.spawn(room,a);Object.assign(a,createBody(ladder.bottom.point,room.physics.spatial));
  const held=a.input,at=a.inputAt;manager.input(a.id,old);
  assert.equal(a.input,held);assert.equal(a.inputAt,at);manager.tick(.1);reset(a);assert.equal(a.y,0);
  climb();const current=input(a,{y:1});manager.input(a.id,current);const accepted=a.input;
  for(const lifeId of [old.lifeId,undefined,NaN,-1,a.lifeId+1])manager.input(a.id,{...old,lifeId});
  assert.equal(a.input,accepted);const y=a.y;manager.tick(.1);assert.ok(a.y>y);assert.equal(a.ladderId,ladder.id);
});

test('joystick-only release keeps Fire independent, while timeout neutralizes controls and holds altitude',()=>{
  const {manager,room,a,climb,ladder}=pair('ffa',true);climb();
  manager.input(a.id,input(a,{fire:true,y:1,yaw:Math.PI}));manager.tick(.1);
  const height=a.y,ammo=a.inventory.get(a.weaponId).ammo;
  manager.input(a.id,input(a,{fire:true,yaw:Math.PI}));manager.tick(.2);
  assert.equal(a.y,height);assert.equal(a.ladderId,ladder.id);assert.ok(a.inventory.get(a.weaponId).ammo<ammo);
  manager.input(a.id,input(a,{y:1,fire:true,yaw:Math.PI}));manager.tick(.31);
  const expired=a.y,shots=a.inventory.get(a.weaponId).ammo;manager.tick(.5);
  assert.equal(a.y,expired);assert.equal(a.inventory.get(a.weaponId).ammo,shots);assert.equal(a.input.fire,false);
  assert.equal(a.ladderId,ladder.id);assert.equal(a.velocityY,0);
  manager.input(a.id,input(a,{reload:true}));manager.tick(.01);assert.ok(a.inventory.get(a.weaponId).reloadRemaining>0);
  manager.tick(getWeapon(a.weaponId).reloadTime);assert.equal(a.y,expired);assert.equal(a.inventory.get(a.weaponId).ammo,30);
});

test('shared ladder nonlethal armour damage and health-pack timing retain attachment; death clears exactly once',()=>{
  const {manager,room,a,b,climb,ladder}=pair();climb(a);climb(b);
  assert.equal(a.y,b.y);assert.equal(a.ladderId,b.ladderId);
  a.health=50;a.armour=20;a.equipment.supplies.health=1;
  assert.equal(manager.equipmentAction(a.id,{type:'equipment-action',seq:1,lifeId:a.lifeId,kind:'use-supply',supplyType:'health'}).ok,true);
  manager.damage(room,b.id,a,25);assert.equal(a.health,45);assert.equal(a.armour,0);assert.ok(a.equipment.supplyUse);
  assert.equal(a.ladderId,ladder.id);const height=a.y;manager.tick(5);assert.equal(a.health,100);assert.equal(a.y,height);
  a.health=50;a.equipment.supplies.health=1;
  manager.equipmentAction(a.id,{type:'equipment-action',seq:2,lifeId:a.lifeId,kind:'use-supply',supplyType:'health'});
  manager.damage(room,b.id,a,1000);reset(a);manager.damage(room,b.id,a,1000);
  assert.equal(a.equipment.supplyUse,null);assert.equal(a.deaths,1);assert.equal(b.kills,1);
  assert.equal(room.events.filter(e=>e.type==='kill').length,1);assert.equal(b.progression.eliminations,1);
  assert.ok(room.lootState.drops.length>0);assert.ok(room.lootState.drops.every(d=>d.y===0&&d.y<height));
  manager.tick(2.51);reset(a);assert.equal(a.health,100);assert.equal(a.input.fire,false);
});

test('climber body/head hitboxes and weapon origins use actual height, respecting team and spawn protection',()=>{
  for(const mode of ['ffa','tdm']) {
    const {manager,room,a,b,climb,ladder}=pair(mode,true);climb(a);
    Object.assign(b,createBody({x:0,y:0,z:2},room.physics.spatial),{yaw:0,pitch:Math.atan2(a.y+1-1.65,3.5)});
    a.protectedRemaining=1;manager.shoot(room,b,getWeapon('g17'));assert.equal(a.health,100);
    a.protectedRemaining=0;manager.shoot(room,b,getWeapon('g17'));assert.ok(a.health<100);assert.equal(a.ladderId,ladder.id);
    if(mode==='tdm') {
      manager.join('c',room.code,'Friend');const c=room.players.get('c');Object.assign(c,{x:b.x,y:b.y,z:b.z,yaw:b.yaw,pitch:b.pitch});
      const health=a.health;manager.shoot(room,c,getWeapon('awp'));assert.equal(a.health,health);
      Object.assign(c,createBody({x:8,y:0,z:0},room.physics.spatial));
    }
    b.pitch=Math.atan2(a.y+1.7-1.65,3.5);manager.shoot(room,b,getWeapon('g17'));assert.equal(a.health,0);reset(a);
    assert.equal(room.events.find(e=>e.type==='shot').from.y,b.y+1.65);
  }
});

test('knife and grenade actions remain available at real ladder height without attachment side effects',()=>{
  const {manager,room,a,b,climb,ladder}=pair('ffa',true);climb(a);
  Object.assign(b,createBody({x:0,y:0,z:-.5},room.physics.spatial),{protectedRemaining:0});
  a.equipment.knife=true;a.equipment.heldItem='knife';
  manager.input(a.id,input(a,{firePressed:true,yaw:Math.PI,pitch:-.7}));manager.tick(.01);
  assert.equal(b.health,50);assert.equal(a.ladderId,ladder.id);
  manager.tick(.61);a.equipment.grenades.frag=1;
  assert.equal(manager.equipmentAction(a.id,{type:'equipment-action',seq:1,lifeId:a.lifeId,kind:'throw',grenadeType:'frag'}).ok,true);
  assert.equal(a.ladderId,ladder.id);assert.ok(room.gearCombatState.projectiles[0].y>a.y);
  assert.equal(a.equipment.grenades.frag,0);
  assert.equal(interactionReach(a,{x:a.x,y:0,z:a.z},room.physics.spatial),false,'cannot collect ground loot at climb height');
});

for(const grenadeType of ['frag','flash','smoke'])test(`${grenadeType} resolves at a climber's actual height without detaching a survivor`,()=>{
  const {manager,room,a,b,climb,ladder}=pair('ffa',true);climb();a.armour=100;
  b.equipment.grenades[grenadeType]=1;
  assert.equal(manager.equipmentAction(b.id,{type:'equipment-action',seq:1,lifeId:b.lifeId,kind:'throw',grenadeType}).ok,true);
  // Isolate burst collision/height from ballistic aiming; the target got here
  // via the real shared mover and the projectile came from an accepted throw.
  Object.assign(room.gearCombatState.projectiles[0],{x:a.x,y:a.y+1.6,z:a.z-.4,vx:0,vy:0,vz:0,fuseRemaining:.001});
  manager.tick(.01);assert.equal(a.ladderId,ladder.id);assert.equal(a.health,100);
  assert.equal(room.events.filter(e=>e.type==='grenade-burst').length,1);
  if(grenadeType==='frag')assert.ok(a.armour<100);
  if(grenadeType==='flash')assert.ok(a.flashRemaining>0);
  if(grenadeType==='smoke')assert.equal(room.gearCombatState.smokes.length,1);
});

test('ladder altitude does not extend loot or flag capture reach; real landings enable interactions',()=>{
  const {manager,room,a,b,climb,ladder}=pair('ctf',true),f=accessFixture();
  room.modeState=createModeState({modeId:'ctf',map:{...f.map,bases:{red:f.goal,blue:{x:6,y:0,z:4}}},participants:[a,b]});
  Object.assign(a,createBody({x:6,y:0,z:4},room.physics.spatial),{protectedRemaining:0});manager.tick(.01);
  assert.equal(room.modeState.flags.blue.carrierId,a.id);climb();
  const slot=room.lootState.slots.find(s=>s.item.kind==='knife');Object.assign(slot,ladder.bottom.point,{present:true});
  manager.tick(.01);assert.equal(a.equipment.knife,false);assert.equal(room.modeState.teamScores.red,0);
  assert.equal(room.modeState.flags.blue.carrierId,a.id);
  for(let n=0;n<80&&a.ladderId;n++){manager.input(a.id,input(a,{y:1}));manager.tick(1/60);}
  assert.equal(a.y,f.goal.y);assert.equal(a.ladderId,null);assert.equal(room.modeState.teamScores.red,1);
  for(let n=0;n<95;n++){manager.input(a.id,input(a,{y:-1}));manager.tick(1/60);}
  assert.equal(a.y,0);assert.equal(a.ladderId,null);assert.equal(a.equipment.knife,true);assert.equal(room.modeState.teamScores.red,1);
});

test('delayed traversal from a departed room cannot attach the same connection in its next room',()=>{
  const {manager,a}=pair(),delayed=input(a,{y:1,jump:true});manager.leave(a.id);
  const next=manager.create(a.id,'Again','m4a1',{mapId:'harbor'});manager.join('other',next.code,'Other');manager.start(a.id);
  const fresh=next.players.get(a.id),ladder=next.physics.spatial.ladders[0];
  Object.assign(fresh,createBody(ladder.bottom.point,next.physics.spatial));manager.input(a.id,delayed);manager.tick(.1);
  reset(fresh);assert.equal(fresh.y,0);assert.equal(fresh.input.jump,false);
});

for(const ending of ['leave','disconnect','rematch','map'])test(`${ending} discards attachment/guard/input and preserves physical flag drop below mid-climb`,()=>{
  const {manager,room,a,b,climb}=pair('ctf');
  Object.assign(a,createBody(room.map.bases.blue,room.physics.spatial),{protectedRemaining:0});manager.tick(.01);
  assert.equal(room.modeState.flags.blue.carrierId,a.id);const height=climb();
  a.ladderBlockedId='old';manager.input(a.id,input(a,{y:1,fire:true}));
  if(ending==='leave'||ending==='disconnect') {
    manager.leave(a.id,{disconnected:ending==='disconnect'});reset(a);assert.equal(a.input.fire,false);
    assert.equal(room.modeState.flags.blue.status,'dropped');assert.equal(room.modeState.flags.blue.y,0);assert.ok(height>0);
    manager.join(a.id,room.code,'Again');reset(room.players.get(a.id));
  } else {
    room.phase='ended';room.modeState.ended=true;
    if(ending==='map')manager.configure(a.id,{mapId:'snow-base',modeId:'ctf'});
    else manager.start(a.id);
    reset(a);reset(b);assert.equal(a.input.fire,false);assert.equal(a.y,0);
  }
});

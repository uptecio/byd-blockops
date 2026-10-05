import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/rooms.js';
import { pickupEquipment } from '../src/equipment.js';
import { getWeapon } from '../src/weapons.js';

function pair(modeId = 'ffa') {
  const manager = new RoomManager({ random: () => .5 });
  const room = manager.create('p1', 'Host', 'm4a1', { modeId }); manager.join('p2', room.code, 'Guest', 'm4a1'); manager.start('p1');
  return { manager, room, a: room.players.get('p1'), b: room.players.get('p2') };
}
const action = (p, seq, fields) => ({ type:'equipment-action', seq, lifeId:p.lifeId, ...fields });
const pack = (p, supplyType = 'health') => pickupEquipment(p.equipment, { kind: 'supply', supplyType });
const use = (manager, p, seq = 1, supplyType = 'health') => manager.equipmentAction(p.id, action(p, seq, { kind:'use-supply', supplyType }));
const input = (p, extra = {}) => ({ type:'input', lifeId:p.lifeId, x:0,y:0,yaw:0,pitch:0,fire:false,firePressed:false,reload:false,...extra });

test('server completes one acknowledged pack after five seconds', () => {
  const { manager, a } = pair(); a.health = 20; pack(a);
  assert.equal(use(manager,a).ok, true); assert.equal(use(manager,a).ok, false);
  manager.tick(4.999); assert.equal(a.health,20); assert.equal(a.equipment.supplies.health,1);
  manager.tick(.001); assert.equal(a.health,100); assert.equal(a.equipment.supplies.health,0);
  manager.tick(1); assert.equal(a.equipment.supplies.health,0); assert.equal(a.equipment.supplyUse,null);
});

test('forged combat while using is inert for guns knives reload and grenades', () => {
  for (const heldItem of ['gun','knife']) {
    const { manager,room,a,b } = pair();
    Object.assign(a,{x:0,z:1.2,yaw:0,health:20,protectedRemaining:0}); Object.assign(b,{x:0,z:0,protectedRemaining:0});
    a.equipment.knife=true; a.equipment.heldItem=heldItem; a.equipment.grenades.frag=1; a.inventory.get('m4a1').ammo=10;
    pack(a); assert.equal(use(manager,a).ok,true);
    manager.input(a.id,input(a,{fire:true,firePressed:true,reload:true}));
    assert.equal(manager.equipmentAction(a.id,action(a,2,{kind:'throw',grenadeType:'frag'})).ok,false);
    manager.shoot(room,a,getWeapon('m4a1')); manager.tick(.05);
    assert.equal(b.health,100); assert.equal(a.inventory.get('m4a1').ammo,10); assert.equal(a.inventory.get('m4a1').reloadRemaining,0);
    assert.equal(a.equipment.meleeRemaining,0); assert.equal(a.equipment.grenades.frag,1); assert.equal(room.gearCombatState.projectiles.length,0);
    manager.tick(4.95); manager.tick(.05);
    assert.equal(a.inventory.get('m4a1').ammo,10,'old fire cannot replay at completion');
  }
});

test('enemy damage precedes due heal and elimination drops packs only once', () => {
  const {manager,room,a,b}=pair();
  Object.assign(a,{x:0,z:0,health:20,protectedRemaining:0}); Object.assign(b,{x:0,z:3,yaw:0,protectedRemaining:0});
  pack(a); assert.equal(use(manager,a).ok,true); manager.tick(4.99);
  manager.input(b.id,input(b,{firePressed:true,pitch:-.2})); manager.tick(.01);
  assert.equal(a.health,0); assert.equal(a.deaths,1); assert.equal(b.kills,1);
  assert.equal(a.equipment.supplyUse,null); assert.equal(a.equipment.supplies.health,0);
  assert.equal(room.lootState.drops.filter(d=>d.item.supplyType==='health').length,1);
  manager.damage(room,b.id,a,100); assert.equal(a.deaths,1);
});

test('spawn/team protection covers armour and accepted damage drains armour first', () => {
  const {manager,room,a,b}=pair('tdm'); manager.join('p3',room.code,'Friend','m4a1');
  a.armour=50; manager.damage(room,b.id,a,30); assert.equal(a.armour,50);
  a.protectedRemaining=0; manager.damage(room,'p3',a,30); assert.equal(a.armour,50);
  manager.snapshot(room); manager.damage(room,b.id,a,30);
  assert.equal(a.armour,20); assert.equal(a.health,100);
  assert.deepEqual(room.events.map(e=>e.type),['hit']); assert.equal(b.kills,0);
  manager.damage(room,b.id,a,30); assert.equal(a.armour,0); assert.equal(a.health,90);
  const events=room.events.length;
  for (const amount of [-1,NaN,Infinity]) manager.damage(room,b.id,a,amount);
  assert.equal(a.health,90); assert.equal(room.events.length,events);
  a.armour=100; manager.damage(room,b.id,a,10000000000);
  assert.equal(a.health,0); assert.equal(a.armour,0); assert.equal(b.kills,1); assert.equal(a.deaths,1);
});

test('private supply counts stay private and public armour is authoritative', () => {
  const {manager,room,a,b}=pair(); a.health=20; a.armour=50; pack(a); use(manager,a);
  const publicState=manager.snapshot(room), own=manager.equipmentSnapshot(a.id), other=manager.equipmentSnapshot(b.id);
  assert.equal(publicState.players[0].armour,50);
  assert.ok(publicState.players.every(p=>p.supplies===undefined && p.supplyUse===undefined && p.equipment===undefined));
  assert.deepEqual(own.equipment.supplies,{health:1,armour:0}); assert.equal(own.equipment.supplyUse.type,'health');
  assert.deepEqual(other.equipment.supplies,{health:0,armour:0});
});

test('nearest contested supply awarded once, excluding a full nearest stack', () => {
  for (const full of [false,true]) {
    const {manager,room,a,b}=pair(),slot=room.lootState.slots.find(s=>s.item.supplyType==='health');
    Object.assign(a,{x:slot.x,z:slot.z}); Object.assign(b,{x:slot.x+.2,z:slot.z});
    if(full) a.equipment.supplies.health=3;
    manager.tick(.01);
    assert.equal(slot.present,false);
    const events=room.events.filter(e=>e.itemId===slot.id);
    assert.equal(events.length,1); assert.equal(events[0].playerId,full?b.id:a.id);
  }
});

test('old life/room sequence cannot consume and invalid switch preserves use', () => {
  const {manager,room,a,b}=pair(); a.health=20; pack(a); assert.equal(use(manager,a).ok,true);
  manager.tick(1); const operation=a.equipment.supplyUse;
  assert.equal(use(manager,a,2,'armour').ok,false); assert.equal(a.equipment.supplyUse,operation);
  assert.equal(use(manager,a,3).ok,false); assert.equal(a.equipment.supplyUse,operation);
  const stale=action(a,4,{kind:'use-supply',supplyType:'health'});
  manager.eliminate(room,b.id,a); manager.tick(2.51); a.health=20; pack(a);
  assert.equal(manager.equipmentAction(a.id,stale).ok,false); assert.equal(a.equipment.supplyUse,null);
  assert.equal(use(manager,a,4).ok,true);
  manager.leave(a.id); assert.equal(a.equipment.supplyUse,null);
  const next=manager.create(a.id,'Again','m4a1'); manager.join('p3',next.code,'Third'); manager.start(a.id);
  const nextA=next.players.get(a.id); nextA.health=20; pack(nextA);
  assert.equal(manager.equipmentAction(a.id,stale).ok,false);
  assert.equal(nextA.equipment.supplies.health,1); assert.equal(nextA.equipment.supplyUse,null);
});

test('online neutral controls do not freeze use and movement survives start and completion', () => {
  const {manager,a}=pair(); a.health=20; pack(a);
  manager.input(a.id,input(a,{x:1,fire:true,reload:true})); assert.equal(use(manager,a).ok,true);
  assert.equal(a.input.x,1); assert.equal(a.input.fire,false); assert.equal(a.input.reload,false);
  const x=a.x; manager.tick(.1); assert.notEqual(a.x,x);
  manager.input(a.id,input(a)); manager.tick(4.9);
  assert.equal(a.health,100); assert.equal(a.equipment.supplies.health,0);
});

test('round end/departure clears use without consumption', () => {
  for(const end of ['timeout','leave','disconnect']) {
    const {manager,room,a}=pair(); a.health=20; pack(a); assert.equal(use(manager,a).ok,true);
    if(end==='timeout') { room.modeState.timeLeft=.01; manager.tick(.01); }
    else manager.leave(a.id,{disconnected:end==='disconnect'});
    assert.equal(a.equipment.supplyUse,null); assert.equal(a.equipment.supplies.health,1); assert.equal(a.health,20);
  }
});

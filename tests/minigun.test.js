import test from 'node:test';
import assert from 'node:assert/strict';
import { getWeapon, createWeaponState, tickWeapon, tryFire, startReload } from '../src/weapons.js';
import { createEquipment, equipGun, pickupEquipment, equipmentDTO, equipmentFromDTO } from '../src/equipment.js';
import { createLootState, collectLoot, lootDTO } from '../src/loot.js';
import { MAPS } from '../src/maps.js';
import { RoomManager } from '../server/rooms.js';
import { validGearWorld, validEquipmentSnapshot } from '../src/gear-protocol.js';
import { createHeadlessGame, cleanupGame, setWorldSolids, positionBot } from './helpers/game-fixture.js';

// Catches fallback to M4A1, incorrect belt size, replenishing shots, or blocked
// ordinary reloads. Hand-derived expected counts never use the catalog builder.
test('minigun fires all 500 rounds across a 200-round belt and ordinary reloads', () => {
  const state = createWeaponState('minigun');
  assert.deepEqual(state, { weaponId:'minigun', ammo:200, reserve:300, cooldown:0, reloadRemaining:0 });
  for (let shot = 0; shot < 200; shot++) {
    assert.equal(tryFire(state), true); assert.equal(tryFire(state), false);
    tickWeapon(state, 1 / 30);
  }
  assert.equal(tryFire(state), false); assert.deepEqual([state.ammo,state.reserve], [0,300]);
  assert.equal(startReload(state), true); assert.equal(tryFire(state), false);
  tickWeapon(state, 5); assert.deepEqual([state.ammo,state.reserve], [0,300]);
  tickWeapon(state, .5); assert.deepEqual([state.ammo,state.reserve], [200,100]);
  for (let shot = 0; shot < 200; shot++) { assert.equal(tryFire(state), true); tickWeapon(state, 1 / 30); }
  assert.equal(startReload(state), true); tickWeapon(state, 5.5);
  assert.deepEqual([state.ammo,state.reserve], [100,0]);
  for (let shot = 0; shot < 100; shot++) { assert.equal(tryFire(state), true); tickWeapon(state, 1 / 30); }
  assert.deepEqual([state.ammo,state.reserve], [0,0]);
  assert.equal(tryFire(state), false); assert.equal(startReload(state), false);
});

test('minigun inventory round trip and switching retain partial belt and reserve', () => {
  const gear = createEquipment('m4a1');
  assert.equal(pickupEquipment(gear,{kind:'gun',weaponId:'minigun',ammo:200,reserve:300}).ok,true);
  assert.equal(equipGun(gear,'minigun',{source:'inventory'}).ok,true);
  assert.equal(gear.activeGunId, 'minigun');
  const state = gear.owned.get('minigun'); tryFire(state); tickWeapon(state, 1 / 30);
  pickupEquipment(gear, { kind:'gun',weaponId:'m4a1',ammo:30,reserve:470 });
  assert.equal(equipGun(gear,'m4a1',{source:'inventory'}).ok, true);
  assert.equal(equipGun(gear,'minigun',{source:'inventory'}).ok, true);
  assert.deepEqual([state.ammo,state.reserve], [199,300]);
  assert.deepEqual(equipmentDTO(equipmentFromDTO(equipmentDTO(gear))), equipmentDTO(gear));
});

for (const map of MAPS) test(`${map.id}: minigun starter is available as collectible map loot`, () => {
  const loot = createLootState({mapId:map.id,seed:17,startingGunIds:['minigun']});
  const slot = loot.slots.find(s=>s.item.weaponId==='minigun');
  assert.ok(slot); assert.deepEqual(slot.item, {kind:'gun',weaponId:'minigun',ammo:200,reserve:300});
  const actor = {id:'collector',x:slot.x,y:slot.y,z:slot.z,alive:true,equipment:createEquipment('m4a1')};
  const events = collectLoot(loot,[actor],{solids:[]});
  assert.equal(events.filter(e=>e.item.weaponId==='minigun').length,1);
  assert.deepEqual([actor.equipment.owned.get('minigun').ammo,actor.equipment.owned.get('minigun').reserve],[200,300]);
  assert.equal(slot.present,false);
  assert.equal(validGearWorld({loot:lootDTO(loot),projectiles:[],smokes:[]}),true);
});

test('minigun participates in random loot without needing a minigun starter', () => {
  const found = new Set();
  for (const map of MAPS) for (let seed=0;seed<50;seed++) {
    const loot=createLootState({mapId:map.id,seed,startingGunIds:['m4a1']});
    if(loot.slots.some(s=>s.item.weaponId==='minigun'))found.add(map.id);
  }
  assert.deepEqual([...found].sort(),MAPS.map(m=>m.id).sort());
});

for (const modeId of ['ffa','tdm','ctf','zombies']) test(`solo ${modeId}: held trigger sprays, release stops and reload conserves ammo`, t => {
  const game=createHeadlessGame(); t.after(()=>cleanupGame(game));
  game.start('minigun',{bots:0,modeId});
  assert.equal(game.weapon.id,'minigun'); assert.equal(game.weapon.classId,'lmg');
  assert.deepEqual([game.weaponState.ammo,game.weaponState.reserve],[200,300]);
  game.input.fire=true;
  // Exactly 30 simulation steps at 30 Hz, firing via the real input/update loop.
  for(let i=0;i<30;i++)game.update(1/30);
  assert.deepEqual([game.weaponState.ammo,game.weaponState.reserve],[170,300]);
  game.input.fire=false; game.update(.2);
  assert.equal(game.weaponState.ammo,170);
  game.input.reload=true; game.update(.01);
  assert.ok(game.weaponState.reloadRemaining>0);
  game.update(5.5);
  // Repeated substeps can leave ~1e-14s at the exact boundary. Verify the
  // ordinary next simulation frame transfers the belt, without new ammo.
  assert.ok(game.weaponState.reloadRemaining<1e-8); game.update(1/30);
  assert.deepEqual([game.weaponState.ammo,game.weaponState.reserve],[200,270]);
});

test('solo minigun body hit is nonfatal and deterministic spread covers both sides of aim', t => {
  const game=createHeadlessGame();t.after(()=>cleanupGame(game));game.start('minigun',{bots:1});
  assert.equal(game.weapon.id,'minigun');setWorldSolids(game,[]);
  Object.assign(game.player,{x:0,z:10,y:0,jump:0,protected:0});game.placeCamera();game.camera.position.y=1.1;
  const target=game.bots[0];positionBot(target,0,0,0);target.protected=0;
  t.mock.method(Math,'random',()=>.5);game.shoot(false);
  assert.equal(target.health,88);
  const xs=[];
  for(const random of [.01,.99]) {
    t.mock.method(Math,'random',()=>random);game.shoot(false);
    const effect=game.effects.at(-1),points=effect.line.geometry.attributes.position;
    xs.push(points.getX(points.count-1));
  }
  assert.ok(xs[0]*xs[1]<0,'rays spray to both sides rather than being a straight laser');
  assert.ok(Math.abs(xs[0]-xs[1])>2,'wide spread remains observable over range');
});

for (const modeId of ['ffa','tdm','ctf']) test(`online ${modeId}: authority supports minigun rate, reload, snapshots and respawn`, () => {
  const manager=new RoomManager({random:()=>.5});
  const room=manager.create('a','Host','minigun',{modeId}); manager.join('b',room.code,'Guest','g17');manager.start('a');
  const a=room.players.get('a');
  const input=fire=>manager.input('a',{lifeId:a.lifeId,x:0,y:0,yaw:0,pitch:.8,fire});
  for(let i=0;i<30;i++){input(true);manager.tick(1/30);}
  let state=a.inventory.get('minigun');
  assert.deepEqual([state.ammo,state.reserve],[170,300]);
  input(false);manager.tick(.1);assert.equal(state.ammo,170);
  manager.input('a',{lifeId:a.lifeId,x:0,y:0,yaw:0,pitch:.8,reload:true});manager.tick(.01);
  assert.ok(state.reloadRemaining>0);manager.tick(5.5);
  assert.ok(state.reloadRemaining<1e-8);manager.tick(1/30);
  assert.deepEqual([state.ammo,state.reserve],[200,270]);
  const own=manager.snapshot(room).players.find(p=>p.id==='a');
  assert.equal(validEquipmentSnapshot(manager.equipmentSnapshot('a'),own),true);
  manager.eliminate(room,'b',a); assert.equal(room.lootState.drops[0].item.weaponId,'minigun');
  manager.tick(2.6);state=a.inventory.get('minigun');
  assert.deepEqual([state.ammo,state.reserve],[200,300]);
});

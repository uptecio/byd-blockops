import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GearView, createKnifeModel } from '../src/gear-view.js';
import { createLootState, lootDTO } from '../src/loot.js';
import { GameAudio } from '../src/audio.js';
import { disposeModel } from '../src/game.js';
import {createHeadlessGame, cleanupGame, positionBot, setWorldSolids } from './helpers/game-fixture.js';
import { recordElimination } from '../src/modes.js';
import { OnlineArena } from '../src/online-game.js';
import { RoomManager } from '../server/rooms.js';
import { pickupEquipment } from '../src/equipment.js';

const empty = () => ({ loot: [], projectiles: [], smokes: [] });
const loot = () => lootDTO(createLootState({ mapId: 'courtyard', seed: 1, startingGunIds: ['ak47'] }));
function resources(model) {
  const result = new Set();
  model.traverse(object => { if (object.geometry) result.add(object.geometry);
    for (const material of object.material ? [].concat(object.material) : []) {
      result.add(material); if (material.map) result.add(material.map);
    }
  }); return result;
}
const smoke = { id: 'smoke-1', ownerId: 'other', x: 0, y: 1.6, z: -4, radius: 2, remaining: 8 };

test('world IDs retain one visual across repeated sync and remove absent or replaced pickups', () => {
  const scene = new THREE.Scene(), view = new GearView(THREE, scene);
  const world = { ...empty(), loot: loot() }; view.sync(world);
  assert.equal(view.loot.size, 20);
  for (const item of world.loot) assert.equal(view.loot.get(item.id).userData.id, item.id);
  const item = world.loot[0], first = view.loot.get(item.id), owned = resources(view.group);
  view.sync(world); assert.equal(view.loot.get(item.id), first);
  assert.deepEqual(resources(view.group), owned);
  view.sync({ ...world, loot: world.loot.slice(1) }); assert.equal(first.parent, null);
  const replacement = { ...item, item: { kind: 'knife' } };
  view.sync({ ...empty(), loot: [replacement] });
  assert.equal(view.loot.get(item.id).getObjectByName('Knife').name, 'Knife');
  assert.equal(view.loot.get(item.id).userData.label, 'KNIFE'); view.dispose();
});

test('pickup meshes fit the ground footprint even for the longest gun', () => {
  const view = new GearView(THREE, new THREE.Scene());
  view.sync({ ...empty(), loot: [{ id: 'long-gun', x: 0, y: 0, z: 0, item: { kind: 'gun', weaponId: 'barrett' } }] });
  const pickup = view.loot.get('long-gun').children[0];
  const box = new THREE.Box3().setFromObject(pickup);
  assert.ok(box.min.x >= -.34 && box.max.x <= .34 && box.min.z >= -.34 && box.max.z <= .34);
  assert.ok(box.max.y <= .6 && box.min.y >= .05); view.dispose();
});

test('view disposal preserves unrelated scene contents', () => {
  const scene = new THREE.Scene(), sentinel = new THREE.Group(); scene.add(sentinel);
  const view = new GearView(THREE, scene);
  view.sync({ loot: loot(), projectiles: [], smokes: [] });
  view.dispose(); assert.deepEqual(scene.children, [sentinel]);
});

test('clear removes every entity and disposing a view releases each resource once without touching another view', () => {
  const scene = new THREE.Scene(), first = new GearView(THREE, scene), second = new GearView(THREE, scene);
  const world = { loot: loot(), projectiles: [{ id: 'grenade-1', grenadeType: 'frag', x: 1, y: 1, z: 2 }], smokes: [smoke] };
  first.sync(world); second.sync(world);
  const counts = new Map(), untouched = resources(second.group);
  for (const resource of resources(first.group)) {
    assert.equal(untouched.has(resource), false);
    resource.addEventListener('dispose', () => counts.set(resource, (counts.get(resource) ?? 0) + 1));
    counts.set(resource, 0);
  }
  first.clear(); assert.equal(first.group.children.length, 0);
  assert.equal(first.loot.size + first.projectiles.size + first.smokes.size, 0);
  first.dispose(); first.dispose();
  for (const count of counts.values()) assert.equal(count, 1);
  assert.equal(second.group.parent, scene); assert.equal(second.loot.size, 20); second.dispose();
});

test('smoke uses the shared spherical volume and hides opponent models and labels without blocking rays', () => {
  const scene = new THREE.Scene(), view = new GearView(THREE, scene);
  const model = new THREE.Group(), label = new THREE.Sprite(); model.add(label); scene.add(model);
  const viewer = { id: 'local', teamId: 'red', x: 0, y: 0, z: 0 };
  const actors = [{ id: 'enemy', teamId: 'blue', x: 0, y: 0, z: -8, alive: true, model, label }];
  view.sync(empty()); view.update({ viewer, actors, flashRemaining: 0 }); assert.equal(model.visible, true);
  view.sync({ ...empty(), smokes: [smoke] }); view.update({ viewer, actors, flashRemaining: 0 });
  assert.equal(model.visible, false); assert.equal(label.visible, false);
  const cloud = view.smokes.get(smoke.id);
  assert.deepEqual(cloud.position.toArray(), [0, 1.6, -4]);
  assert.deepEqual(cloud.scale.toArray(), [2, 2, 2]);
  assert.equal(cloud.geometry.type, 'SphereGeometry');
  scene.updateMatrixWorld(true);
  assert.deepEqual(new THREE.Raycaster(new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(0, 0, -1)).intersectObject(cloud), []);
  actors[0].x = 8; view.update({ viewer, actors, flashRemaining: 0 });
  assert.equal(model.visible, true); assert.equal(label.visible, true); view.dispose();
});

test('flash hides enemies and their labels with a monotonic desaturated veil and restores them on recovery', () => {
  const scene = new THREE.Scene(), view = new GearView(THREE, scene), camera = new THREE.PerspectiveCamera(); scene.add(camera);
  const model = new THREE.Group(), label = new THREE.Sprite(); model.add(label);
  const viewer = { id: 'local', teamId: 'red', x: 0, y: 0, z: 0, camera };
  const actors = [{ id: 'enemy', teamId: 'blue', x: 0, y: 0, z: -8, alive: true, model, label }];
  let previous = 1;
  for (const flashRemaining of [3, 2.5, 2, 1.5, 1, .5, .01]) {
    view.update({ viewer, actors, flashRemaining }); assert.equal(model.visible, false); assert.equal(label.visible, false);
    assert.ok(view.flash.material.opacity <= previous); previous = view.flash.material.opacity;
    const { r, g, b } = view.flash.material.color; assert.equal(r, g); assert.equal(g, b);
  }
  const opacity = view.flash.material.opacity;
  view.update({ viewer, actors, flashRemaining: .01 }); assert.equal(view.flash.material.opacity, opacity);
  view.update({ viewer, actors, flashRemaining: 0 }); assert.equal(model.visible, true); assert.equal(label.visible, true);
  assert.equal(view.flash.visible, false); view.dispose(); assert.equal(camera.children.length, 0);
});

test('knife models own their resources and point forward independently', () => {
  const first = createKnifeModel(THREE), second = createKnifeModel(THREE);
  assert.ok(first instanceof THREE.Group); assert.equal(first.name, 'Knife');
  assert.ok(new THREE.Box3().setFromObject(first).min.z < -.4);
  for (const resource of resources(first)) assert.equal(resources(second).has(resource), false);
  disposeModel(first); assert.ok(second.getObjectByName('blade')); disposeModel(second);
});

test('authoritative bursts are deduplicated, bounded and fade without replaying on a stationary update', () => {
  const view = new GearView(THREE, new THREE.Scene());
  const event = { id: 1, type: 'grenade-burst', grenadeType: 'frag', position: { x: 1, y: 2, z: 3 } };
  view.event(event); view.event(event); assert.equal(view.bursts.size, 1);
  assert.deepEqual(view.bursts.get(1).position.toArray(), [1, 2, 3]);
  view.update({ viewer: { id: 'local', x: 0, y: 0, z: 0 }, actors: [], dt: .4 }); assert.equal(view.bursts.size, 0);
  view.event(event); assert.equal(view.bursts.size, 0);
  for (let id = 2; id < 45; id++) view.event({ ...event, id }); assert.equal(view.bursts.size, 32);
  view.dispose();
});

test('solo held knife renders without granting guns and smoke-hidden bots still receive gunfire', t => {
  const game = createHeadlessGame(); t.after(() => cleanupGame(game)); game.start('ak47', { bots: 1 }); setWorldSolids(game, []);
  Object.assign(game.player, { x: 0, z: 8, protected: 0 });
  const bot = game.bots[0]; positionBot(bot, 0, 0, 0); bot.protected = 0; bot.cooldown = 100;
  game.botTuning.speed = 0; game.botTuning.accuracy = 0;
  game.player.equipment.knife = true; game.requestEquipment({ kind: 'held-item', heldItem: 'knife' });
  assert.equal(game.weaponModel.name, 'Knife'); assert.equal(game.inventory.size, 1);
  game.gearCombatState.smokes.push({ ...smoke, z: 4 }); game.update(.01);
  // At range the bot legitimately chooses its gun. Present a new authoritative
  // held-item snapshot separately from its next AI decision.
  bot.equipment.knife = true; bot.equipment.heldItem = 'knife'; game.refreshGearView();
  assert.equal(bot.model.getObjectByName('weapon').children[0].name, 'Knife'); assert.equal(bot.model.visible, false);
  game.requestEquipment({ kind: 'held-item', heldItem: 'gun' }); game.placeCamera();
  t.mock.method(Math, 'random', () => .5); game.shoot(false); assert.ok(bot.health < 100);
});

test('a solo knife swing moves the held model during the start of its interval', t => {
  const game = createHeadlessGame(); t.after(() => cleanupGame(game)); game.start('ak47', { bots: 0 });
  game.player.equipment.knife = true; game.requestEquipment({ kind: 'held-item', heldItem: 'knife' });
  game.input.fire = true; game.update(.01); game.input.fire = false; game.update(.05);
  assert.ok(Math.abs(game.weaponModel.rotation.x) > .1);
  assert.equal(game.muzzle.visible, false);
});

test('online snapshots update held knives and concealment during suspension, then clear on stop', t => {
  const game = createHeadlessGame(); t.after(() => cleanupGame(game));
  const manager = new RoomManager({ random: () => .5 }); const state = manager.create('self', 'Viewer');
  manager.join('other', state.code, 'Enemy'); manager.start('self');
  Object.assign(state.players.get('self'), { x: 0, y: 0, z: 0 });
  const opponent = state.players.get('other'); Object.assign(opponent, { x: 0, y: 0, z: -8 });
  const snapshot = () => ({ ...manager.snapshot(state), selfEquipment: manager.equipmentSnapshot('self') });
  const online = new OnlineArena(game, { send: () => true }); t.after(() => online.stop());
  online.start(snapshot(), 'self', {}); online.pause();
  opponent.equipment.knife = true; opponent.equipment.heldItem = 'knife';
  state.gearCombatState.smokes.push(smoke); online.sync(snapshot());
  const model = online.remotes.get('other').model;
  assert.equal(model.getObjectByName('weapon').children[0].name, 'Knife'); assert.equal(model.visible, false);
  const label = new THREE.Sprite(); label.name = 'name-label'; model.add(label);
  state.gearCombatState.smokes = []; online.sync(snapshot()); assert.equal(model.visible, true);
  assert.equal(label.visible, true);
  state.players.get('self').flashRemaining = 3; online.sync(snapshot()); assert.equal(model.visible, false); assert.equal(label.visible, false);
  assert.equal(game.gearView.flash.visible, true);
  online.stop(); assert.equal(game.gearView.group.children.length, 0); assert.equal(game.gearView.flash.parent, null);
});

test('pickup, swing and grenade audio is optional under disabled sound or missing contexts', () => {
  const audio = new GameAudio();
  for (const enabled of [false, true]) { audio.enabled = enabled;
    assert.doesNotThrow(() => { audio.pickup(); audio.swing(); for (const type of ['frag', 'smoke', 'flash']) audio.grenade(type); });
  }
});

test('solo map switches and fixture cleanup release gear visuals', () => {
  const game = createHeadlessGame(); game.start('ak47', { bots: 0 });
  assert.equal(game.gearView.loot.size, 20);
  const old = [...game.gearView.loot.values()]; game.loadMap('dust-town');
  assert.equal(game.gearView.loot.size, 0); for (const model of old) assert.equal(model.parent, null);
  cleanupGame(game); assert.equal(game.gearView.group.parent, null);
});

test('both supply models use distinct cached boxes and all 68 permitted pickups render', () => {
  const view = new GearView(THREE, new THREE.Scene());
  const world = { ...empty(), loot: loot() };
  for (let i = 0; i < 48; i++) world.loot.push({ id: `drop:${i}`, x: 0, y: 0, z: i, item: { kind: 'supply', supplyType: i % 2 ? 'armour' : 'health' } });
  view.sync(world);
  assert.equal(view.loot.size, 68);
  assert.equal(view.loot.get('drop:47').userData.label, 'ARMOUR PACK');
  const health = view.template({ kind: 'supply', supplyType: 'health' }), armour = view.template({ kind: 'supply', supplyType: 'armour' });
  assert.notEqual(health, armour);
  assert.equal(view.template({ kind: 'supply', supplyType: 'health' }), health);
  assert.ok(health.getObjectByName('health-symbol')); assert.ok(armour.getObjectByName('shield-symbol'));
  for (const template of [health, armour]) {
    template.traverse(mesh => { if (mesh.geometry) assert.equal(mesh.geometry.type, 'BoxGeometry'); });
    const bounds = new THREE.Box3().setFromObject(template);
    assert.ok(bounds.min.x >= -.34 && bounds.max.x <= .34 && bounds.min.z >= -.34 && bounds.max.z <= .34);
  }
  const counts = new Map();
  for (const resource of resources(view.group)) { counts.set(resource, 0); resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1)); }
  view.dispose(); view.dispose(); assert.ok([...counts.values()].every(n => n === 1));
});

test('solo supply use lowers the held model and restores after cancellation completion and a new life', t => {
  const game = createHeadlessGame(); t.after(() => cleanupGame(game)); game.start('m4a1', { bots: 0 }); game.update(.01);
  const rest = game.weaponModel.position.y;
  pickupEquipment(game.player.equipment, { kind:'supply', supplyType:'armour' });
  game.requestEquipment({ kind:'use-supply', supplyType:'armour' }); game.update(.01);
  assert.ok(game.weaponModel.position.y < rest - .15);
  game.requestEquipment({ kind:'cancel-supply' }); game.update(.01); assert.equal(game.weaponModel.position.y, rest);
  game.requestEquipment({ kind:'use-supply', supplyType:'armour' }); game.update(5); game.update(.01);
  assert.equal(game.weaponModel.position.y, rest);
  pickupEquipment(game.player.equipment, { kind:'supply', supplyType:'armour' });
  game.requestEquipment({ kind:'use-supply', supplyType:'armour' }); game.update(.01); game.resetPlayer(); game.update(.01);
  assert.equal(game.weaponModel.position.y, rest);
  game.weaponState.ammo = 0; game.input.reload = true; game.update(.01);
  assert.ok(game.weaponModel.position.y < rest, 'existing reload lowering remains');
});

test('online held model follows acknowledged supply use even while menus are open', t => {
  const game = createHeadlessGame(); t.after(() => cleanupGame(game));
  const manager = new RoomManager({ random:()=>.5 }), room = manager.create('self','Viewer');
  manager.join('other',room.code,'Peer'); manager.start('self');
  const online = new OnlineArena(game, { send:()=>true }); t.after(() => online.stop());
  const snapshot = () => ({ ...manager.snapshot(room), selfEquipment:manager.equipmentSnapshot('self') });
  online.start(snapshot(),'self',{}); online.update(.01); const rest = game.weaponModel.position.y;
  const player = room.players.get('self'); pickupEquipment(player.equipment, { kind:'supply',supplyType:'armour' });
  manager.equipmentAction('self', { type:'equipment-action',seq:1,lifeId:player.lifeId,kind:'use-supply',supplyType:'armour' });
  online.sync(snapshot()); online.pause(); online.update(.01); assert.ok(game.weaponModel.position.y < rest - .15);
  manager.tick(5); online.sync(snapshot()); online.update(.01); assert.equal(game.weaponModel.position.y, rest);
  assert.equal(game.player.armour, 50);
});

test('supply pose clears on death round end or quit even if no further live frame runs', t => {
  const game = createHeadlessGame(); t.after(() => cleanupGame(game));
  for (const exit of ['death','timeout','quit']) {
    game.start('m4a1', { bots:1 }); game.botTuning.speed = 0; game.botTuning.accuracy = 0;
    pickupEquipment(game.player.equipment, { kind:'supply', supplyType:'armour' });
    game.requestEquipment({ kind:'use-supply', supplyType:'armour' }); game.update(.01);
    if (exit === 'death') { game.player.protected = 0; game.damageActor(game.bots[0].id, game.player, 200); }
    else if (exit === 'quit') game.quit();
    else { game.modeState.timeLeft = .01; game.update(.01); }
    assert.equal(game.player.equipment.supplyUse, null);
    assert.equal(game.weaponModel.position.y, -.27, exit);
  }
});

test('winning solo knife swing drains presentation once without advancing pending grenade damage', t => {
  const game = createHeadlessGame(); t.after(() => cleanupGame(game)); game.start('ak47', { bots: 2 }); setWorldSolids(game, []);
  game.botTuning.speed = 0; game.botTuning.accuracy = 0;
  Object.assign(game.player, { x: 0, z: 1, protected: 0 });
  game.bots.forEach((bot, i) => { positionBot(bot, i * 3, 0, 0); bot.health = 50; bot.protected = 0; bot.cooldown = 100; });
  for (let i = 0; i < 14; i++) recordElimination(game.modeState, { killerId: 'local', victimId: 'bot-0', position: { x: 0, z: 0 }, lifeId: 100 + i });
  game.player.equipment.knife = true; game.requestEquipment({ kind: 'held-item', heldItem: 'knife' });
  game.player.equipment.grenades.frag = 1; game.requestEquipment({ kind: 'throw', grenadeType: 'frag' });
  game.player.equipment.attackLockRemaining = 0;
  const projectile = game.gearCombatState.projectiles[0]; Object.assign(projectile, { x: 3, y: .12, z: 0, vx: 0, vy: 0, vz: 0, fuseRemaining: .001 });
  let swings = 0; game.audio.swing = () => swings++; game.input.fire = true; game.update(.01);
  assert.equal(game.modeState.ended, true); assert.equal(game.bots[1].health, 50);
  assert.equal(projectile.fuseRemaining, .001); assert.equal(game.gearCombatState.events.length, 0);
  assert.equal(game.gearEvents.filter(event => event.type === 'melee').length, 1);
  assert.equal(swings, 1); game.update(.1); assert.equal(swings, 1);
});

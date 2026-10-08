import test from 'node:test';
import assert from 'node:assert/strict';
import { pickupEquipment } from '../src/equipment.js';
import { lootDTO } from '../src/loot.js';
import { tickMode, recordElimination } from '../src/modes.js';
import {createHeadlessGame, cleanupGame, positionBot, setWorldSolids } from './helpers/game-fixture.js';
import * as THREE from 'three';
import { AVATAR_HITBOX } from '../src/avatar.js';

function arena(t, { modeId = 'ffa', bots = 2, gun = 'ak47' } = {}) {
  const game = createHeadlessGame(); t.after(() => cleanupGame(game));
  game.start(gun, { bots, modeId }); setWorldSolids(game, []);
  Object.assign(game.player, { x: 0, z: 10, protected: 0 });
  game.botTuning = { speed: 0, interval: 1, accuracy: 0, damage: 8 };
  game.bots.forEach((bot, i) => { positionBot(bot, i * 2, 0, 0); bot.protected = 0; bot.cooldown = 100; });
  return game;
}

test('real Solo camera torso aim connects a close knife hit and shows local hit feedback', t => {
  const game = arena(t, { bots: 1 }), victim = game.bots[0];
  Object.assign(game.player, { x: 0, z: .8 });
  pickupEquipment(game.player.equipment, { kind: 'knife' });
  game.requestEquipment({ kind: 'held-item', heldItem: 'knife' });
  game.pitch = Math.atan2(1.07 - 1.65, .8); game.placeCamera(); game.camera.updateMatrixWorld(true);
  const ray = new THREE.Ray(game.camera.position, game.camera.getWorldDirection(new THREE.Vector3()));
  const box = new THREE.Box3(new THREE.Vector3(-AVATAR_HITBOX.halfWidth, .05, -AVATAR_HITBOX.halfWidth), new THREE.Vector3(AVATAR_HITBOX.halfWidth, AVATAR_HITBOX.height, AVATAR_HITBOX.halfWidth));
  assert.ok(ray.intersectBox(box, new THREE.Vector3()), 'Actual rendered center-camera ray intersects the existing avatar body');
  const feedback = [];
  game.audio.hit = () => feedback.push('hit'); game.audio.kill = () => feedback.push('kill');
  const actors = game.getActors(); game.slash(actors[0], actors);
  assert.equal(victim.health, 50, 'Crosshair on nearby torso must deal the approved 50 damage');
  assert.equal(game.hitFlash, .18); assert.deepEqual(feedback, ['hit']);
  assert.equal(game.player.equipment.meleeRemaining, .6);
});

test('Solo post-input torso aim and getActors preserve actual camera pitch for knife hits', t => {
  const game = arena(t, { bots: 1 }); Object.assign(game.player, { x: 0, z: .8 });
  pickupEquipment(game.player.equipment, { kind: 'knife' }); game.requestEquipment({ kind: 'held-item', heldItem: 'knife' });
  const pitch = Math.atan2(1.07 - 1.65, .8);
  game.input.look.y = -pitch / (.0026 * game.settings.sensitivity); game.input.fire = true;
  game.update(.01);
  assert.equal(game.bots[0].health, 50, 'Same-frame real aim input must drive the knife body ray');
  assert.ok(Math.abs(game.getActors()[0].pitch - pitch) < 1e-10, 'Gear adapter uses the camera pitch sign');
  assert.ok(game.camera.getWorldDirection(new THREE.Vector3()).y < 0);
});

for (const pitch of [-.5, .5]) test(`Solo camera pitch ${pitch} launches grenades in the same vertical direction`, t => {
  const game = arena(t, { bots: 0 }); game.pitch = pitch; game.placeCamera(); game.camera.updateMatrixWorld(true);
  pickupEquipment(game.player.equipment, { kind: 'grenade', grenadeType: 'frag' });
  assert.equal(game.requestEquipment({ kind: 'throw', grenadeType: 'frag' }).ok, true);
  const projectile = game.gearCombatState.projectiles[0];
  const direction = game.camera.getWorldDirection(new THREE.Vector3());
  assert.ok(Math.abs((projectile.vy - 3) / 12 - direction.y) < 1e-10, 'Thrown velocity uses actual camera elevation');
});

test('knife hit feedback marks only accepted local damage including an elimination', t => {
  const game = arena(t, { bots: 1 }), victim = game.bots[0]; Object.assign(game.player, { x: 0, z: 1.2 });
  pickupEquipment(game.player.equipment, { kind: 'knife' }); game.requestEquipment({ kind: 'held-item', heldItem: 'knife' });
  const feedback = []; game.audio.hit = () => feedback.push('hit'); game.audio.kill = () => feedback.push('kill');
  victim.health = 50; const actors = game.getActors(); game.slash(actors[0], actors);
  assert.equal(victim.health, 0); assert.equal(game.hitFlash, .18); assert.deepEqual(feedback, ['kill']);
  assert.equal(game.modeState.stats.local.kills, 1);
});

for (const rejected of ['miss', 'protected', 'friendly', 'bot-hit']) test(`knife ${rejected} never produces false local hit feedback`, t => {
  const game = arena(t, { modeId: rejected === 'friendly' ? 'tdm' : 'ffa', bots: 1 });
  const victim = game.bots[0]; Object.assign(game.player, { x: 0, z: rejected === 'miss' ? 5 : 1.2 });
  const feedback = []; game.audio.hit = () => feedback.push('hit'); game.audio.kill = () => feedback.push('kill');
  if (rejected === 'protected') victim.protected = 1;
  if (rejected === 'friendly') { victim.teamId = game.player.teamId; game.modeState.stats[victim.id].teamId = game.player.teamId; }
  const owner = rejected === 'bot-hit' ? victim : game.player;
  pickupEquipment(owner.equipment, { kind: 'knife' }); owner.equipment.heldItem = 'knife';
  if (rejected === 'bot-hit') victim.yaw = Math.PI;
  const actors = game.getActors(); game.slash(actors.find(a => a.id === owner.id), actors);
  assert.equal(game.hitFlash, 0); assert.deepEqual(feedback, []);
  if (rejected === 'bot-hit') assert.equal(game.player.health, 50, 'Bot knife still damages the local player');
});

test('original gun is denied after a real replacement and restored only by walking over loot', t => {
  const game = arena(t, { bots: 0 });
  assert.equal(game.requestEquipment({ kind: 'equip-gun', weaponId: 'mp5', source: 'armory' }).ok, true);
  assert.deepEqual(game.requestEquipment({ kind: 'equip-gun', weaponId: 'ak47', source: 'armory' }), { ok: false, reason: 'Find this gun as loot' });
  const slot = game.lootState.slots.find(slot => slot.item.weaponId === 'ak47');
  Object.assign(game.player, { x: slot.x, z: slot.z }); game.update(.01);
  assert.equal(game.getEquipmentView().activeGunId, 'mp5');
  assert.equal(game.requestEquipment({ kind: 'equip-gun', weaponId: 'ak47', source: 'inventory' }).ok, true);
});

test('respawn restores original gun rather than last selected gun', t => {
  const game = createHeadlessGame(); t.after(() => cleanupGame(game)); game.start('ak47', { bots: 0 });
  assert.equal(game.requestEquipment({ kind: 'equip-gun', weaponId: 'mp5', source: 'armory' }).ok, true);
  game.resetPlayer();
  assert.equal(game.getEquipmentView().activeGunId, 'ak47');
  assert.deepEqual(game.getEquipmentView().owned.map(w => w.weaponId), ['ak47']);
});

test('presentation does not grant a gun or remove original ownership', t => {
  const game = arena(t, { bots: 0 }); game.presentHeldItem('mp5', 'gun');
  assert.deepEqual(game.getEquipmentView().owned.map(w => w.weaponId), ['ak47']);
  assert.equal(game.getEquipmentView().activeGunId, 'ak47');
});

test('dead and ended requests cannot mutate a life and paused armory selection remains available', t => {
  const game = arena(t); game.pause();
  assert.equal(game.requestEquipment({ kind: 'equip-gun', weaponId: 'mp5', source: 'armory' }).ok, true);
  assert.equal(game.requestEquipment({ kind: 'throw', grenadeType: 'frag' }).ok, false);
  game.damageActor('bot-0', game.player, 100);
  assert.equal(game.requestEquipment({ kind: 'equip-gun', weaponId: 'scar', source: 'armory' }).ok, false);
  assert.equal(game.getEquipmentView().owned.length, 0);
  assert.equal(game.weaponState.ammo, 0); assert.equal(game.weaponState.reserve, 0);
  game.resetPlayer(); game.modeState.ended = true;
  assert.equal(game.requestEquipment({ kind: 'held-item', heldItem: 'gun' }).ok, false);
});

for (const source of ['gun', 'knife', 'frag']) test(`${source} death drops the active gun once and clears collected inventory`, t => {
  const game = arena(t, { gun: 'awp', bots: 1 }), victim = game.bots[0];
  victim.equipment.knife = true; victim.equipment.heldItem = 'knife';
  victim.lastGrenadeAttempt = 0;
  victim.equipment.grenades.flash = 1; victim.weaponState.ammo = 7; victim.weaponState.reserve = 100;
  if (source === 'gun') { game.camera.position.set(0, 1.1, 10); t.mock.method(Math, 'random', () => .5); game.shoot(false); }
  if (source === 'knife') {
    Object.assign(game.player, { x: 0, z: 1.2 }); victim.health = 50;
    pickupEquipment(game.player.equipment, { kind: 'knife' }); game.requestEquipment({ kind: 'held-item', heldItem: 'knife' });
    game.input.fire = true; game.update(.01);
  }
  if (source === 'frag') {
    victim.health = 1; game.player.equipment.grenades.frag = 1;
    assert.equal(game.requestEquipment({ kind: 'throw', grenadeType: 'frag' }).ok, true);
    Object.assign(game.gearCombatState.projectiles[0], { x: 0, y: .12, z: 0, vx: 0, vy: 0, vz: 0, fuseRemaining: .01 });
    game.update(.02);
  }
  assert.equal(victim.health, 0); assert.equal(game.modeState.stats[victim.id].deaths, 1);
  assert.equal(game.lootState.drops.length, 2);
  assert.deepEqual(game.lootState.drops[0].item, { kind: 'gun', weaponId: 'm4a1', ammo: 7, reserve: 100 });
  assert.equal(victim.equipment.owned.size, 0);
  game.damageActor('local', victim, 100); assert.equal(game.lootState.drops.length, 2);
  game.spawnBot(victim); assert.equal(victim.equipment.activeGunId, 'm4a1'); assert.equal(victim.weaponState.ammo + victim.weaponState.reserve, 500);
});

test('knife misses spend the swing interval and throws suppress attacks', t => {
  const game = arena(t, { bots: 1 }), victim = game.bots[0];
  pickupEquipment(game.player.equipment, { kind: 'knife' }); game.requestEquipment({ kind: 'held-item', heldItem: 'knife' });
  game.input.fire = true; game.update(.01); assert.equal(game.player.equipment.meleeRemaining, .6);
  Object.assign(game.player, { x: 0, z: 1.2 }); game.update(.01); assert.equal(victim.health, 100);
  game.update(.6); assert.equal(victim.health, 50);
  game.player.equipment.grenades.frag = 1;
  game.requestEquipment({ kind: 'throw', grenadeType: 'frag' });
  assert.equal(game.player.equipment.grenades.frag, 0); assert.equal(game.player.equipment.attackLockRemaining, .25);
});

test('solo pause freezes loot, grenade fuses, equipment cooldowns and flash recovery', t => {
  const game = arena(t, { bots: 0 }); game.player.equipment.grenades.smoke = 1;
  game.requestEquipment({ kind: 'throw', grenadeType: 'smoke' }); game.player.flashRemaining = 2;
  const slot = game.lootState.slots[0]; slot.present = false; slot.respawnRemaining = 20;
  const before = structuredClone({ loot: lootDTO(game.lootState), fuse: game.gearCombatState.projectiles[0].fuseRemaining, equipment: game.getEquipmentView() });
  game.pause(); game.update(10);
  assert.deepEqual({ loot: lootDTO(game.lootState), fuse: game.gearCombatState.projectiles[0].fuseRemaining, equipment: game.getEquipmentView() }, before);
  assert.equal(slot.respawnRemaining, 20); assert.equal(game.player.flashRemaining, 2);
  game.resume(); game.update(.1); assert.ok(Math.abs(game.player.flashRemaining - 1.9) < 1e-8);
});

test('flash recovery occurs once per step then refreshes within three seconds', t => {
  const game = arena(t, { bots: 1 }), victim = game.bots[0]; victim.flashRemaining = 2;
  game.player.equipment.grenades.flash = 1; game.requestEquipment({ kind: 'throw', grenadeType: 'flash' });
  Object.assign(game.gearCombatState.projectiles[0], { x: 0, y: 1.6, z: 1, vx: 0, vy: 0, vz: 0, fuseRemaining: .01 });
  victim.model.rotation.y = 0; game.update(.01);
  assert.ok(victim.flashRemaining > 2.5 && victim.flashRemaining <= 3);
  const remaining = victim.flashRemaining; game.update(.1); assert.ok(Math.abs(victim.flashRemaining - (remaining - .1)) < 1e-8);
});

test('winning explosive hit stops later damage and duplicate death drops', t => {
  const game = arena(t); game.bots.forEach(bot => { bot.health = 1; });
  for (let i = 0; i < 14; i++) recordElimination(game.modeState, { killerId: 'local', victimId: 'bot-0', position: { x: 0, z: 0 }, lifeId: 100 + i });
  game.player.equipment.grenades.frag = 1; game.requestEquipment({ kind: 'throw', grenadeType: 'frag' });
  Object.assign(game.gearCombatState.projectiles[0], { x: 0, y: .12, z: 0, vx: 0, vy: 0, vz: 0, fuseRemaining: .01 }); game.update(.02);
  assert.equal(game.modeState.ended, true); assert.equal(game.bots[0].health, 0); assert.equal(game.bots[1].health, 1);
  assert.equal(game.match.kills, 15); assert.equal(game.lootState.drops.length, 1);
  game.update(3); assert.equal(game.lootState.drops.length, 1);
});

test('CTF carrier elimination drops its flag and equipment exactly once', t => {
  const game = arena(t, { modeId: 'ctf', bots: 1 }), victim = game.bots[0], base = game.world.definition.bases.red;
  positionBot(victim, base.x, 0, base.z); tickMode(game.modeState, .01, game.getActors());
  assert.equal(game.modeState.flags.red.carrierId, victim.id);
  game.damageActor('local', victim, 100); const flag = structuredClone(game.modeState.flags.red);
  game.damageActor('local', victim, 100);
  assert.deepEqual(game.modeState.flags.red, flag); assert.equal(flag.status, 'dropped'); assert.equal(game.lootState.drops.length, 1);
});

test('posthumous grenade resolves once and credits its earlier life', t => {
  const game = arena(t, { bots: 1 }), victim = game.bots[0]; victim.health = 1;
  game.player.equipment.grenades.frag = 1; game.requestEquipment({ kind: 'throw', grenadeType: 'frag' });
  Object.assign(game.gearCombatState.projectiles[0], { x: 0, y: .12, z: 0, vx: 0, vy: 0, vz: 0, fuseRemaining: .01 });
  game.damageActor(victim.id, game.player, 100); game.update(.02);
  assert.equal(game.match.kills, 1); assert.equal(game.match.deaths, 1); assert.equal(game.lootState.drops.length, 2);
  game.update(.1); assert.equal(game.match.kills, 1);
});

test('equipment actions reject malformed shapes without mutation or throwing', t => {
  const game = arena(t, { bots: 0 }); game.player.equipment.grenades.frag = 1;
  const before = game.getEquipmentView();
  for (const action of [null, [], { kind: '__proto__' }, { kind: 'toString' },
    { kind: 'equip-gun', weaponId: 'mp5', source: 'armory', extra: true },
    { kind: 'throw', grenadeType: 'frag', [Symbol('extra')]: true }]) {
    assert.equal(game.requestEquipment(action).ok, false);
    assert.deepEqual(game.getEquipmentView(), before);
  }
});

test('carried gun ammo and reload timers advance once without refilling during switches', t => {
  const game = arena(t, { bots: 0 });
  game.requestEquipment({ kind: 'equip-gun', weaponId: 'mp5', source: 'armory' });
  game.weaponState.ammo = 20; game.weaponState.reserve = 400; game.weaponState.reloadRemaining = 1;
  game.requestEquipment({ kind: 'equip-gun', weaponId: 'scar', source: 'armory' });
  game.update(.1);
  const mp5 = game.player.equipment.owned.get('mp5'); assert.ok(Math.abs(mp5.reloadRemaining - .9) < 1e-8);
  game.requestEquipment({ kind: 'equip-gun', weaponId: 'mp5', source: 'inventory' });
  assert.equal(game.weaponState.ammo, 20); assert.equal(game.weaponState.reserve, 400);
});

test('death invalidates remembered enemy goals and its drops receive their full unlock delay', t => {
  const game = arena(t), [victim, observer] = game.bots;
  observer.lastKnownTargets.set(victim.id, { x: 0, z: 0, lifeId: victim.lifeId });
  observer.intent = { goal: { x: 0, z: 0 }, targetId: victim.id }; observer.intentTimer = .25;
  game.player.equipment.grenades.frag = 1; game.requestEquipment({ kind: 'throw', grenadeType: 'frag' }); victim.health = 1;
  Object.assign(game.gearCombatState.projectiles[0], { x: 0, y: .12, z: 0, vx: 0, vy: 0, vz: 0, fuseRemaining: .01 });
  game.update(.01);
  assert.equal(observer.lastKnownTargets.has(victim.id), false); assert.equal(observer.intentTimer, 0);
  assert.equal(game.lootState.drops[0].availableRemaining, .5);
});

test('bot respawn does not bypass the six second grenade attempt interval', t => {
  const game = arena(t, { bots: 1 }), bot = game.bots[0];
  bot.lastGrenadeAttempt = 0; game.spawnBot(bot); bot.equipment.grenades.frag = 1; bot.protected = 0;
  positionBot(bot, 0, 0, 0); game.updateBots(.1);
  assert.equal(bot.equipment.grenades.frag, 1); assert.equal(game.gearCombatState.projectiles.length, 0);
});

test('solo rule events preserve melee and grenade feedback with monotonic IDs', t => {
  const game = arena(t, { bots: 0 }); pickupEquipment(game.player.equipment, { kind: 'knife' });
  game.requestEquipment({ kind: 'held-item', heldItem: 'knife' }); game.input.fire = true; game.update(.01);
  assert.equal(game.gearEvents[0]?.type, 'melee'); assert.equal(game.gearEvents[0]?.id, 1);
  game.input.fire = false; game.player.equipment.grenades.frag = 1;
  game.requestEquipment({ kind: 'throw', grenadeType: 'frag' }); game.update(.1);
  assert.equal(game.gearEvents[0]?.type, 'grenade-throw'); assert.equal(game.gearEvents[0]?.id, 2);
  game.update(.01); assert.deepEqual(game.gearEvents, []);
});

test('a simulation substep constructs one actor list even when combat eliminates a victim', t => {
  const game = arena(t, { gun: 'awp', bots: 1 });
  t.mock.method(Math, 'random', () => .5);
  let builds = 0; const getActors = game.getActors.bind(game);
  t.mock.method(game, 'getActors', () => { builds++; return getActors(); });
  game.input.fire = true; game.input.firePressed = true; game.simulate(.01);
  assert.equal(game.bots[0].health, 0); assert.equal(builds, 1);
});

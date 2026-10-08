import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS } from '../src/maps.js';
import { createHeadlessGame, cleanupGame, positionBot, setWorldSolids } from './helpers/game-fixture.js';
import { requestHide as enterState } from '../src/hiding.js';

function fixture(t, settings = {}) {
  const game = createHeadlessGame(); t.after(() => cleanupGame(game)); game.start('m4a1', { bots: 0, ...settings });
  const spot = game.world.definition.hideSpots[0]; Object.assign(game.player, spot.entry, { jump: spot.entry.y, grounded: true, protected: 0 });
  game.placeCamera(); return { game, spot };
}
const enter = game => game.requestHide({ kind: 'enter', spotId: game.world.definition.hideSpots[0].id });

for (const map of MAPS) test(`${map.id}: real solo Hide freezes movement but allows look and empty Fire exits`, t => {
  const { game, spot } = fixture(t, { mapId: map.id }), before = structuredClone(game.player.equipment);
  assert.equal(enter(game).ok, true); assert.equal(game.getHidingView().label, 'Exit');
  assert.deepEqual(game.camera.position.toArray(), [spot.view.x, spot.view.y, spot.view.z]);
  const yaw = game.yaw;
  game.input.keys.add('KeyW'); game.input.jump = true; game.input.look.x = 20; game.update(.1);
  assert.equal(game.player.hiddenSpotId, spot.id); assert.equal(game.player.x, spot.occupant.x); assert.equal(game.player.z, spot.occupant.z);
  assert.equal(game.player.jump, spot.occupant.y); assert.notEqual(game.yaw, yaw);
  assert.deepEqual(game.player.equipment, before); assert.equal(game.weaponModel.visible, false);
  game.input.clear(); game.weaponState.ammo = game.weaponState.reserve = 0; game.input.firePressed = true; game.update(.01);
  assert.equal(game.player.hiddenSpotId, null); assert.equal(game.player.x, spot.exit.x); assert.equal(game.player.z, spot.exit.z);
  assert.equal(game.weaponState.ammo, 0); assert.equal(game.weaponModel.visible, true);
});

test('enter immediately clears witnessed bot and zombie tracking without waiting for another AI tick', t => {
  for (const modeId of ['ffa', 'zombies']) {
    const { game } = fixture(t, { modeId, bots: 1 });
    if (modeId === 'zombies') game.update(.01);
    const bot = game.bots[0], brain = bot.brain ?? bot;
    if (bot.brain) { brain.targetId = 'local'; brain.goal = { x: game.player.x, y: 0, z: game.player.z }; }
    else { brain.lastKnownTargets.set('local', { x: game.player.x, y: 0, z: game.player.z, lifeId: game.player.lifeId }); brain.intent = { targetId: 'local', goal: { x: game.player.x, y: 0, z: game.player.z } }; }
    assert.equal(enter(game).ok, true); assert.equal(brain.lastKnownTargets?.has('local') ?? false, false);
    assert.equal(brain.targetId ?? brain.intent?.targetId ?? null, null); assert.equal(brain.goal ?? brain.intent?.goal ?? null, null);
  }
});

test('healing completes hidden, reload stays allowed, and raw Fire during either exits without bypassing suppression', t => {
  const { game } = fixture(t); game.player.health = 40; game.player.equipment.supplies.health = 2;
  enter(game); assert.equal(game.requestEquipment({ kind: 'use-supply', supplyType: 'health' }).ok, true);
  game.update(5); assert.equal(game.player.health, 100); assert.equal(game.getHidingView().hidden, true);
  game.player.health = 90;
  assert.equal(game.requestEquipment({ kind: 'use-supply', supplyType: 'health' }).ok, true);
  const ammo = game.weaponState.ammo; game.input.firePressed = true; game.update(.01);
  assert.equal(game.player.hiddenSpotId, null); assert.equal(game.weaponState.ammo, ammo); assert.ok(game.player.equipment.supplyUse);
  game.requestEquipment({ kind: 'cancel-supply' }); enter(game); game.weaponState.ammo = 1;
  game.input.reload = true; game.update(.01); assert.ok(game.weaponState.reloadRemaining > 0); assert.equal(game.getHidingView().hidden, true);
  game.input.firePressed = true; game.update(.01); assert.equal(game.player.hiddenSpotId, null); assert.equal(game.weaponState.ammo, 1);
});

test('actual throws leave first and release from the exit; selecting gear leaves concealment alone', t => {
  const { game, spot } = fixture(t); enter(game); game.player.equipment.grenades.frag = 1;
  game.requestEquipment({ kind: 'select-grenade', grenadeType: 'frag' }); assert.equal(game.player.hiddenSpotId, spot.id);
  const result = game.requestEquipment({ kind: 'throw', grenadeType: 'frag' }); assert.equal(result.ok, true);
  assert.equal(game.player.hiddenSpotId, null); assert.equal(game.gearCombatState.projectiles.length, 1);
  const projectile = game.gearCombatState.projectiles[0];
  assert.ok(Math.abs(Math.hypot(projectile.x - spot.exit.x, projectile.z - spot.exit.z) - .45) < 1e-8);
});

test('armour-only damage forces exit, while lethal damage releases occupancy and safely drops once', t => {
  const { game, spot } = fixture(t, { bots: 1 }); const enemy = game.bots[0]; enemy.cooldown = 100;
  enter(game); game.player.armour = 100; game.damageActor(enemy.id, game.player, 10);
  assert.equal(game.player.health, 100); assert.equal(game.player.armour, 90); assert.equal(game.player.hiddenSpotId, null);
  assert.equal(game.player.x, spot.exit.x);
  enter(game); game.damageActor(enemy.id, game.player, 1000);
  assert.equal(game.hidingState.occupants.size, 0); assert.equal(game.player.hiddenSpotId, null);
  const count = game.lootState.drops.length; assert.ok(count > 0); assert.ok(game.lootState.drops.every(d => Math.hypot(d.x - spot.exit.x, d.z - spot.exit.z) < .36));
  game.damageActor(enemy.id, game.player, 1000); assert.equal(game.lootState.drops.length, count);
});

test('zero, invalid and protected damage cannot eject; changing held equipment remains visually concealed', t => {
  const { game, spot } = fixture(t, { bots: 1 }); enter(game);
  game.damageActor(game.bots[0].id, game.player, 0);
  assert.equal(game.player.hiddenSpotId, spot.id);
  game.damageActor(game.bots[0].id, game.player, NaN); assert.equal(game.player.hiddenSpotId, spot.id);
  game.player.protected = 1; game.damageActor(game.bots[0].id, game.player, 50); assert.equal(game.player.hiddenSpotId, spot.id);
  game.player.equipment.knife = true; game.requestEquipment({ kind: 'held-item', heldItem: 'knife' });
  assert.equal(game.player.hiddenSpotId, spot.id); assert.equal(game.weaponModel.visible, false);
});

test('an already-thrown grenade damages and ejects a hidden player, while a hidden CTF carrier cannot capture', t => {
  const { game, spot } = fixture(t, { bots: 1, modeId: 'ctf' });
  const enemy = game.bots[0]; enemy.cooldown = 100; enter(game);
  game.gearCombatState.projectiles.push({ id: 'test-grenade', grenadeType: 'frag', ownerId: enemy.id, ownerLifeId: enemy.lifeId,
    x: spot.entry.x, y: 1.6, z: spot.entry.z, vx: 0, vy: 0, vz: 0, fuseRemaining: 0 });
  game.update(.01); assert.ok(game.player.health < 100); assert.equal(game.player.hiddenSpotId, null);
  enter(game); Object.assign(game.modeState.flags.blue, { status: 'carried', carrierId: 'local', x: game.player.x, y: 0, z: game.player.z });
  game.update(.01); assert.equal(game.modeState.teamScores.red, 0); assert.equal(game.objectives.flags.blue.visible, false);
});

test('proxy gun hit is ordinary body damage, and one lethal bullet awards only one elimination', t => {
  t.mock.method(Math, 'random', () => .5);
  const { game, spot } = fixture(t, { bots: 1 }), bot = game.bots[0];
  const xp = []; game.events.onProgression = event => xp.push(event);
  // Bots never activate hides, but this arrangement exercises the same runtime damage adapter against a hidden actor.
  positionBot(bot, spot.entry.x, 0, spot.entry.z); bot.protected = 0;
  const record = game.getActors()[1];
  const transition = enterState(game.hidingState, record, { kind: 'enter', spotId: spot.id, lifeId: bot.lifeId }, { map: game.world.definition, world: game.world.spatial, active: true });
  assert.equal(transition.ok, true); game.applyHidingTransition(bot, transition);
  setWorldSolids(game, game.world.solids.filter(s => spot.shellIds.includes(s.id)));
  const dx = spot.entry.x - spot.occupant.x, dz = spot.entry.z - spot.occupant.z, length = Math.hypot(dx, dz);
  Object.assign(game.player, { x: spot.occupant.x - dx / length * 2, z: spot.occupant.z - dz / length * 2 });
  game.yaw = Math.atan2(-dx, -dz); game.pitch = 0; game.placeCamera();
  game.shoot(false, game.getActors()); assert.equal(bot.health, 100 - game.weapon.damage); assert.equal(bot.hiddenSpotId, null);
  // Re-enter at a new known setup, retaining the same life and its remaining health.
  positionBot(bot, spot.entry.x, 0, spot.entry.z);
  const again = enterState(game.hidingState, game.getActors()[1], { kind: 'enter', spotId: spot.id, lifeId: bot.lifeId }, { map: game.world.definition, world: game.world.spatial, active: true });
  game.applyHidingTransition(bot, again); bot.health = 1;
  game.shoot(false, game.getActors()); assert.equal(game.modeState.stats.local.kills, 1); assert.equal(game.hidingState.occupants.size, 0);
  game.shoot(false, game.getActors()); assert.equal(game.modeState.stats.local.kills, 1);
  assert.equal(xp.filter(event => event.type === 'update').length, 1); assert.equal(xp[0].tally.eliminations, 1);
});

test('menus neutralise hide/attack edges without exiting; quit and a new round release all occupancy', t => {
  const { game, spot } = fixture(t); enter(game); game.input.fire = true; game.input.hidePressed = true; game.pause(); game.update(.1);
  assert.equal(game.player.hiddenSpotId, spot.id); assert.equal(game.input.read().hidePressed, false);
  game.resume(); game.update(.01); assert.equal(game.player.hiddenSpotId, spot.id);
  game.quit(); assert.equal(game.hidingState.occupants.size, 0); assert.equal(game.player.hiddenSpotId, null);
  game.start('m4a1', { bots: 0 }); assert.equal(game.getHidingView().hidden, false);
});

test('invalid map startup leaves a stopped usable game that can start a valid round again', t => {
  const { game } = fixture(t); enter(game);
  const failed = game.tryStart('m4a1', { mapId: 'missing-map', bots: 0 });
  assert.equal(failed.ok, false); assert.match(failed.reason, /map/i);
  assert.equal(game.active, false); assert.equal(game.hasRound, false); assert.equal(game.hidingState.occupants.size, 0);
  assert.equal(game.tryStart('m4a1', { mapId: 'courtyard', bots: 0 }).ok, true); assert.equal(game.active, true);
});

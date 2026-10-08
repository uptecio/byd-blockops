import test from 'node:test';
import assert from 'node:assert/strict';
import {createHeadlessGame, cleanupGame, positionBot } from './helpers/game-fixture.js';
import { OnlineArena } from '../src/online-game.js';
import { RoomManager } from '../server/rooms.js';

// Catch flags bypassing the avatar's concealment, stale update order, and
// hidden flags surviving a recovery, carrier change, drop, or round reset.
function solo(t) {
  const game = createHeadlessGame(); t.after(() => cleanupGame(game));
  game.start('m4a1', { bots: 2, modeId: 'ctf' }); game.pause();
  Object.assign(game.player, { x: 0, z: 0 }); game.placeCamera();
  const enemy = game.bots[0], friend = game.bots[1];
  positionBot(enemy, 0, 0, -8); positionBot(friend, 8, 0, -8);
  const flag = game.modeState.flags.red;
  Object.assign(flag, { status: 'carried', carrierId: enemy.id });
  return { game, enemy, friend, flag, viewerId: 'local',
    conceal(type) { game.player.flashRemaining = type === 'flash' ? 3 : 0;
      game.gearCombatState.smokes = type === 'smoke' ? [{ id: 'smoke', x: 0, y: 1.6, z: -4, radius: 2, remaining: 8 }] : []; },
    render() { game.refreshMatchView(); game.update(.01); },
    placeFriend() { positionBot(friend, 0, 0, -8); },
    reset() { game.start('m4a1', { bots: 2, modeId: 'ctf' }); },
    end() { game.modeState.ended = true; },
  };
}

test('hidden local carriers conceal the world flag, and dropped flags retain roof elevation', t => {
  const { game } = solo(t);
  const carrier = { id: 'local', x: 0, y: 3, z: 0, hiddenSpotId: 'locker' };
  const flags = { red: { status: 'carried', carrierId: carrier.id, x: 0, y: 3, z: 0 } };
  game.objectives.update({ flags, actors: [carrier], viewerId: 'local' });
  assert.equal(game.objectives.flags.red.visible, false);
  Object.assign(flags.red, { status: 'dropped', carrierId: null });
  game.objectives.update({ flags, actors: [carrier], viewerId: 'local' });
  assert.equal(game.objectives.flags.red.visible, true); assert.equal(game.objectives.flags.red.position.y, 3);
});

function online(t) {
  const game = createHeadlessGame(); t.after(() => cleanupGame(game));
  const manager = new RoomManager(), room = manager.create('self', 'Viewer', 'm4a1', { modeId: 'ctf' });
  manager.join('enemy', room.code, 'Enemy'); manager.join('friend', room.code, 'Friend'); manager.start('self');
  Object.assign(room.players.get('self'), { x: 0, y: 0, z: 0 });
  Object.assign(room.players.get('enemy'), { x: 0, y: 0, z: -8 });
  Object.assign(room.players.get('friend'), { x: 8, y: 0, z: -8 });
  const snapshot = () => ({ ...manager.snapshot(room), selfEquipment: manager.equipmentSnapshot('self') });
  const arena = new OnlineArena(game, { send: () => true }); t.after(() => arena.stop());
  arena.start(snapshot(), 'self', {}); arena.pause();
  const enemy = { id: 'enemy', model: arena.remotes.get('enemy').model };
  const friend = { id: 'friend', model: arena.remotes.get('friend').model };
  const flag = room.modeState.flags.red; Object.assign(flag, { status: 'carried', carrierId: enemy.id });
  return { game, enemy, friend, flag, viewerId: 'self',
    conceal(type) { room.players.get('self').flashRemaining = type === 'flash' ? 3 : 0;
      room.gearCombatState.smokes = type === 'smoke' ? [{ id: 'smoke', x: 0, y: 1.6, z: -4, radius: 2, remaining: 8 }] : []; },
    render() { arena.sync(snapshot()); arena.update(.01); },
    placeFriend() { Object.assign(room.players.get('friend'), { x: 0, z: -8 }); positionBot(friend, 0, 0, -8); },
    reset() { arena.stop(); game.start('m4a1', { bots: 0, modeId: 'ctf' }); },
    end() { room.phase = 'ended'; room.modeState.ended = true; },
  };
}

for (const [runtime, fixture] of [['Solo', solo], ['Online', online]]) {
  for (const effect of ['smoke', 'flash']) test(`${runtime} carried enemy flag conceals and recovers with ${effect} in the same render`, t => {
    const f = fixture(t), { game, enemy } = f;
    f.conceal(null); f.render(); assert.equal(game.objectives.flags.red.visible, true);
    f.conceal(effect);
    game.renderer.render = () => {
      assert.equal(enemy.model.visible, false, 'avatar is concealed');
      assert.equal(game.objectives.flags.red.visible, false, 'carried flag cannot leak position in a frame');
    };
    f.render();
    assert.deepEqual(game.objectives.flags.red.position.toArray(), [0, 0, -8], 'hidden flag still follows its carrier');
    assert.equal(game.objectives.flags.blue.visible, true, 'home flag stays visible');
    assert.equal(game.objectives.bases.red.visible, true, 'base marker stays visible');
    game.renderer.render = () => {
      assert.equal(enemy.model.visible, true);
      assert.equal(game.objectives.flags.red.visible, true, 'flag recovers in the first clear frame');
    };
    f.conceal(null); f.render();
  });

  test(`${runtime} carried flags reset visibility on carrier changes, drops, returns and new rounds`, t => {
    const f = fixture(t), { game, flag } = f;
    f.conceal('flash'); f.render(); assert.equal(game.objectives.flags.red.visible, false);
    flag.carrierId = f.friend.id; f.render();
    assert.equal(f.friend.model.visible, true, 'unaffected teammate survives flash');
    assert.equal(game.objectives.flags.red.visible, true, 'unaffected teammate flag survives flash');
    flag.carrierId = f.viewerId; f.render();
    assert.equal(game.objectives.flags.red.visible, true, 'local first-person flag remains sensible');
    flag.carrierId = f.enemy.id; f.conceal('smoke'); f.render(); assert.equal(game.objectives.flags.red.visible, false);
    Object.assign(flag, { status: 'dropped', carrierId: null, x: 2, z: 3 }); f.render();
    assert.equal(game.objectives.flags.red.visible, true); assert.deepEqual(game.objectives.flags.red.position.toArray(), [2, 0, 3]);
    Object.assign(flag, { status: 'home', x: 0, z: 18 }); f.render(); assert.equal(game.objectives.flags.red.visible, true);
    Object.assign(flag, { status: 'carried', carrierId: f.enemy.id }); f.render(); assert.equal(game.objectives.flags.red.visible, false);
    f.end(); f.render(); f.reset();
    assert.equal(game.objectives.flags.red.visible, true); assert.equal(game.objectives.flags.blue.visible, true);
    assert.deepEqual(game.objectives.flags.red.position.toArray(), [0, 0, 18], 'new round renders its home flag immediately');
  });

  test(`${runtime} smoke conceals teammate carried flags but keeps local first-person flag presentation`, t => {
    const f = fixture(t); f.placeFriend(); f.flag.carrierId = f.friend.id;
    f.conceal('smoke'); f.render();
    assert.equal(f.friend.model.visible, false, 'smoke obscures the affected teammate too');
    assert.equal(f.game.objectives.flags.red.visible, false);
    f.flag.carrierId = f.viewerId; f.render();
    assert.equal(f.game.objectives.flags.red.visible, true);
  });
}

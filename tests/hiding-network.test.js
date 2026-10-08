import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startServer } from '../server/server.mjs';
import { RoomManager } from '../server/rooms.js';
import { RoomClient } from '../src/network.js';
import { OnlineArena } from '../src/online-game.js';
import { MAPS } from '../src/maps.js';
import { createNavigation } from '../src/navigation.js';
import { createHeadlessGame, cleanupGame } from './helpers/game-fixture.js';

async function until(check, milliseconds = 5000) {
  const deadline = performance.now() + milliseconds;
  while (performance.now() < deadline) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.fail('Timed out waiting for authoritative state');
}
function fixture(t) {
  const manager = new RoomManager(), room = manager.create('a', 'A'); manager.join('b', room.code, 'B'); manager.start('a');
  const a = room.players.get('a'), spot = room.map.hideSpots[0]; Object.assign(a, spot.entry);
  const game = createHeadlessGame(), sent = [], client = new RoomClient();
  client.id = a.id; client.connected = true; client.socket = { readyState: 1, send: text => sent.push(JSON.parse(text)), close() {} };
  const snapshot = () => ({ ...manager.snapshot(room), selfEquipment: manager.equipmentSnapshot(a.id), selfProgression: manager.progressionSnapshot(a.id) });
  client.room = snapshot(); const arena = new OnlineArena(game, client); arena.start(client.room, a.id, {});
  t.after(() => { arena.stop(); client.close(); cleanupGame(game); });
  return { manager, room, a, spot, game, client, arena, sent, snapshot };
}

test('online hide requests await acknowledgement and reconciliation; snapshots alone move the actor', t => {
  const f = fixture(t), { arena, game, client, spot, manager, a, sent, snapshot } = f;
  assert.equal(arena.requestHide({ kind: 'enter', spotId: spot.id }).ok, true);
  assert.equal(arena.getHidingView().pending, true); assert.equal(game.player.hiddenSpotId, null);
  const packet = sent.find(p => p.type === 'hide-action'); assert.equal(packet.seq, 1); assert.equal(packet.lifeId, a.lifeId);
  const result = manager.hideAction(a.id, packet);
  arena.receiveHideResult({ ...result, seq: 2 }); assert.equal(arena.getHidingView().pending, true);
  arena.receiveHideResult(result); assert.equal(arena.getHidingView().pending, true); assert.equal(game.player.hiddenSpotId, null);
  client.room = snapshot(); arena.sync(client.room); assert.equal(game.player.hiddenSpotId, spot.id);
  assert.equal(arena.getHidingView().pending, false);
  assert.deepEqual(game.camera.position.toArray(), [spot.view.x, spot.view.y, spot.view.z]);
  assert.equal(arena.getHidingView().label, 'Exit'); assert.equal(game.weaponModel.visible, false);
});

for (const attack of ['fire', 'throw']) test(`${attack} after hide acknowledgement but before snapshot exposes a healing player`, t => {
  const { arena, game, client, manager, a, spot, sent, snapshot } = fixture(t);
  a.health = 30; a.equipment.supplies.health = 1;
  assert.equal(manager.equipmentAction(a.id, { type: 'equipment-action', seq: 1, lifeId: a.lifeId,
    kind: 'use-supply', supplyType: 'health' }).ok, true);
  client.actionSeq = 1; client.room = snapshot(); arena.sync(client.room);
  arena.requestHide({ kind: 'enter', spotId: spot.id });
  const result = manager.hideAction(a.id, sent.find(p => p.type === 'hide-action'));
  arena.receiveHideResult(result); sent.length = 0;
  const ammo = a.equipment.owned.get(a.weaponId).ammo;
  game.input[`${attack}Pressed`] = true; arena.sendTimer = .04; arena.update(.01);
  for (const packet of sent) {
    if (packet.type === 'input') manager.input(a.id, packet);
    if (packet.type === 'equipment-action') manager.equipmentAction(a.id, packet);
  }
  assert.equal(a.hiddenSpotId, null, 'server receives raw intent and exposes before supply gating');
  assert.equal(a.x, spot.exit.x); assert.equal(a.z, spot.exit.z);
  assert.equal(game.player.hiddenSpotId, null, 'client never predicts concealment or movement from acknowledgement');
  manager.tick(.01); client.room = snapshot(); arena.sync(client.room);
  assert.equal(game.player.hiddenSpotId, null); assert.equal(arena.getHidingView().pending, false);
  assert.ok(a.equipment.supplyUse); assert.equal(a.equipment.owned.get(a.weaponId).ammo, ammo);
  assert.equal(a.equipment.supplies.health, 1); assert.equal(manager.roomFor(a.id).gearCombatState.projectiles.length, 0);
});

test('hide pending times out and reconciles later, while stale life/connection replies cannot affect a new life', t => {
  const { arena, client, manager, a, room, spot, game, sent, snapshot } = fixture(t);
  arena.requestHide({ kind: 'enter', spotId: spot.id }); const packet = sent.find(p => p.type === 'hide-action');
  arena.update(2.01); assert.equal(arena.getHidingView().pending, false);
  const result = manager.hideAction(a.id, packet); client.room = snapshot(); arena.sync(client.room); assert.equal(game.player.hiddenSpotId, spot.id);
  manager.spawn(room, a); client.room = snapshot(); arena.sync(client.room);
  const before = { x: game.player.x, y: game.player.y, z: game.player.z, lifeId: game.player.lifeId, hiddenSpotId: game.player.hiddenSpotId };
  arena.receiveHideResult(result); assert.equal(arena.getHidingView().pending, false);
  assert.deepEqual({ x: game.player.x, y: game.player.y, z: game.player.z, lifeId: game.player.lifeId, hiddenSpotId: game.player.hiddenSpotId }, before);
  Object.assign(a, spot.entry); client.room = snapshot(); arena.sync(client.room); arena.requestHide({ kind: 'enter', spotId: spot.id });
  client.socket = { ...client.socket }; arena.receiveHideResult({ ...result, seq: 2, lifeId: a.lifeId });
  assert.equal(game.player.hiddenSpotId, null); arena.stop(); assert.equal(arena.pendingHide, null);
});

test('online raw healing Fire and between-send throw intent reach the server without spending predicted equipment', t => {
  const { arena, game, client, a, manager, spot, sent, snapshot } = fixture(t);
  manager.hideAction(a.id, { type: 'hide-action', seq: 1, roundId: arena.room.roundId, lifeId: a.lifeId, kind: 'enter', spotId: spot.id });
  a.health = 30; a.equipment.supplies.health = 1; manager.equipmentAction(a.id, { type: 'equipment-action', seq: 1, lifeId: a.lifeId, kind: 'use-supply', supplyType: 'health' });
  client.room = snapshot(); arena.sync(client.room); sent.length = 0;
  game.input.firePressed = true; arena.sendTimer = .04; arena.update(.01);
  assert.equal(sent.find(p => p.type === 'input').firePressed, true); assert.equal(game.player.equipment.supplies.health, 1);
  sent.length = 0; game.input.throwPressed = true; arena.sendTimer = .04; arena.update(.01);
  assert.equal(sent[0].type, 'input'); assert.equal(sent[1].type, 'equipment-action'); assert.equal(sent[1].kind, 'throw');
  assert.equal(game.player.equipment.supplies.health, 1);
});

test('remote and carried-flag concealment survives snapshots, interpolation, and the results screen', t => {
  const { manager, room, a, spot, client, arena, game, snapshot } = fixture(t);
  // The same room is reconfigured through the real round lifecycle for team objectives.
  room.phase = 'ended'; manager.configure(a.id, { mapId: room.mapId, modeId: 'ctf' }); manager.start(a.id);
  const b = room.players.get('b'); Object.assign(b, room.map.bases.red, { protectedRemaining: 0 });
  manager.tick(.01); Object.assign(b, spot.entry);
  manager.hideAction(b.id, { type: 'hide-action', seq: 1, roundId: room.roundId, lifeId: b.lifeId, kind: 'enter', spotId: spot.id });
  client.room = snapshot(); arena.sync(client.room); arena.update(.01);
  assert.equal(arena.remotes.get(b.id).model.visible, false); assert.equal(game.objectives.flags.red.visible, false);
  room.phase = 'ended'; room.modeState.ended = true; client.room = snapshot(); arena.sync(client.room); arena.update(.01);
  assert.equal(arena.remotes.get(b.id).model.visible, false); assert.equal(game.objectives.flags.red.visible, false);
});

test('two real websocket clients receive private Hide results and late joins see concealed occupancy', async t => {
  const previous = globalThis.WebSocket; globalThis.WebSocket = WebSocket; t.after(() => { globalThis.WebSocket = previous; });
  const server = await startServer({ port: 0 }); t.after(() => server.close());
  const results = [[], []], errors = [], a = new RoomClient({ onHideResult: r => results[0].push(r), onError: e => errors.push(e) }),
    b = new RoomClient({ onHideResult: r => results[1].push(r), onError: e => errors.push(e) }), late = new RoomClient();
  t.after(() => { a.close(); b.close(); late.close(); });
  const url = `http://127.0.0.1:${server.port}`;
  await a.connect(url, { type: 'create', name: 'A', weaponId: 'm4a1' }); await b.connect(url, { type: 'join', code: a.room.code, name: 'B', weaponId: 'm4a1' });
  a.send({ type: 'start' }); await until(() => a.room?.phase === 'playing' && b.room?.phase === 'playing');
  const map = MAPS.find(map => map.id === a.room.mapId), spot = map.hideSpots[0], navigation = createNavigation(map, { radius: .4 });
  // First exercise a valid but out-of-range rejection over the private result channel.
  assert.ok(a.sendHideAction({ kind: 'enter', spotId: spot.id })); await until(() => results[0].length === 1);
  assert.equal(results[0][0].ok, false); assert.deepEqual(errors, []);
  async function walk(client) {
    const deadline = performance.now() + 20000;
    while (performance.now() < deadline) {
      const own = client.room.players.find(p => p.id === client.id), distance = Math.hypot(own.x - spot.entry.x, own.z - spot.entry.z);
      if (distance < .15) { client.send({ type: 'input', lifeId: own.lifeId, x: 0, y: 0, yaw: 0, pitch: 0 }); return; }
      const next = navigation.nextWaypoint(own, spot.entry); assert.ok(next);
      const dx = next.x - own.x, dz = next.z - own.z, length = Math.max(.05, Math.hypot(dx, dz));
      client.send({ type: 'input', lifeId: own.lifeId, x: dx / length, y: -dz / length, yaw: 0, pitch: 0 });
      await new Promise(resolve => setTimeout(resolve, 67));
    }
    assert.fail('Did not physically reach the hiding entrance');
  }
  await Promise.all([walk(a), walk(b)]); results[0].length = results[1].length = 0;
  a.sendHideAction({ kind: 'enter', spotId: spot.id }); b.sendHideAction({ kind: 'enter', spotId: spot.id });
  await until(() => results.every(list => list.length === 1));
  assert.equal(results.flat().filter(r => r.ok && r.hiddenSpotId === spot.id).length, 1);
  await late.connect(url, { type: 'join', code: a.room.code, name: 'Late', weaponId: 'm4a1' });
  assert.equal(late.room.players.filter(p => p.hiddenSpotId === spot.id).length, 1); assert.deepEqual(errors, []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/rooms.js';
import { MAPS } from '../src/maps.js';
import { canOccupy } from '../src/collision.js';

const controls = { x: 0, y: 0, yaw: 0, pitch: 0 };
function pair(mapId = 'courtyard', modeId = 'ffa', weaponId = 'awp') {
  const manager = new RoomManager({ random: () => 0.5 });
  const room = manager.create('a', 'A', weaponId, { mapId, modeId, skinId: 'space-guard' });
  manager.join('b', room.code, 'B', 'g17', { skinId: 'robo-unit' });
  return { manager, room, a: room.players.get('a'), b: room.players.get('b') };
}
function put(player, x, z) { Object.assign(player, { x, z, y: 0, protectedRemaining: 0 }); }
function fire(manager) { manager.input('a', { ...controls, firePressed: true }); manager.tick(1 / 30); }

test('FFA winner identity is frozen for late joiners after departure and reset on new configuration', () => {
  const { manager, room, a, b } = pair();
  assert.equal(manager.snapshot(room).winnerName, null);
  manager.start('a'); put(a, 0, 5); put(b, 0, -5); fire(manager); manager.tick(180);
  const final = manager.snapshot(room);
  assert.equal(final.phase, 'ended'); assert.equal(final.winnerId, 'a'); assert.equal(final.winnerName, 'A');
  manager.leave('a'); manager.join('c', room.code, 'Late Join', 'g17');
  const late = manager.snapshot(room);
  assert.equal(late.winnerId, 'a'); assert.equal(late.winnerName, 'A');
  assert.equal(late.players.some(player => player.id === 'a'), false);
  manager.start('b'); assert.equal(manager.snapshot(room).winnerName, null);
  manager.tick(180); assert.equal(manager.snapshot(room).winnerName, null, 'draw has no winner name');
  manager.configure('b', { mapId: 'harbor', modeId: 'tdm' });
  assert.equal(manager.snapshot(room).winnerName, null);
});

// Catches adapters silently falling back to the default map/mode or wrong team spawns.
for (const map of MAPS) for (const modeId of ['ffa', 'tdm', 'ctf']) {
  test(`${map.id}/${modeId} starts an authoritative round with safe mode-specific spawns`, () => {
    const { manager, room } = pair(map.id, modeId);
    const lobby = manager.snapshot(room);
    assert.equal(lobby.mapId, map.id); assert.equal(lobby.modeId, modeId);
    for (const player of lobby.players) {
      const spawns = modeId === 'ffa' ? [map.playerSpawn, ...map.spawns] : map.teamSpawns[player.teamId];
      assert.ok(spawns.some(spawn => spawn.x === player.x && spawn.z === player.z));
    }
    manager.start('a');
    const state = manager.snapshot(room);
    assert.equal(state.timeLeft, 180); assert.equal(state.phase, 'playing');
    assert.deepEqual(state.players.map(player => player.teamId), modeId === 'ffa' ? [null, null] : ['red', 'blue']);
    assert.deepEqual(state.teamScores, { red: 0, blue: 0 });
    assert.equal(state.flags === null, modeId !== 'ctf');
    for (const player of state.players) {
      const spawns = modeId === 'ffa' ? [map.playerSpawn, ...map.spawns] : map.teamSpawns[player.teamId];
      assert.ok(spawns.some(spawn => spawn.x === player.x && spawn.z === player.z));
      assert.ok(canOccupy(player.x, player.z, 0.4, map.solids));
      assert.equal(player.ammo + player.reserve, 500);
    }
    // Respawn and late joins must also retain the team's selected map pool.
    const victim = room.players.get('b'); victim.health = 0; victim.respawnRemaining = 0.01;
    manager.tick(1 / 30); manager.join('c', room.code, 'C', 'g17');
    for (const player of [victim, room.players.get('c')]) {
      const spawns = modeId === 'ffa' ? [map.playerSpawn, ...map.spawns] : map.teamSpawns[player.teamId];
      assert.ok(spawns.some(spawn => spawn.x === player.x && spawn.z === player.z));
    }
  });
}

test('configuration validates atomically and only the host can configure outside active rounds', () => {
  const { manager, room } = pair('courtyard', 'ctf');
  const before = manager.snapshot(room, false);
  for (const options of [{ mapId: 'missing', modeId: 'ffa' }, { mapId: 'snow-base', modeId: 'missing' }]) {
    assert.throws(() => manager.configure('a', options), /Unknown/);
    assert.deepEqual(manager.snapshot(room, false), before);
  }
  assert.throws(() => manager.configure('b', { mapId: 'snow-base', modeId: 'tdm' }), /host/i);
  manager.configure('a', { mapId: 'snow-base', modeId: 'tdm' });
  manager.start('a');
  assert.throws(() => manager.configure('a', { mapId: 'harbor', modeId: 'ctf' }), /progress|round/i);
  put(room.players.get('a'), 0, 20); put(room.players.get('b'), 0, 17); fire(manager);
  assert.equal(manager.snapshot(room).teamScores.red, 1);
  manager.tick(180);
  manager.configure('a', { mapId: 'harbor', modeId: 'ctf' });
  const state = manager.snapshot(room);
  assert.equal(state.phase, 'lobby'); assert.equal(state.timeLeft, 180);
  assert.equal(state.mapId, 'harbor'); assert.equal(state.modeId, 'ctf');
  assert.deepEqual(state.teamScores, { red: 0, blue: 0 });
  assert.equal(state.winnerTeamId, null); assert.equal(state.flags.blue.status, 'home');
  assert.ok(state.players.every(player => player.kills === 0 && player.deaths === 0));
});

test('unknown setup and skin IDs never change sessions or room membership', () => {
  const { manager, room, a } = pair();
  for (const settings of [{ mapId: 'fake' }, { modeId: 'fake' }, { skinId: 'fake' }]) {
    assert.throws(() => manager.create('new', 'N', 'g17', settings), /Unknown/);
    assert.equal(manager.roomFor('new'), undefined); assert.equal(manager.rooms.size, 1);
  }
  assert.throws(() => manager.join('new', room.code, 'N', 'g17', { skinId: 'fake' }), /Unknown/);
  assert.equal(room.players.size, 2); assert.equal(manager.roomFor('new'), undefined);
  assert.throws(() => manager.setSkin('a', 'fake'), /Unknown/);
  assert.equal(a.skinId, 'space-guard'); assert.equal(a.pendingSkinId, null);
  const before = manager.snapshot(room, false);
  assert.throws(() => manager.create('a', 'A', 'g17', { mapId: 'fake' }), /Unknown/);
  assert.throws(() => manager.join('a', room.code, 'A', 'g17', { skinId: 'fake' }), /Unknown/);
  assert.equal(manager.roomFor('a'), room); assert.deepEqual(manager.snapshot(room, false), before);
});

test('late joins choose the smaller team and round restart rebalances departed rosters', () => {
  const { manager, room, a, b } = pair('courtyard', 'tdm');
  manager.start('a');
  manager.join('c', room.code, 'C', 'g17'); manager.join('d', room.code, 'D', 'g17');
  assert.deepEqual([...room.players.values()].map(player => player.teamId), ['red', 'blue', 'red', 'blue']);
  manager.leave('b'); manager.leave('d');
  manager.join('e', room.code, 'E', 'g17');
  assert.equal(room.players.get('e').teamId, 'blue');
  manager.tick(180); const frozen = manager.snapshot(room);
  manager.leave('e'); manager.join('f', room.code, 'F', 'g17');
  const after = manager.snapshot(room);
  for (const key of ['timeLeft', 'winnerId', 'winnerTeamId', 'teamScores', 'flags']) assert.deepEqual(after[key], frozen[key]);
  manager.start('a');
  assert.deepEqual([...room.players.values()].map(player => player.teamId), ['red', 'blue', 'red']);
  assert.equal(a.kills, 0); assert.equal(b.deaths, 0);
});

test('skin changes are immediate in lobby, pending during play, and applied on respawn/start', () => {
  const { manager, room, a, b } = pair();
  manager.setSkin('a', 'desert-ops'); assert.equal(a.skinId, 'desert-ops');
  manager.start('a'); manager.setSkin('a', 'shadow-ninja');
  let player = manager.snapshot(room).players[0];
  assert.equal(player.skinId, 'desert-ops'); assert.equal(player.pendingSkinId, 'shadow-ninja');
  put(a, 0, -5); put(b, 0, 5); manager.equip('b', 'awp');
  manager.input('b', { ...controls, firePressed: true }); manager.tick(1 / 30); manager.tick(2.6);
  assert.equal(a.skinId, 'shadow-ninja'); assert.equal(a.pendingSkinId, null);
  manager.setSkin('a', 'arctic-scout'); manager.tick(180); manager.start('a');
  assert.equal(a.skinId, 'arctic-scout'); assert.equal(a.pendingSkinId, null);
});

test('team rays ignore teammates and kills count toward the 30 team target', () => {
  const { manager, room, a, b } = pair('courtyard', 'tdm');
  manager.join('c', room.code, 'C', 'g17'); manager.start('a');
  const teammate = room.players.get('c');
  put(a, 0, 5); put(teammate, 0, 0); put(b, 0, -5);
  fire(manager);
  assert.equal(teammate.health, 100); assert.equal(b.health, 0);
  assert.deepEqual(manager.snapshot(room).teamScores, { red: 1, blue: 0 });
  for (let kill = 1; kill < 30; kill++) {
    manager.tick(2.6);
    if (a.inventory.get('awp').ammo === 0) { manager.input('a', { ...controls, reload: true }); manager.tick(3.1); }
    put(a, 0, 5); put(teammate, 0, 0); put(b, 0, -5); fire(manager);
  }
  const state = manager.snapshot(room);
  assert.equal(state.phase, 'ended'); assert.equal(state.winnerTeamId, 'red'); assert.equal(state.winnerId, null);
  assert.equal(a.kills, 30); assert.equal(state.teamScores.red, 30);
});

test('lobby flags cannot be stolen and authoritative flag events cover pickup death return capture', () => {
  const { manager, room, a, b } = pair('courtyard', 'ctf');
  put(a, 0, -18); manager.input('a', { ...controls }); manager.tick(3);
  assert.equal(manager.snapshot(room).flags.blue.status, 'home');
  manager.start('a'); put(a, 0, -18); put(b, 0, -12);
  manager.tick(1 / 30);
  assert.equal(manager.snapshot(room, false).flags.blue.carrierId, 'a');
  manager.equip('b', 'awp'); manager.input('b', { ...controls, firePressed: true }); manager.tick(1 / 30);
  let state = manager.snapshot(room);
  assert.equal(state.flags.blue.status, 'dropped');
  assert.equal(state.flags.blue.returnRemaining <= 15, true);
  assert.deepEqual(state.events.filter(event => event.type.startsWith('flag-')).map(event => [event.type, event.teamId, event.playerId]), [['flag-pickup', 'blue', 'a'], ['flag-drop', 'blue', 'a']]);
  manager.tick(15); assert.equal(manager.snapshot(room).flags.blue.status, 'home');
  put(b, 10, 0);
  for (let capture = 0; capture < 3; capture++) {
    put(a, 0, -18); manager.tick(1 / 30); put(a, 0, 18); manager.tick(1 / 30);
  }
  state = manager.snapshot(room);
  assert.equal(state.phase, 'ended'); assert.equal(state.winnerTeamId, 'red'); assert.equal(state.teamScores.red, 3);
  assert.equal(a.kills, 0);
  const events = state.events;
  assert.equal(events.at(-1).type, 'flag-capture'); assert.equal(events.at(-1).teamId, 'red');
  assert.ok(events.every((event, i) => i === 0 || event.id > events[i - 1].id));
  const final = manager.snapshot(room); manager.tick(5);
  assert.deepEqual(manager.snapshot(room), final);
  // At timeout a carried flag is archived, including a carrier who later leaves.
  manager.start('a'); put(a, 0, -18); put(b, 10, 0); manager.tick(1 / 30);
  manager.tick(180); const archived = manager.snapshot(room);
  assert.equal(archived.flags.blue.carrierId, 'a');
  manager.leave('a'); manager.join('c', room.code, 'C', 'g17');
  const changedRoster = manager.snapshot(room);
  assert.equal(changedRoster.players.some(player => player.id === 'a'), false);
  for (const key of ['timeLeft', 'winnerId', 'winnerTeamId', 'teamScores', 'flags']) assert.deepEqual(changedRoster[key], archived[key]);
  manager.start('b'); assert.equal(manager.snapshot(room).flags.blue.status, 'home');
});

test('two map rooms keep objectives, snapshots, scores and nested inventories independent', () => {
  const { manager, room, a } = pair('courtyard', 'ctf');
  const other = manager.create('x', 'X', 'g17', { mapId: 'snow-base', modeId: 'ctf' });
  manager.join('y', other.code, 'Y', 'g17'); manager.start('a'); manager.start('x');
  put(a, 0, -18); manager.tick(1 / 30);
  const snapshot = manager.snapshot(room); snapshot.flags.blue.x = 999; snapshot.teamScores.red = 999; snapshot.players[0].ammo = 999;
  assert.equal(manager.snapshot(room).flags.blue.x, 0); assert.equal(manager.snapshot(room).teamScores.red, 0);
  assert.equal(manager.snapshot(other).flags.blue.status, 'home');
  assert.equal(manager.snapshot(other).players[0].ammo, 17);
  assert.equal(snapshot.stats, undefined); assert.equal(snapshot.players[0].inventory, undefined);
});

// Catches using Courtyard solids for another map, both for motion and for rays.
for (const map of MAPS) test(`${map.id} uses its walls for collisions and hitscan`, () => {
  const { manager, room, a, b } = pair(map.id);
  manager.start('a');
  const solid = map.solids.find(s => Math.abs(s.x) < 20 && Math.abs(s.z) < 20 && s.height >= 2);
  const front = solid.z + solid.d / 2 + 1;
  put(a, solid.x, front); put(b, solid.x, solid.z - solid.d / 2 - 1);
  fire(manager); assert.equal(b.health, 100);
  for (let step = 0; step < 20; step++) { manager.input('a', { ...controls, y: 1 }); manager.tick(0.1); }
  assert.ok(a.z >= solid.z + solid.d / 2 + 0.4 - 1e-8);
  manager.tick(1.5); put(a, 0, 20); put(b, 0, 17); fire(manager);
  assert.equal(b.health, 0); assert.equal(manager.snapshot(room).players[0].kills, 1);
});

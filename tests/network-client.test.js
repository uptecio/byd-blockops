import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RoomClient, normaliseServerUrl } from '../src/network.js';
import { OnlineArena } from '../src/online-game.js';
import { createHeadlessGame, cleanupGame } from './helpers/game-fixture.js';
import { RoomManager } from '../server/rooms.js';
import { SKINS } from '../src/skins.js';

const player = (id = 'p1') => ({ id, name: id, teamId: null, skinId: 'ranger', pendingSkinId: null, lifeId: 1, heldItem: 'gun', flashRemaining: 0, x: 2, z: 3, y: 0, yaw: 0, pitch: 0, health: 100, kills: 0, deaths: 0, weaponId: 'm4a1', ammo: 30, reserve: 470, reloadRemaining: 0, respawnRemaining: 0, protectedRemaining: 2 });
function room() {
  const value = { code: 'ABC123', hostId: 'p1', phase: 'playing', mapId: 'courtyard', modeId: 'ffa', timeLeft: 180, winnerId: null, winnerName: null, winnerTeamId: null, teamScores: { red: 0, blue: 0 }, flags: null, players: [player(), player('p2')], events: [], gear: { loot: [], projectiles: [], smokes: [] } };
  Object.defineProperty(value, 'selfEquipment', { enumerable: true, configurable: true, get() {
    const own = value.players[0];
    return { playerId: own.id, lifeId: own.lifeId, lastActionSeq: 0, equipment: {
      startingGunId: 'm4a1', activeGunId: own.weaponId, heldItem: own.heldItem, startingGunRemoved: own.weaponId !== 'm4a1',
      owned: own.health > 0 ? [{ weaponId: own.weaponId, ammo: own.ammo, reserve: own.reserve, cooldown: 0, reloadRemaining: own.reloadRemaining }] : [],
      knife: own.heldItem === 'knife', grenades: { frag: 0, smoke: 0, flash: 0 }, selectedGrenade: 'frag', throwRemaining: 0, attackLockRemaining: 0, meleeRemaining: 0,
      supplies: { health: 0, armour: 0 }, supplyUse: null,
    } };
  } });
  return value;
}
function ctfRoom() {
  const snapshot = room(); snapshot.modeId = 'ctf';
  snapshot.players[0].teamId = 'red'; snapshot.players[1].teamId = 'blue';
  snapshot.flags = { red: { teamId: 'red', status: 'home', x: 0, z: 18, carrierId: null, returnRemaining: 0 }, blue: { teamId: 'blue', status: 'home', x: 0, z: -18, carrierId: null, returnRemaining: 0 } };
  return snapshot;
}
class Socket extends EventTarget {
  static instances = [];
  constructor(url) { super(); this.url = url; this.readyState = 0; this.sent = []; Socket.instances.push(this); }
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
  message(packet) {
    if (packet?.room?.selfEquipment) {
      const { selfEquipment, ...publicRoom } = packet.room;
      packet = { ...packet, room: publicRoom, equipment: Object.hasOwn(packet, 'equipment') ? packet.equipment : selfEquipment };
    }
    this.dispatchEvent(new MessageEvent('message', { data: typeof packet === 'string' ? packet : JSON.stringify(packet) }));
  }
  send(text) { this.sent.push(JSON.parse(text)); }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
}
test('server URLs require secure public origins and reject embedded credentials', () => {
  assert.equal(normaliseServerUrl(' https://play.example.com/path '), 'https://play.example.com');
  assert.equal(normaliseServerUrl('http://127.0.0.1:4180/'), 'http://127.0.0.1:4180');
  assert.equal(normaliseServerUrl('http://localhost:4180'), 'http://localhost:4180');
  for (const value of ['', 'http://example.com', 'ftp://example.com', 'https://me:secret@example.com']) assert.throws(() => normaliseServerUrl(value));
});
test('welcome sets identity before room callback and only welcomed sockets send', async () => {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = Socket;
  try {
    const seen = [];
    const client = new RoomClient({ onRoom: snapshot => seen.push([client.id, snapshot.code]) });
    const pending = client.connect('https://play.example.com', { type: 'create', name: 'Alex', weaponId: 'm4a1' });
    const socket = Socket.instances.at(-1);
    assert.equal(socket.url, 'wss://play.example.com/ws');
    assert.equal(client.send({ type: 'start' }), false);
    socket.open();
    socket.message({ type: 'welcome', protocol: 3, id: 'p1', room: room() });
    assert.equal((await pending).id, 'p1');
    assert.deepEqual(socket.sent[0], { type: 'create', protocol: 3, name: 'Alex', weaponId: 'm4a1', mapId: 'courtyard', modeId: 'ffa', skinId: 'ranger' });
    assert.deepEqual(seen, [['p1', 'ABC123']]);
    assert.equal(client.connected, true);
    assert.equal(client.send({ type: 'start' }), true);
    client.close();
    assert.equal(client.connected, false);
  } finally { globalThis.WebSocket = original; }
});
test('malformed snapshots never replace a valid room, and intentional close suppresses disconnect', async () => {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = Socket;
  try {
    const errors = [], disconnected = [];
    const client = new RoomClient({ onError: error => errors.push(error), onDisconnect: () => disconnected.push(true) });
    const pending = client.connect('http://localhost:4180', { type: 'join', code: 'ABC123', name: 'Alex', weaponId: 'm4a1' });
    const socket = Socket.instances.at(-1); socket.open();
    socket.message({ type: 'welcome', protocol: 3, id: 'p1', room: room() });
    await pending;
    socket.message('{');
    socket.message({ type: 'state', protocol: 3, room: { ...room(), players: [{ ...player(), x: null }] } });
    assert.equal(client.room.players.length, 2);
    assert.equal(errors.length, 2);
    const previous = client.room;
    socket.message({type:'state',protocol:3,room:room(),equipment:{playerId:'wrong-recipient'}});
    assert.equal(client.room,previous);
    client.close();
    assert.equal(disconnected.length, 0);
  } finally { globalThis.WebSocket = original; }
});
test('server rejection before welcome closes the socket and rejects connection', async () => {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = Socket;
  try {
    const client = new RoomClient();
    const pending = client.connect('http://localhost:4180', { type: 'join', code: 'MISSING', name: 'Alex', weaponId: 'm4a1' });
    const socket = Socket.instances.at(-1); socket.open();
    socket.message({ type: 'error', message: 'Room not found' });
    await assert.rejects(pending, /Room not found/);
    assert.equal(socket.readyState, 3);
    assert.equal(client.connected, false);
  } finally { globalThis.WebSocket = original; }
});
test('unexpected close after welcome reports a disconnect once', async () => {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = Socket;
  try {
    let disconnected = 0;
    const client = new RoomClient({ onDisconnect: () => disconnected++ });
    const pending = client.connect('http://localhost:4180', { type: 'create', name: 'Alex', weaponId: 'm4a1' });
    const socket = Socket.instances.at(-1); socket.open();
    socket.message({ type: 'welcome', protocol: 3, id: 'p1', room: room() }); await pending;
    socket.close(); socket.close();
    assert.equal(disconnected, 1);
    assert.equal(client.connected, false);
  } finally { globalThis.WebSocket = original; }
});
test('a server that never welcomes times out and closes its connection', async context => {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = Socket;
  context.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const client = new RoomClient();
    const pending = client.connect('http://localhost:4180', { type: 'create', name: 'Alex', weaponId: 'm4a1' });
    const socket = Socket.instances.at(-1); socket.open();
    const rejected = assert.rejects(pending, /8 seconds/);
    context.mock.timers.tick(8000);
    await rejected;
    assert.equal(socket.readyState, 3);
    assert.equal(client.connected, false);
  } finally { globalThis.WebSocket = original; context.mock.timers.reset(); }
});

test('protocol 3 requests forward selected create options and only approved join fields', async () => {
  const original = globalThis.WebSocket; globalThis.WebSocket = Socket;
  try {
    for (const [request, expected] of [
      [{ type: 'create', name: 'Alex', weaponId: 'awp', mapId: 'harbor', modeId: 'ctf', skinId: 'space-guard', protocol: 1, kills: 99 }, { type: 'create', protocol: 3, name: 'Alex', weaponId: 'awp', mapId: 'harbor', modeId: 'ctf', skinId: 'space-guard' }],
      [{ type: 'join', code: 'ABC123', name: 'Alex', weaponId: 'awp', skinId: 'shadow-ninja', mapId: 'harbor', modeId: 'ctf' }, { type: 'join', protocol: 3, code: 'ABC123', name: 'Alex', weaponId: 'awp', skinId: 'shadow-ninja' }],
    ]) {
      const client = new RoomClient();
      const pending = client.connect('http://localhost:4180', request);
      const socket = Socket.instances.at(-1); socket.open();
      socket.message({ type: 'welcome', protocol: 3, id: 'p1', room: room() });
      await pending; client.close(); assert.deepEqual(socket.sent[0], expected);
    }
  } finally { globalThis.WebSocket = original; }
});

test('old servers and version rejection require an update before any gameplay callback', async () => {
  const original = globalThis.WebSocket; globalThis.WebSocket = Socket;
  try {
    for (const reply of [
      { type: 'welcome', id: 'p1', room: room() },
      { type: 'welcome', protocol: 1, id: 'p1', room: room() },
      { type: 'error', message: 'Update required: install the latest Block Ops APK or reload the game.' },
    ]) {
      let rooms = 0;
      const client = new RoomClient({ onRoom: () => rooms++ });
      const pending = client.connect('http://localhost:4180', { type: 'create' });
      const rejected = assert.rejects(pending, /update required/i);
      const socket = Socket.instances.at(-1); socket.open(); socket.message(reply);
      await rejected;
      assert.equal(rooms, 0); assert.equal(client.connected, false); assert.equal(socket.readyState, 3);
      client.close();
    }
  } finally { globalThis.WebSocket = original; }
});

test('invalid protocol 3 updates preserve the last valid room including objectives', async () => {
  const original = globalThis.WebSocket; globalThis.WebSocket = Socket;
  try {
    const errors = [];
    const client = new RoomClient({ onError: error => errors.push(error) });
    const pending = client.connect('http://localhost:4180', { type: 'create' });
    const socket = Socket.instances.at(-1); socket.open();
    socket.message({ type: 'welcome', protocol: 3, id: 'p1', room: ctfRoom() }); await pending;
    const good = client.room;
    const mutations = [
      snapshot => { snapshot.mapId = 'unknown'; }, snapshot => { snapshot.modeId = 'unknown'; },
      snapshot => { snapshot.players[0].skinId = 'unknown'; }, snapshot => { snapshot.players[0].pendingSkinId = 'unknown'; },
      snapshot => { snapshot.players[0].teamId = 'green'; }, snapshot => { snapshot.players[0].teamId = null; },
      snapshot => { snapshot.players[0].x = NaN; }, snapshot => { snapshot.players[0].kills = NaN; },
      snapshot => { snapshot.teamScores.red = NaN; }, snapshot => { snapshot.teamScores.blue = -1; },
      snapshot => { snapshot.timeLeft = Infinity; }, snapshot => { snapshot.winnerTeamId = 'green'; },
      snapshot => { snapshot.winnerName = 4; }, snapshot => { snapshot.winnerName = 'unearned'; },
      snapshot => { snapshot.teamScores.green = 1; }, snapshot => { snapshot.flags.green = { ...snapshot.flags.red }; },
      snapshot => { snapshot.winnerId = 'p1'; }, snapshot => { snapshot.flags = null; },
      snapshot => { snapshot.flags.red.teamId = 'blue'; }, snapshot => { snapshot.flags.blue.status = 'missing'; },
      snapshot => { snapshot.flags.blue.x = NaN; }, snapshot => { snapshot.flags.red.returnRemaining = NaN; },
      snapshot => { snapshot.flags.red.carrierId = 'p2'; },
      snapshot => { Object.assign(snapshot.flags.blue, { status: 'carried', carrierId: 'departed' }); },
      snapshot => { Object.assign(snapshot.flags.blue, { status: 'carried', carrierId: 'p2' }); },
      snapshot => { Object.assign(snapshot.flags.blue, { status: 'carried', carrierId: 'p1' }); snapshot.players[0].health = 0; },
      snapshot => { Object.assign(snapshot.flags.blue, { status: 'carried', carrierId: 'p1' }); snapshot.players[0].respawnRemaining = 1; },
      snapshot => { snapshot.flags.red.returnRemaining = 1; },
      snapshot => { snapshot.hostId = 'absent'; }, snapshot => { snapshot.players.push({ ...snapshot.players[0] }); },
      snapshot => { snapshot.events = [{ id: 1, type: 'flag-pickup', teamId: 'green', playerId: 'p1' }]; },
      snapshot => { snapshot.events = [{ id: 1, type: 'flag-pickup', teamId: 'blue', playerId: null }]; },
      snapshot => { snapshot.events = [{ id: 1, type: 'shot', playerId: 'p1', from: { x: 1, y: NaN, z: 0 } }]; },
    ];
    for (const mutate of mutations) {
      const snapshot = ctfRoom(); mutate(snapshot);
      const before = errors.length;
      socket.message({ type: 'state', protocol: 3, room: snapshot });
      assert.equal(errors.length, before + 1, mutate.toString());
      assert.equal(client.room, good, mutate.toString());
    }
    socket.message({ type: 'state', protocol: 1, room: ctfRoom() });
    assert.match(errors.at(-1), /update required/i); assert.equal(client.room, good);
    const automaticReturn = ctfRoom(); automaticReturn.events = [{ id: 10, type: 'flag-return', teamId: 'blue', playerId: null }];
    socket.message({ type: 'state', protocol: 3, room: automaticReturn });
    assert.equal(client.room.events[0].type, 'flag-return');
    client.close();
  } finally { globalThis.WebSocket = original; }
});

const fixtureGames = new Set();
test.afterEach(() => { for (const game of fixtureGames) cleanupGame(game); fixtureGames.clear(); });
function fixture() {
  const packets = [], controls = [];
  const game = createHeadlessGame();
  fixtureGames.add(game);
  const clear = game.input.clear.bind(game.input);
  game.input.clear = () => { clear(); controls.length = 0; };
  game.input.read = () => controls.shift() || { x: 0, y: 0, lookX: 0, lookY: 0, fire: false, firePressed: false, jump: false, reload: false, zoom: false };
  const client = { send(packet) { packets.push(packet); return true; } };
  return { game, client, packets, controls };
}
test('online snapshots own ammo and clock while queued quick taps survive packet intervals', () => {
  const { game, client, packets, controls } = fixture();
  const online = new OnlineArena(game, client);
  online.start(room(), 'p1', { sensitivity: 1 });
  assert.equal(game.settings.bots, 0);
  assert.equal(game.active, false);
  online.update(.05); packets.length = 0;
  controls.push({ x: 1, y: 1, lookX: 10, lookY: 0, fire: true, firePressed: true, jump: true, reload: true, zoom: false });
  online.update(.01); online.update(.04);
  assert.equal(packets.length, 1);
  assert.equal(packets[0].firePressed, true);
  assert.equal(packets[0].jump, true);
  assert.equal(packets[0].reload, true);
  assert.equal(game.weaponState.ammo, 30);
  assert.equal(game.match.timeLeft, 180);
  assert.ok(game.yaw < 0);
  online.update(.05);
  assert.equal(packets.at(-1).firePressed, false);
  online.stop();
});
test('pausing sends neutral input, snapshots continue, and end callback fires only once', () => {
  const { game, client, packets } = fixture();
  let ended = 0;
  const online = new OnlineArena(game, client, { onEnd: () => ended++ });
  online.start(room(), 'p1', { sensitivity: 1 });
  online.pause();
  assert.equal(packets.at(-1).fire, false);
  assert.equal(packets.at(-1).x, 0);
  const snapshot = room(); snapshot.timeLeft = 150; snapshot.players[0].ammo = 29; snapshot.players[0].health = 40;
  online.sync(snapshot); online.update(.5);
  assert.equal(game.match.timeLeft, 150);
  assert.equal(game.weaponState.ammo, 29);
  assert.equal(game.player.health, 40);
  assert.equal(game.world.botGroup.children.length, 1);
  online.sync({ ...snapshot, phase: 'ended' }); online.sync({ ...snapshot, phase: 'ended' });
  assert.equal(ended, 1);
  online.stop();
  assert.equal(game.world.botGroup.children.length, 0);
});
test('snapshot reconciliation preserves local aim until respawn and removes departed players', () => {
  const { game, client } = fixture();
  const online = new OnlineArena(game, client);
  online.start(room(), 'p1', { sensitivity: 1 });
  game.yaw = 1; game.pitch = .2;
  const snapshot = room(); snapshot.players[0].yaw = 2;
  snapshot.players[0].x = 8; snapshot.players[0].weaponId = 'awp'; snapshot.players[0].ammo = 4; snapshot.players[0].reserve = 495;
  online.sync(snapshot); online.update(.1);
  assert.equal(game.yaw, 1);
  assert.equal(game.pitch, .2);
  assert.ok(game.player.x > 2 && game.player.x < 8);
  assert.equal(game.weapon.id, 'awp'); assert.equal(game.weaponState.ammo, 4);
  snapshot.players[0].respawnRemaining = 1; online.sync(snapshot);
  snapshot.players[0].respawnRemaining = 0; snapshot.players[0].x = 10;
  snapshot.players = [snapshot.players[0]]; online.sync(snapshot);
  assert.equal(game.yaw, 2);
  assert.equal(game.player.x, 10);
  assert.equal(game.world.botGroup.children.length, 0);
  online.stop();
});
test('replayed server shot events do not duplicate audio or locally spend ammunition', () => {
  const { game, client } = fixture();
  let shots = 0;
  game.audio.shoot = () => shots++;
  const online = new OnlineArena(game, client);
  online.start(room(), 'p1', { sensitivity: 1 });
  const snapshot = room(); snapshot.players[0].ammo = 29;
  snapshot.events = [{ id: 1, type: 'shot', playerId: 'p1', from: { x: 2, y: 1.65, z: 3 }, to: { x: 2, y: 1.65, z: -10 } }];
  online.sync(snapshot); online.sync(snapshot); online.update(.05);
  assert.equal(shots, 1);
  assert.equal(game.weaponState.ammo, 29);
  online.stop();
});

test('online shot recoil animates the weapon while camera aim matches the transmitted pitch', () => {
  const { game, client, packets } = fixture();
  // ArenaGame.placeCamera includes offline camera recoil. The online adapter
  // must correct that rotation so its reticle follows the authoritative ray.
  game.placeCamera = () => game.camera.rotation.set(game.pitch + game.recoil, game.yaw, 0, 'YXZ');
  const online = new OnlineArena(game, client);
  online.start(room(), 'p1', { sensitivity: 1 });
  game.pitch = .25;
  const snapshot = room();
  snapshot.events = [{ id: 1, type: 'shot', playerId: 'p1' }];
  online.sync(snapshot);
  online.update(.05);
  assert.ok(game.recoil > 0, 'authoritative shot triggers cosmetic recoil');
  assert.ok(game.weaponModel.position.z > -.5, 'weapon visibly recoils');
  assert.equal(game.camera.rotation.x, packets.at(-1).pitch, 'camera pitch matches server aiming input');
  assert.equal(game.camera.rotation.x, .25);
  online.stop();
});

test('online start loads the authoritative map and mode before reconciling a late join', () => {
  const { game, client } = fixture();
  const snapshot = ctfRoom(); snapshot.mapId = 'harbor'; snapshot.timeLeft = 103;
  snapshot.teamScores.red = 2; snapshot.players[0].skinId = 'space-guard';
  Object.assign(snapshot.players[0], { x: 12, y: 1, z: -8, protectedRemaining: 0 });
  Object.assign(snapshot.flags.blue, { status: 'carried', carrierId: 'p1', x: 12, z: -8 });
  const online = new OnlineArena(game, client);
  online.start(snapshot, 'p1', { sensitivity: 1, mapId: 'snow-base', modeId: 'ffa', skinId: 'ranger', bots: 8 });
  assert.equal(game.world.definition.id, 'harbor'); assert.equal(game.settings.modeId, 'ctf');
  assert.equal(game.player.skinId, 'space-guard'); assert.equal(game.player.teamId, 'red');
  assert.equal(game.player.id, 'p1'); assert.equal(game.player.x, 12); assert.equal(game.player.jump, 1);
  assert.equal(game.bots.length, 0); assert.equal(game.active, false);
  assert.equal(game.getMatchView().modeId, 'ctf'); assert.equal(game.getMatchView().teamScores.red, 2);
  assert.equal(game.getMatchView().timeLeft, 103); assert.equal(game.getMatchView().players.length, 2);
  assert.deepEqual(game.objectives.flags.blue.position.toArray(), [12, 1, -8]);
  const offlineAuthority = structuredClone(game.modeState);
  online.update(2);
  assert.deepEqual(game.modeState, offlineAuthority, 'online never ticks or scores offline rules');
  assert.equal(game.match.timeLeft, 103); assert.equal(game.matchView.teamScores.red, 2);
  snapshot.teamScores.red = 0; snapshot.flags.blue.x = 99;
  assert.equal(game.matchView.teamScores.red, 2, 'view owns its nested projection');
  assert.equal(game.matchView.flags.blue.x, 12);
  online.stop();
});

test('remote pending skins wait for authoritative respawn and every skin keeps readable team badges', () => {
  const { game, client } = fixture(); const online = new OnlineArena(game, client);
  const snapshot = ctfRoom(); online.start(snapshot, 'p1', { sensitivity: 1 });
  const original = online.remotes.get('p2').model;
  snapshot.players[1].pendingSkinId = 'space-guard'; snapshot.players[1].respawnRemaining = 1;
  online.sync(snapshot);
  assert.equal(online.remotes.get('p2').model, original); assert.equal(original.visible, false);
  assert.equal(original.userData.skinId, 'ranger', 'remote uses the shared avatar');
  let disposed = 0;
  original.getObjectByName('body').geometry.addEventListener('dispose', () => disposed++);
  snapshot.players[1].respawnRemaining = 0; snapshot.players[1].skinId = 'space-guard'; snapshot.players[1].pendingSkinId = null;
  snapshot.players[1].teamId = 'red'; snapshot.players[1].weaponId = 'awp'; snapshot.players[1].name = 'Respawned';
  online.sync(snapshot);
  const respawn = online.remotes.get('p2').model;
  assert.notEqual(respawn, original); assert.equal(disposed, 1); assert.equal(original.parent, null);
  assert.equal(respawn.userData.weaponId, 'awp'); assert.equal(respawn.visible, true);
  for (const skin of SKINS) for (const teamId of ['red', 'blue']) {
    snapshot.players[1].skinId = skin.id; snapshot.players[1].teamId = teamId; online.sync(snapshot);
    const model = online.remotes.get('p2').model;
    assert.equal(model.userData.skinId, skin.id); assert.equal(model.userData.teamId, teamId);
    const markers = []; model.traverse(object => { if (object.name === 'team-marker') markers.push(object); });
    assert.equal(markers.length, 4);
    for (const marker of markers) {
      assert.equal(marker.material.type, 'MeshBasicMaterial');
      assert.equal(marker.material.color.getHexString(), teamId === 'red' ? 'ff4141' : '3185ff');
    }
  }
  online.stop();
});

test('carried flags follow visible jumps and dropped flags use snapshot positions without local returns', () => {
  const { game, client } = fixture(); const online = new OnlineArena(game, client);
  const snapshot = ctfRoom(); online.start(snapshot, 'p1', { sensitivity: 1 });
  Object.assign(snapshot.flags.red, { status: 'carried', carrierId: 'p2', x: 8, z: 4 });
  Object.assign(snapshot.players[1], { x: 8, y: 1.2, z: 4 }); online.sync(snapshot); online.update(.05);
  const remote = online.remotes.get('p2').model;
  assert.deepEqual(game.objectives.flags.red.position.toArray(), remote.position.toArray());
  Object.assign(snapshot.flags.red, { status: 'dropped', carrierId: null, x: -7, z: 9, returnRemaining: 4 });
  online.sync(snapshot); online.update(5);
  assert.deepEqual(game.objectives.flags.red.position.toArray(), [-7, 0, 9]);
  assert.equal(game.getMatchView().flags.red.status, 'dropped'); assert.equal(game.getMatchView().flags.red.returnRemaining, 4);
  online.stop();
});

test('flag event owner and scoring team messages are deduplicated across snapshot replays', () => {
  const { game, client } = fixture(), messages = [];
  const online = new OnlineArena(game, client, { onToast: message => messages.push(message) });
  const snapshot = ctfRoom(); online.start(snapshot, 'p1', { sensitivity: 1 });
  snapshot.events = [
    { id: 1, type: 'flag-pickup', teamId: 'blue', playerId: 'p1' },
    { id: 2, type: 'flag-drop', teamId: 'blue', playerId: 'p1' },
    { id: 3, type: 'flag-return', teamId: 'blue', playerId: null },
    { id: 4, type: 'flag-capture', teamId: 'red', playerId: 'p1' },
  ];
  online.sync(snapshot); online.sync(snapshot);
  assert.equal(messages.length, 4);
  assert.match(messages[0], /BLUE FLAG.*PICK/i); assert.match(messages[1], /BLUE FLAG.*DROP/i);
  assert.match(messages[2], /BLUE FLAG.*RETURN/i); assert.match(messages[3], /RED.*CAPTURE/i);
  online.stop();
});

test('map changes between rounds dispose old remotes objectives and effects before the next snapshot', () => {
  const { game, client } = fixture(); const online = new OnlineArena(game, client);
  online.start(ctfRoom(), 'p1', { sensitivity: 1 });
  const oldObjectives = game.objectives, oldWorld = game.world, oldRemote = online.remotes.get('p2').model;
  assert.equal(oldRemote.userData.skinId, 'ranger', 'remote uses the shared avatar');
  const releases = { flag: 0, body: 0, effect: 0 };
  [...oldObjectives.geometries][0].addEventListener('dispose', () => releases.flag++);
  oldRemote.getObjectByName('body').geometry.addEventListener('dispose', () => releases.body++);
  game.tracer(new THREE.Vector3(), new THREE.Vector3(2, 1, 1), '#ffffff');
  game.effects[0].line.geometry.addEventListener('dispose', () => releases.effect++);
  online.pause();
  const snapshot = room(); snapshot.mapId = 'space-station'; snapshot.modeId = 'tdm'; snapshot.phase = 'lobby';
  snapshot.players[0].teamId = 'blue'; snapshot.players[1].teamId = 'red'; snapshot.players[1].x = -10;
  online.sync(snapshot);
  assert.notEqual(game.world, oldWorld); assert.equal(game.world.definition.id, 'space-station');
  assert.deepEqual(releases, { flag: 1, body: 1, effect: 1 }); assert.equal(oldObjectives.group.parent, null);
  assert.equal(game.matchView.modeId, 'tdm'); assert.equal(game.matchView.flags, null); assert.equal(game.input.enabled, false);
  assert.notEqual(online.remotes.get('p2').model, oldRemote); assert.equal(online.remotes.get('p2').model.position.x, -10);
  const objectives = game.objectives, remote = online.remotes.get('p2').model; let flagDisposed = 0, remoteDisposed = 0;
  [...objectives.geometries][0].addEventListener('dispose', () => flagDisposed++);
  remote.getObjectByName('body').geometry.addEventListener('dispose', () => remoteDisposed++);
  online.stop(); online.stop();
  assert.equal(flagDisposed, 1); assert.equal(remoteDisposed, 1); assert.equal(objectives.group.parent, null);
  assert.equal(game.world.botGroup.children.length, 0); assert.equal(game.effects.length, 0);
  assert.equal(game.input.enabled, false);
});

test('authoritative ended snapshots with departed carriers render frozen flags while Home remains suspended', async () => {
  const original = globalThis.WebSocket; globalThis.WebSocket = Socket;
  try {
    const manager = new RoomManager({ random: () => .5 });
    const state = manager.create('p1', 'Viewer', 'm4a1', { mapId: 'harbor', modeId: 'ctf' });
    manager.join('p2', state.code, 'Carrier', 'm4a1'); manager.start('p1');
    Object.assign(state.players.get('p2'), { x: 0, z: 18, y: 0, protectedRemaining: 0 }); manager.tick(1 / 30);
    assert.equal(manager.snapshot(state).flags.red.carrierId, 'p2');
    const { game, client: sender, packets } = fixture(); let ended = 0, homePending = true;
    const online = new OnlineArena(game, sender, { onEnd: () => { ended++; assert.equal(homePending, true); } });
    const client = new RoomClient({ onRoom: snapshot => online.running ? online.sync(snapshot) : online.start(snapshot, 'p1', { sensitivity: 1 }), onDisconnect: () => online.stop() });
    const pending = client.connect('http://localhost:4180', { type: 'join' });
    const socket = Socket.instances.at(-1); socket.open(); socket.message({ type: 'welcome', protocol: 3, id: 'p1', room: manager.snapshot(state), equipment: manager.equipmentSnapshot('p1') }); await pending;
    online.pause(); manager.tick(180); manager.leave('p2');
    const final = manager.snapshot(state);
    socket.message({ type: 'state', protocol: 3, room: final, equipment: manager.equipmentSnapshot('p1') }); online.update(.1); online.resume();
    assert.equal(client.room.flags.red.carrierId, 'p2'); assert.equal(game.matchView.ended, true);
    assert.deepEqual(game.objectives.flags.red.position.toArray(), [0, 0, 18]);
    assert.equal(ended, 1); assert.equal(online.suspended, true); assert.equal(game.input.enabled, false);
    assert.equal(packets.at(-1).fire, false); assert.equal(packets.at(-1).x, 0);
    socket.message({ type: 'state', protocol: 3, room: final, equipment: manager.equipmentSnapshot('p1') }); assert.equal(ended, 1);
    socket.close(); online.sync(final); online.update(.1); online.resume();
    assert.equal(online.running, false); assert.equal(game.input.enabled, false); assert.equal(homePending, true);
    homePending = false; client.close();
  } finally { globalThis.WebSocket = original; }
});

test('a fresh client joining after the FFA winner departs retains the authoritative frozen winner name', async () => {
  const original = globalThis.WebSocket; globalThis.WebSocket = Socket;
  try {
    const manager = new RoomManager({ random: () => .5 });
    const state = manager.create('winner', ' <Victor> ', 'awp'); manager.join('viewer', state.code, 'Viewer', 'm4a1'); manager.start('winner');
    Object.assign(state.players.get('winner'), { x: 0, y: 0, z: 5, protectedRemaining: 0 });
    Object.assign(state.players.get('viewer'), { x: 0, y: 0, z: -5, protectedRemaining: 0 });
    manager.input('winner', { lifeId: state.players.get('winner').lifeId, x: 0, y: 0, yaw: 0, pitch: 0, firePressed: true }); manager.tick(1 / 30); manager.tick(180);
    manager.leave('winner'); manager.join('late', state.code, 'Late Join', 'm4a1');
    const { game, client: sender } = fixture(); const online = new OnlineArena(game, sender);
    const errors = [];
    const client = new RoomClient({ onRoom: snapshot => online.running ? online.sync(snapshot) : online.start(snapshot, 'late', { sensitivity: 1 }), onError: message => errors.push(message) });
    const pending = client.connect('http://localhost:4180', { type: 'join', code: state.code });
    const socket = Socket.instances.at(-1); socket.open(); socket.message({ type: 'welcome', protocol: 3, id: 'late', room: manager.snapshot(state), equipment: manager.equipmentSnapshot('late') }); await pending;
    assert.equal(game.matchView.winnerId, 'winner'); assert.equal(game.matchView.winnerName, 'Victor');
    assert.equal(game.matchView.players.some(player => player.id === 'winner'), false);
    assert.equal(game.input.enabled, false); online.resume(); assert.equal(online.suspended, true);
    const valid = client.room;
    for (const winnerName of [null, '', 12]) {
      socket.message({ type: 'state', protocol: 3, room: { ...manager.snapshot(state), winnerName }, equipment: manager.equipmentSnapshot('late') });
      assert.equal(client.room, valid); assert.equal(game.matchView.winnerName, 'Victor');
    }
    assert.equal(errors.length, 3); online.stop(); client.close();
  } finally { globalThis.WebSocket = original; }
});

test('equipment actions share one connection sequence and current life across kinds rounds and respawns', async () => {
  const original = globalThis.WebSocket; globalThis.WebSocket = Socket;
  try {
    const seen = [], client = new RoomClient({ onRoom: snapshot => seen.push(snapshot.selfEquipment) });
    const pending = client.connect('http://localhost:4180', { type: 'create' });
    const socket = Socket.instances.at(-1); socket.open();
    socket.message({ type: 'welcome', protocol: 3, id: 'p1', room: room() }); await pending;
    assert.equal(seen[0].playerId, 'p1', 'private snapshot is attached before callback');
    assert.equal(client.sendEquipmentAction({ kind: 'equip-gun', weaponId: 'mp5', source: 'armory' }), true);
    assert.equal(client.sendEquipmentAction({ kind: 'throw', grenadeType: 'frag' }), true);
    const next = room(); next.players[0].lifeId = 2;
    socket.message({ type: 'state', protocol: 3, room: next });
    assert.equal(client.sendEquipmentAction({ kind: 'held-item', heldItem: 'knife' }), true);
    next.phase = 'ended'; socket.message({ type: 'state', protocol: 3, room: next });
    next.phase = 'playing'; next.players[0].lifeId = 3; socket.message({ type: 'state', protocol: 3, room: next });
    assert.equal(client.sendEquipmentAction({ kind: 'select-grenade', grenadeType: 'smoke' }), true);
    assert.deepEqual(socket.sent.filter(p => p.type === 'equipment-action').map(p => [p.seq, p.lifeId]), [[1, 1], [2, 1], [3, 2], [4, 3]]);
    const count = socket.sent.length;
    assert.equal(client.sendEquipmentAction({ kind: 'throw', grenadeType: 'frag', ammo: 3 }), false);
    assert.equal(socket.sent.length, count);
    const reconnect = client.connect('http://localhost:4180', { type: 'join' });
    const fresh = Socket.instances.at(-1); fresh.open(); fresh.message({ type: 'welcome', protocol: 3, id: 'p1', room: room() }); await reconnect;
    client.sendEquipmentAction({ kind: 'throw', grenadeType: 'flash' });
    assert.equal(fresh.sent.at(-1).seq, 1); client.close();
  } finally { globalThis.WebSocket = original; }
});

test('private equipment and public gear validate atomically including stale lives and extra keys', async () => {
  const original = globalThis.WebSocket; globalThis.WebSocket = Socket;
  try {
    const client = new RoomClient(), pending = client.connect('http://localhost:4180', { type: 'create' });
    const socket = Socket.instances.at(-1); socket.open();
    const current = room(); current.players[0].lifeId = 2;
    socket.message({ type: 'welcome', protocol: 3, id: 'p1', room: current }); await pending;
    const previous = client.room;
    for (const mutate of [
      p => { delete p.equipment; }, p => { p.equipment.equipment.grenades.frag = 4; },
      p => { p.equipment.equipment.owned[0].ammo = 29; }, p => { p.equipment.lifeId = 1; },
      p => { p.room.players[0].lifeId = 1; p.equipment.lifeId = 1; },
      p => { p.room.players[1].lifeId = 0; }, p => { p.room.players[1].heldItem = 'rocket'; },
      p => { p.room.players[1].flashRemaining = 4; },
      p => { p.room.players = { find: 1 }; },
      p => { p.room.players[1].health = 0; },
      p => { p.room.gear.smokes = [{ id: 'bad' }]; }, p => { p.room.gear.extra = []; },
      p => { p.room.selfEquipment = p.equipment; }, p => { p.extra = 'injected'; },
      p => { p.room.players[1].equipment = p.equipment.equipment; },
      p => { p.room.events = [{ id: 3, type: 'pickup', playerId: 'p1', itemId: 'item', item: { kind: 'grenade', grenadeType: 'invalid' } }]; },
      p => { p.room.events = [{ id: 3, type: 'shot', playerId: 'p1', inventory: [] }]; },
    ]) {
      const { selfEquipment, ...publicRoom } = current;
      const packet = structuredClone({ type: 'state', protocol: 3, room: publicRoom, equipment: selfEquipment });
      mutate(packet);
      // Bypass the fixture's convenience extraction to test actual wire keys.
      socket.message(JSON.stringify(packet)); assert.equal(client.room, previous, mutate.toString());
    }
    const good = room(); good.players[0].lifeId = 2;
    good.events = [{ id: 3, type: 'pickup', playerId: 'p1', itemId: 'item', item: { kind: 'knife' } }];
    socket.message({ type: 'state', protocol: 3, room: good });
    assert.equal(client.room.events[0].type, 'pickup'); client.close();
  } finally { globalThis.WebSocket = original; }
});

test('online reconciliation owns all ammo and never grants through setWeapon or replayed pickups', () => {
  const { game, client } = fixture(), messages = [];
  const online = new OnlineArena(game, client, { onToast: message => messages.push(message) });
  const snapshot = room(), privateSnapshot = snapshot.selfEquipment;
  privateSnapshot.equipment.owned.push({ weaponId: 'mp5', ammo: 7, reserve: 11, cooldown: 0, reloadRemaining: 0 });
  privateSnapshot.equipment.grenades.frag = 2;
  Object.defineProperty(snapshot, 'selfEquipment', { value: privateSnapshot, enumerable: true });
  online.start(snapshot, 'p1', { sensitivity: 1 });
  game.setWeapon = () => assert.fail('online must never use granting solo setter');
  client.sendEquipmentAction = () => true;
  const before = online.getEquipmentView();
  assert.deepEqual(online.requestEquipment({ kind: 'equip-gun', weaponId: 'mp5', source: 'inventory' }), { ok: true });
  assert.deepEqual(online.getEquipmentView(), before, 'queued action is not an inventory grant');
  snapshot.players[0].weaponId = 'mp5'; snapshot.players[0].ammo = 7; snapshot.players[0].reserve = 11;
  privateSnapshot.equipment.activeGunId = 'mp5'; privateSnapshot.equipment.startingGunRemoved = true;
  privateSnapshot.equipment.owned.shift();
  snapshot.events = [{ id: 1, type: 'pickup', playerId: 'p1', itemId: 'frag', item: { kind: 'grenade', grenadeType: 'frag' } }];
  online.sync(snapshot); online.sync(snapshot);
  assert.equal(game.weaponState.ammo, 7); assert.equal(game.weaponState.reserve, 11);
  assert.equal(game.inventory.has('m4a1'), false); assert.equal(online.getEquipmentView().grenades.frag, 2);
  assert.equal(messages.length, 1);
  privateSnapshot.equipment.owned[0].ammo = 1;
  assert.equal(game.weaponState.ammo, 7, 'client equipment is detached');
  const copy = online.getEquipmentView(); copy.grenades.frag = 0;
  assert.equal(online.getEquipmentView().grenades.frag, 2); online.stop();
});

test('late joins sync existing world without old effects and suspended removals reach the visual consumer', () => {
  const { game, client } = fixture(), messages = [], views = [];
  const online = new OnlineArena(game, client, { onToast: value => messages.push(value) });
  const snapshot = room();
  snapshot.gear.loot = [{ id: 'knife', x: 0, y: 0, z: 0, item: { kind: 'knife' }, source: 'map', availableRemaining: 0, expiresRemaining: null }];
  snapshot.gear.smokes = [{ id: 'smoke', ownerId: 'p2', x: 0, y: 0, z: 0, radius: 4, remaining: 6 }];
  snapshot.events = [{ id: 9, type: 'pickup', playerId: 'p1', itemId: 'old', item: { kind: 'knife' } }];
  online.start(snapshot, 'p1', { sensitivity: 1 });
  const sync = game.gearView.sync.bind(game.gearView);
  game.gearView.sync = value => { views.push(structuredClone(value)); sync(value); };
  assert.equal(messages.length, 0); assert.equal(game.gearWorld.smokes.length, 1);
  snapshot.gear.smokes[0].remaining = 1;
  assert.equal(game.gearWorld.smokes[0].remaining, 6, 'world is detached');
  online.pause(); snapshot.gear = { loot: [], projectiles: [], smokes: [] }; online.sync(snapshot);
  assert.deepEqual(views.at(-1), { loot: [], projectiles: [], smokes: [] });
  assert.deepEqual(game.gearWorld, { loot: [], projectiles: [], smokes: [] });
  assert.equal(game.gearView.loot.size, 0); assert.equal(game.gearView.smokes.size, 0);
  online.stop();
});

test('combat packets carry the current life and pending edges clear on death and round transitions', () => {
  const { game, client, packets, controls } = fixture();
  const online = new OnlineArena(game, client); online.start(room(), 'p1', { sensitivity: 1 });
  controls.push({ x: 0, y: 0, lookX: 0, lookY: 0, fire: true, firePressed: true, reload: true }); online.update(.05);
  assert.equal(packets.at(-1).lifeId, 1);
  online.sendTimer = 1; controls.push({ x: 0, y: 0, lookX: 0, lookY: 0, firePressed: true, reload: true }); online.update(.01);
  const snapshot = room(); snapshot.players[0].lifeId = 2; online.sync(snapshot); online.sendTimer = 0; online.update(.05);
  assert.equal(packets.at(-1).lifeId, 2); assert.equal(packets.at(-1).firePressed, false); assert.equal(packets.at(-1).reload, false);
  online.pending.firePressed = true; snapshot.players[0].health = 0; snapshot.players[0].ammo = snapshot.players[0].reserve = 0;
  online.sync(snapshot); assert.equal(online.pending.firePressed, false);
  online.pending.reload = true; snapshot.phase = 'ended'; online.sync(snapshot); assert.equal(online.pending.reload, false); online.stop();
});

test('replayed grenade and melee effects trigger each approved audio callback only once', () => {
  const { game, client } = fixture(), heard = [], effects = [];
  game.audio.swing = () => heard.push('swing'); game.audio.grenade = type => heard.push(type);
  const online = new OnlineArena(game, client); online.start(room(), 'p1', { sensitivity: 1 });
  const presentEvent = game.gearView.event.bind(game.gearView);
  game.gearView.event = event => { effects.push(event.id); presentEvent(event); };
  const snapshot = room(); snapshot.events = [
    { id: 1, type: 'melee', playerId: 'p2' },
    { id: 2, type: 'grenade-throw', playerId: 'p2', grenadeId: 'frag', grenadeType: 'frag' },
    { id: 3, type: 'grenade-burst', playerId: 'p2', grenadeId: 'frag', grenadeType: 'frag', position: { x: 0, y: 0, z: 0 } },
  ];
  online.sync(snapshot); online.sync(snapshot);
  assert.deepEqual(heard, ['swing', 'frag']); assert.deepEqual(effects, [1, 2, 3]);
  assert.equal(game.gearView.bursts.size, 1); online.stop(); assert.equal(game.gearView.bursts.size, 0);
});

test('failed input sends retain one-shot edges only until sent and pause clears queued attacks', () => {
  const { game, client, controls, packets } = fixture();
  const online = new OnlineArena(game, client); online.start(room(), 'p1', { sensitivity: 1 });
  client.send = packet => { packets.push(packet); return false; };
  controls.push({ x: 0, y: 0, lookX: 0, lookY: 0, firePressed: true, reload: true }); online.update(.05);
  assert.equal(online.pending.firePressed, true);
  client.send = packet => { packets.push(packet); return true; }; online.update(.05);
  assert.equal(packets.at(-1).firePressed, true); assert.equal(online.pending.firePressed, false);
  online.update(.05); assert.equal(packets.at(-1).firePressed, false);
  online.pending.firePressed = true; online.pending.reload = true; online.pause();
  assert.equal(packets.at(-1).firePressed, false); assert.equal(online.pending.reload, false);
  online.stop();
});

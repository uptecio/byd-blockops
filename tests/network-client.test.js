import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RoomClient, normaliseServerUrl } from '../src/network.js';
import { OnlineArena } from '../src/online-game.js';
import { createWeaponState, getWeapon } from '../src/weapons.js';

const player = (id = 'p1') => ({ id, name: id, x: 2, z: 3, y: 0, yaw: 0, pitch: 0, health: 100, kills: 0, deaths: 0, weaponId: 'm4a1', ammo: 30, reserve: 470, reloadRemaining: 0, respawnRemaining: 0, protectedRemaining: 2 });
const room = () => ({ code: 'ABC123', hostId: 'p1', phase: 'playing', timeLeft: 180, winnerId: null, players: [player(), player('p2')], events: [] });
class Socket extends EventTarget {
  static instances = [];
  constructor(url) { super(); this.url = url; this.readyState = 0; this.sent = []; Socket.instances.push(this); }
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
  message(packet) { this.dispatchEvent(new MessageEvent('message', { data: typeof packet === 'string' ? packet : JSON.stringify(packet) })); }
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
    assert.deepEqual(socket.sent[0], { type: 'create', name: 'Alex', weaponId: 'm4a1' });
    socket.message({ type: 'welcome', id: 'p1', room: room() });
    assert.equal((await pending).id, 'p1');
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
    socket.message({ type: 'welcome', id: 'p1', room: room() });
    await pending;
    socket.message('{');
    socket.message({ type: 'state', room: { ...room(), players: [{ ...player(), x: null }] } });
    assert.equal(client.room.players.length, 2);
    assert.equal(errors.length, 2);
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
    socket.message({ type: 'welcome', id: 'p1', room: room() }); await pending;
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

function fixture() {
  const packets = [], controls = [];
  const input = { zoom: false, setEnabled(value) { this.enabled = value; if (!value) this.clear(); }, clear() { controls.length = 0; this.zoom = false; }, read() { return controls.shift() || { x: 0, y: 0, lookX: 0, lookY: 0, fire: false, firePressed: false, jump: false, reload: false, zoom: false }; } };
  const game = {
    input, audio: { shoot() {}, hit() {}, kill() {}, reload() {} }, events: { onHud() {} },
    renderer: { render() {} }, camera: new THREE.PerspectiveCamera(75), scene: new THREE.Scene(), world: { botGroup: new THREE.Group() },
    player: {}, match: {}, weapon: getWeapon('m4a1'), weaponState: createWeaponState('m4a1'), weaponModel: new THREE.Group(),
    effects: [], muzzle: new THREE.Group(), recoil: 0, shotFlash: 0, hitFlash: 0, damageFlash: 0, yaw: 0, pitch: 0, time: 0,
    start(id, settings) { this.settings = settings; this.setWeapon(id); this.active = true; },
    setWeapon(id) { this.weapon = getWeapon(id); this.weaponState = createWeaponState(id); },
    pause() { this.active = false; input.setEnabled(false); }, placeCamera() {}, clearEffects() {}, tracer() {},
  };
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

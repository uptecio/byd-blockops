import test from 'node:test';
import { PROTOCOL_VERSION } from '../src/protocol.js';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { mkdir, writeFile } from 'node:fs/promises';
import { startServer } from '../server/server.mjs';
import { WEAPONS } from '../src/weapons.js';

test('eight real sockets bound saturated inventories/packets and disconnect a stalled reader', async t => {
  const server = await startServer({ port: 0, distDir: process.env.DIST_DIR || 'dist' });
  const clients = [], bytes = [];
  const failures = [];
  t.after(async () => { for (const client of clients) client.socket.terminate(); await server.close(); });
  const until = async (predicate, label) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
    assert.fail(label);
  };
  for (let i = 0; i < 8; i++) {
    const client = { socket: new WebSocket(`ws://127.0.0.1:${server.port}/ws`), sequence: 0, latest: null };
    clients.push(client);
    client.socket.on('message', data => {
      const packet = JSON.parse(data);
      if (packet.type === 'welcome') client.id = packet.id;
      if (packet.room) {
        client.latest = packet;
        bytes.push(data.length);
        const world = packet.room.gear;
        if (world && (world.loot.length > 68 || world.projectiles.length > 32 || world.smokes.length + world.projectiles.filter(p => p.grenadeType === 'smoke').length > 16)) failures.push('entity bound exceeded');
        if (data.length >= 65536) failures.push(`packet bound exceeded: ${data.length}`);
        if (packet.equipment?.equipment.owned.length > 29) failures.push('inventory bound exceeded');
      }
    });
    await new Promise((resolve, reject) => { client.socket.once('open', resolve); client.socket.once('error', reject); });
    client.send = packet => client.socket.send(JSON.stringify(packet));
    client.send({ type: i ? 'join' : 'create', protocol: PROTOCOL_VERSION, code: clients[0].latest?.room.code, name: `Saturation${i}`, weaponId: 'm4a1' });
    await until(() => client.id, 'real peer joins saturation room');
  }
  clients[0].send({ type: 'start' });
  await until(() => clients.every(client => client.latest?.room.phase === 'playing'), 'saturation room starts');
  const action = (client, weaponId) => client.send({ type: 'equipment-action', lifeId: client.latest.equipment.lifeId, seq: ++client.sequence, kind: 'equip-gun', weaponId, source: 'armory' });
  for (const gun of WEAPONS.filter(gun => gun.id !== 'm4a1')) for (const client of clients) action(client, gun.id);
  await until(() => clients.every(client => client.latest.equipment.equipment.owned.length === 28), 'all peers carry every non-starting catalog gun');
  assert.ok(clients.every(client => client.latest.room.players.length === 8));
  const host = clients[0];
  // Real inputs follow the end lane to the redistributed original gun.
  for (const [x, z] of [[0, 19], [-10, 19], [-10, 18]]) {
    for (let step = 0; step < 100; step++) {
      const player = host.latest.room.players.find(player => player.id === host.id);
      const dx = x - player.x, dz = z - player.z, length = Math.hypot(dx, dz);
      if (length < .4) break;
      host.send({ type: 'input', lifeId: player.lifeId, x: dx / length, y: -dz / length, yaw: 0, pitch: 0 });
      await new Promise(resolve => setTimeout(resolve, 70));
    }
  }
  host.send({ type: 'input', lifeId: host.latest.equipment.lifeId, x: 0, y: 0, yaw: 0, pitch: 0 });
  await until(() => host.latest.equipment.equipment.owned.length === 29, 'real socket movement recovers original gun and saturates all29 inventory entries');
  assert.equal(host.latest.equipment.equipment.activeGunId, 'minigun', 'collecting original gun never automatically equips it');
  const typical = [...bytes].sort((a, b) => a - b)[Math.floor(bytes.length / 2)];
  const stalled = clients[7];
  // Stop only this owned peer's TCP reads. The server's actual send buffer and
  // 256 KiB protection, rather than a fake bufferedAmount, must eject it.
  stalled.socket._socket.pause();
  await new Promise(resolve => setTimeout(resolve, 1100));
  for (let batch = 0; batch < 100 && !clients.slice(0, 7).some(client => client.latest.room.players.length === 7); batch++) {
    for (let n = 0; n < 10; n++) for (const client of clients.slice(0, 7)) action(client, n % 2 ? 'ak47' : 'mp5');
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  await until(() => clients.slice(0, 7).some(client => client.latest.room.players.length === 7 && !client.latest.room.players.some(player => player.id === stalled.id)), 'existing backpressure guard disconnects stalled real reader');
  stalled.socket._socket.resume();
  await until(() => stalled.socket.readyState === WebSocket.CLOSED, 'stalled owned socket closes');
  assert.deepEqual(failures, [], 'entity, inventory and packet bounds remain intact under real-socket saturation');
  const result = { peers: 8, carriedGunsPerPeer: clients.map(client => client.latest.equipment.equipment.owned.length), observations: bytes.length, typicalSerializedBytes: typical, maximumSerializedBytes: Math.max(...bytes), bounds: { loot: 68, projectiles: 32, smokeAndFlights: 16, packetBytes: 65536 }, stalledReaderDisconnected: true };
  const output = process.env.LOOT_ARTIFACTS || 'artifacts/loot-review';
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/saturation.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
});

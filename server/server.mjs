import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomManager } from './rooms.js';
import { PROTOCOL_VERSION } from '../src/protocol.js';

const FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/game.js', ['game.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/THREE-LICENSE.txt', ['THREE-LICENSE.txt', 'text/plain; charset=utf-8']],
]);

export async function startServer({ port = 0, host = '127.0.0.1', distDir = 'dist' } = {}) {
  const manager = new RoomManager();
  const connections = new Map();
  const root = resolve(distDir);
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end('Method not allowed.'); return; }
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/health') {
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ ok: true, rooms: manager.rooms.size })); return;
      }
      const file = FILES.get(pathname);
      if (!file) { response.writeHead(404).end('Not found.'); return; }
      const content = await readFile(resolve(root, file[0]));
      response.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch { response.writeHead(404).end('Game assets not found. Run npm run build.'); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  server.on('upgrade', (request, socket, head) => {
    try {
      if (new URL(request.url, 'http://localhost').pathname !== '/ws' || connections.size >= 256) {
        socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return;
      }
      wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws));
    } catch { socket.destroy(); }
  });
  const send = (socket, packet) => {
    if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 256 * 1024) socket.send(JSON.stringify(packet));
    else if (socket.bufferedAmount >= 256 * 1024) socket.terminate();
  };
  const broadcast = room => {
    if (!room || !room.players.size) return;
    const packet = { type: 'state', protocol: PROTOCOL_VERSION, room: manager.snapshot(room) };
    for (const id of room.players.keys()) { const connection = connections.get(id); if (connection) send(connection.socket, { ...packet, equipment: manager.equipmentSnapshot(id), progression: manager.progressionSnapshot(id) }); }
  };
  const flushEnded = id => { const room = manager.roomFor(id); if (room?.phase === 'ended') broadcast(room); };
  wss.on('connection', socket => {
    const id = randomUUID();
    const connection = { socket, count: 0, windowStart: performance.now(), alive: true };
    connections.set(id, connection);
    socket.on('pong', () => { connection.alive = true; });
    socket.on('error', () => {});
    socket.on('message', (data, binary) => {
      const now = performance.now();
      if (now - connection.windowStart >= 1000) { connection.windowStart = now; connection.count = 0; }
      if (++connection.count > 100) { socket.close(1008, 'Message rate exceeded'); return; }
      try {
        if (binary) throw new Error('Send JSON text messages.');
        let packet;
        try { packet = JSON.parse(data.toString()); } catch { throw new Error('Invalid JSON.'); }
        if (!packet || typeof packet !== 'object' || Array.isArray(packet) || typeof packet.type !== 'string') throw new Error('Invalid message.');
        switch (packet.type) {
          case 'create': case 'join': {
            if (packet.protocol !== PROTOCOL_VERSION) throw new Error('Update required: install the latest Block Ops APK or reload the game.');
            const room = packet.type === 'create' ? manager.create(id, packet.name, packet.weaponId, { mapId: packet.mapId, modeId: packet.modeId, skinId: packet.skinId, finishId: packet.finishId }) : manager.join(id, packet.code, packet.name, packet.weaponId, { skinId: packet.skinId, finishId: packet.finishId });
            send(socket, { type: 'welcome', protocol: PROTOCOL_VERSION, id, room: manager.snapshot(room, false), equipment: manager.equipmentSnapshot(id), progression: manager.progressionSnapshot(id) }); broadcast(room); break;
          }
          case 'configure': flushEnded(id); broadcast(manager.configure(id, { mapId: packet.mapId, modeId: packet.modeId })); break;
          case 'skin': case 'finish': {
            const key = packet.type === 'skin' ? 'skinId' : 'finishId';
            if (Object.keys(packet).length !== 2 || typeof packet[key] !== 'string') throw new Error('Invalid appearance message.');
            broadcast(packet.type === 'skin' ? manager.setSkin(id, packet.skinId) : manager.setFinish(id, packet.finishId)); break;
          }
          case 'start': flushEnded(id); broadcast(manager.start(id)); break;
          case 'input': manager.input(id, packet); break;
          case 'loadout': broadcast(manager.setLoadout(id, packet.weaponId)); break;
          case 'equipment-action': {
            const result = manager.equipmentAction(id, packet);
            if (!result.ok) send(socket, { type: 'error', message: result.reason });
            broadcast(manager.roomFor(id)); break;
          }
          case 'hide-action': {
            send(socket, manager.hideAction(id, packet)); broadcast(manager.roomFor(id)); break;
          }
          case 'leave': broadcast(manager.leave(id)); break;
          case 'ping': send(socket, { type: 'pong', at: packet.at }); break;
          default: throw new Error('Unknown message type.');
        }
      } catch (error) { send(socket, { type: 'error', message: error.message }); }
    });
    socket.on('close', () => { connections.delete(id); broadcast(manager.leave(id, { disconnected: true })); });
  });
  let ticks = 0;
  const simulation = setInterval(() => {
    manager.tick(1 / 30);
    if (++ticks % 2 === 0) for (const room of manager.rooms.values()) broadcast(room);
  }, 1000 / 30);
  const heartbeat = setInterval(() => {
    for (const connection of connections.values()) {
      if (!connection.alive) connection.socket.terminate();
      else { connection.alive = false; connection.socket.ping(); }
    }
  }, 15000);
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  try {
    await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, host, accept); });
  } catch (error) { clearInterval(simulation); clearInterval(heartbeat); wss.close(); throw error; }
  let closePromise;
  return { port: server.address().port, close() {
    if (!closePromise) closePromise = (async () => {
      clearInterval(simulation); clearInterval(heartbeat);
      for (const connection of connections.values()) connection.socket.terminate();
      await new Promise(accept => wss.close(accept));
      await new Promise(accept => server.close(accept));
    })();
    return closePromise;
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const host = process.env.HOST || '127.0.0.1';
  const server = await startServer({ port: Number(process.env.PORT || 4185), host, distDir: process.env.DIST_DIR || 'dist' });
  console.log(`Block Ops rooms: http://${host}:${server.port}`);
  const stop = () => { server.close().then(() => process.exit(0)); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}

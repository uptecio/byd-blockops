import { WEAPONS } from './weapons.js';

const weaponIds = new Set(WEAPONS.map(weapon => weapon.id));
const finitePoint = point => point && ['x', 'y', 'z'].every(key => Number.isFinite(point[key]));

export function normaliseServerUrl(raw) {
  let url;
  try { url = new URL(String(raw).trim()); } catch { throw new Error('Enter a full HTTPS server address, such as https://play.example.com.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP(S) server address without a username or password.');
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Internet servers must use HTTPS for a secure connection.');
  return url.origin;
}

function validRoom(room) {
  if (!room || typeof room.code !== 'string' || typeof room.hostId !== 'string' || !['lobby', 'playing', 'ended'].includes(room.phase) || !Number.isFinite(room.timeLeft) || room.timeLeft < 0 || !Array.isArray(room.players) || room.players.length > 8 || !Array.isArray(room.events)) return false;
  const ids = new Set();
  for (const player of room.players) {
    if (!player || typeof player.id !== 'string' || ids.has(player.id) || typeof player.name !== 'string' || !weaponIds.has(player.weaponId)) return false;
    ids.add(player.id);
    if (!['x', 'y', 'z', 'yaw', 'pitch', 'health', 'kills', 'deaths', 'ammo', 'reserve', 'reloadRemaining', 'respawnRemaining', 'protectedRemaining'].every(key => Number.isFinite(player[key]))) return false;
    if (['health', 'kills', 'deaths', 'ammo', 'reserve', 'reloadRemaining', 'respawnRemaining', 'protectedRemaining'].some(key => player[key] < 0)) return false;
  }
  return room.events.every(event => event && Number.isSafeInteger(event.id) && ['shot', 'hit', 'kill'].includes(event.type) && typeof event.playerId === 'string' && (!event.from || finitePoint(event.from)) && (!event.to || finitePoint(event.to)));
}

export class RoomClient {
  constructor({ onRoom = () => {}, onError = () => {}, onDisconnect = () => {} } = {}) {
    this.onRoom = onRoom; this.onError = onError; this.onDisconnect = onDisconnect;
    this.id = null; this.room = null; this.connected = false; this.socket = null; this.cancelPending = null;
  }
  async connect(serverBase, request) {
    const base = normaliseServerUrl(serverBase);
    if (!request || !['create', 'join'].includes(request.type)) throw new Error('Choose Create room or Join room.');
    this.close();
    return new Promise((resolve, reject) => {
      let socket;
      try { socket = new WebSocket(base.replace(/^http/, 'ws') + '/ws'); } catch { reject(new Error('Unable to open a connection to this server.')); return; }
      this.socket = socket;
      let welcomed = false, settled = false, intentional = false, disconnected = false;
      const cleanup = () => { clearTimeout(timer); if (this.socket === socket) this.cancelPending = null; };
      const fail = message => {
        if (settled) return;
        settled = true; intentional = true; cleanup(); this.connected = false;
        reject(new Error(message)); socket.close();
      };
      const timer = setTimeout(() => fail('The server did not respond within 8 seconds. Check its address and try again.'), 8000);
      this.cancelPending = () => { intentional = true; if (!settled) fail('Connection cancelled.'); };
      socket.addEventListener('open', () => {
        if (this.socket !== socket || intentional) return;
        const packet = { type: request.type, name: request.name, weaponId: request.weaponId };
        if (request.type === 'join') packet.code = request.code;
        try { socket.send(JSON.stringify(packet)); } catch { fail('Unable to send the room request.'); }
      });
      socket.addEventListener('message', event => {
        if (this.socket !== socket || intentional) return;
        let packet;
        try { packet = JSON.parse(event.data); } catch {
          if (!welcomed) fail('The server sent an unreadable response.'); else this.onError('The server sent an unreadable response.');
          return;
        }
        if (!packet || typeof packet.type !== 'string') { this.onError('The server sent an invalid message.'); return; }
        if (packet.type === 'error') {
          const message = typeof packet.message === 'string' ? packet.message : 'The room request was rejected.';
          if (!welcomed) fail(message); else this.onError(message);
          return;
        }
        if (packet.type === 'welcome' || packet.type === 'state') {
          const valid = validRoom(packet.room) && (packet.type !== 'welcome' || (typeof packet.id === 'string' && packet.room.players.some(player => player.id === packet.id)));
          if (!valid) {
            if (!welcomed) fail('The server sent an invalid room snapshot.'); else this.onError('The server sent an invalid room snapshot.');
            return;
          }
          if (packet.type === 'welcome' && !welcomed) {
            this.id = packet.id; this.connected = true; welcomed = true; settled = true; cleanup();
            this.room = packet.room; resolve(packet); this.onRoom(this.room);
          } else if (packet.type === 'state' && welcomed) {
            if (!packet.room.players.some(player => player.id === this.id)) { this.onError('Your player is missing from the room snapshot.'); return; }
            this.room = packet.room; this.onRoom(this.room);
          }
        }
      });
      socket.addEventListener('error', () => {
        if (this.socket !== socket || intentional) return;
        if (!welcomed) fail('Could not connect to the server. Check the address and that it is running.');
        else socket.close();
      });
      socket.addEventListener('close', () => {
        if (this.socket !== socket) return;
        this.connected = false;
        if (!welcomed && !settled) fail('The server closed the connection before joining the room.');
        else if (welcomed && !intentional && !disconnected) { disconnected = true; this.onDisconnect('Connection lost. Rejoin using your room code.'); }
      });
      // Retain the suppression closure after welcome as well as during connect.
      this.suppressDisconnect = () => { intentional = true; };
    });
  }
  send(packet) {
    if (!this.connected || !this.socket || this.socket.readyState !== 1) return false;
    try { this.socket.send(JSON.stringify(packet)); return true; } catch { return false; }
  }
  close() {
    if (this.suppressDisconnect) this.suppressDisconnect();
    if (this.cancelPending) this.cancelPending();
    const socket = this.socket; this.socket = null; this.connected = false; this.id = null; this.room = null;
    if (socket) socket.close();
  }
}

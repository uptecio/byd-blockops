import { WEAPONS, TOTAL_AMMO } from './weapons.js';
import { MAPS, DEFAULT_MAP_ID } from './maps.js';
import { MODES } from './modes.js';
import { SKINS, DEFAULT_SKIN_ID } from './skins.js';
import { PROTOCOL_VERSION } from './protocol.js';
import { validEquipmentAction, validEquipmentSnapshot, validGearEvent, validGearWorld } from './gear-protocol.js';
import { hasOwn } from './has-own.js';
import { GUN_FINISHES } from './cosmetics.js';
import { validProgressionId, validProgressionReceipt } from './progression-protocol.js';
import { validHideAction, validHideResult, validPlayerSpatial, protocolWorld } from './hiding-protocol.js';

const weaponIds = new Set(WEAPONS.map(weapon => weapon.id));
const mapIds = new Set(MAPS.map(map => map.id));
const modeIds = new Set(MODES.map(mode => mode.id));
const skinIds = new Set(SKINS.map(skin => skin.id));
const finishIds = new Set(GUN_FINISHES.map(finish => finish.id));
const connectionOrigins = new WeakMap();
const teams = ['red', 'blue'];
const validId = id => typeof id === 'string' && id.trim().length > 0;
const count = value => Number.isSafeInteger(value) && value >= 0;
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => hasOwn(value, key));
const updateRequired = 'Update required: install the latest Block Ops APK or reload the game.';
const finitePoint = point => exactKeys(point, ['x', 'y', 'z']) && ['x', 'y', 'z'].every(key => Number.isFinite(point[key]));

export function normaliseServerUrl(raw) {
  let url;
  try { url = new URL(String(raw).trim()); } catch { throw new Error('Enter a full HTTPS server address, such as https://play.example.com.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP(S) server address without a username or password.');
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Internet servers must use HTTPS for a secure connection.');
  return url.origin;
}

function validRoom(room) {
  if (!exactKeys(room, ['code', 'hostId', 'phase', 'roundId', 'timeLeft', 'winnerId', 'winnerName', 'mapId', 'modeId', 'teamScores', 'winnerTeamId', 'flags', 'events', 'gear', 'players']) || !validGearWorld(room.gear)) return false;
  if (room.phase === 'lobby' ? room.roundId !== null : !validProgressionId(room.roundId)) return false;
  if (!room || !validId(room.code) || !validId(room.hostId) || !['lobby', 'playing', 'ended'].includes(room.phase) || !Number.isFinite(room.timeLeft) || room.timeLeft < 0 || room.timeLeft > 180 || !Array.isArray(room.players) || room.players.length < 1 || room.players.length > 8 || !Array.isArray(room.events)) return false;
  if (!mapIds.has(room.mapId) || !modeIds.has(room.modeId) || !room.teamScores || !teams.every(team => count(room.teamScores[team])) || Object.keys(room.teamScores).some(team => !teams.includes(team))) return false;
  if (room.winnerId !== null && !validId(room.winnerId)) return false;
  if (room.winnerId === null ? room.winnerName !== null : !validId(room.winnerName)) return false;
  if (room.winnerTeamId !== null && !teams.includes(room.winnerTeamId)) return false;
  if (room.phase !== 'ended' && (room.winnerId !== null || room.winnerTeamId !== null)) return false;
  if (room.modeId === 'ffa' ? room.winnerTeamId !== null : room.winnerId !== null) return false;
  const ids = new Set();
  const map = MAPS.find(map => map.id === room.mapId), spatial = protocolWorld(map);
  for (const player of room.players) {
    if (!exactKeys(player, ['id', 'name', 'x', 'z', 'y', 'yaw', 'pitch', 'health', 'armour', 'kills', 'deaths', 'weaponId', 'teamId', 'skinId', 'pendingSkinId', 'finishId', 'pendingFinishId', 'lifeId', 'flashRemaining', 'heldItem', 'ammo', 'reserve', 'reloadRemaining', 'respawnRemaining', 'protectedRemaining', 'grounded', 'supportId', 'hiddenSpotId'])
      || !count(player.lifeId) || player.lifeId === 0 || !['gun', 'knife'].includes(player.heldItem)
      || !Number.isFinite(player.flashRemaining) || player.flashRemaining < 0 || player.flashRemaining > 3) return false;
    if (!player || !validId(player.id) || ids.has(player.id) || typeof player.name !== 'string' || !weaponIds.has(player.weaponId) || !skinIds.has(player.skinId) || (player.pendingSkinId !== null && !skinIds.has(player.pendingSkinId))) return false;
    if (!finishIds.has(player.finishId) || (player.pendingFinishId !== null && !finishIds.has(player.pendingFinishId))) return false;
    if (room.modeId === 'ffa' ? player.teamId !== null : !teams.includes(player.teamId)) return false;
    ids.add(player.id);
    if (!['x', 'y', 'z', 'yaw', 'pitch', 'health', 'armour', 'kills', 'deaths', 'ammo', 'reserve', 'reloadRemaining', 'respawnRemaining', 'protectedRemaining'].every(key => Number.isFinite(player[key]))) return false;
    if (['health', 'armour', 'kills', 'deaths', 'ammo', 'reserve', 'reloadRemaining', 'respawnRemaining', 'protectedRemaining'].some(key => player[key] < 0)) return false;
    if (!['kills', 'deaths', 'ammo', 'reserve'].every(key => count(player[key]))) return false;
    const gun = WEAPONS.find(gun => gun.id === player.weaponId);
    if (player.ammo > gun.magazine || player.ammo + player.reserve > TOTAL_AMMO || player.reloadRemaining > gun.reloadTime || player.health > 100 || player.armour > 100) return false;
    if (player.health === 0 && (player.armour !== 0 || player.ammo !== 0 || player.reserve !== 0 || player.reloadRemaining !== 0 || player.heldItem !== 'gun')) return false;
    if (!validPlayerSpatial(player, map)) return false;
  }
  if (!ids.has(room.hostId)) return false;
  if (room.modeId !== 'ctf') { if (room.flags !== null) return false; }
  else {
    if (!room.flags || Object.keys(room.flags).some(team => !teams.includes(team))) return false;
    const carriers = new Set();
    for (const team of teams) {
      const flag = room.flags[team];
      if (!exactKeys(flag, ['teamId', 'status', 'x', 'y', 'z', 'carrierId', 'returnRemaining']) || flag.teamId !== team || !['home', 'carried', 'dropped'].includes(flag.status) || !Number.isFinite(flag.x) || !Number.isFinite(flag.y) || flag.y < 0 || !Number.isFinite(flag.z) || !Number.isFinite(flag.returnRemaining) || flag.returnRemaining < 0 || flag.returnRemaining > 15) return false;
      if (flag.y > spatial.maxFeetY || flag.x < spatial.bounds.min || flag.x > spatial.bounds.max || flag.z < spatial.bounds.min || flag.z > spatial.bounds.max) return false;
      if (flag.status === 'carried') {
        if (!validId(flag.carrierId) || carriers.has(flag.carrierId) || flag.returnRemaining !== 0 || room.phase === 'lobby') return false;
        carriers.add(flag.carrierId);
        if (room.phase === 'playing') {
          const carrier = room.players.find(player => player.id === flag.carrierId);
          if (!carrier || carrier.teamId === team || carrier.health <= 0 || carrier.respawnRemaining > 0) return false;
        }
      } else if (flag.carrierId !== null || (flag.status === 'home' ? flag.returnRemaining !== 0 : flag.returnRemaining <= 0)) return false;
    }
  }
  return room.events.every(event => {
    if (!event || !count(event.id)) return false;
    if (['pickup', 'melee', 'grenade-throw', 'grenade-burst'].includes(event.type)) return validGearEvent(event);
    if (['flag-pickup', 'flag-drop', 'flag-return', 'flag-capture'].includes(event.type)) return exactKeys(event, ['id', 'type', 'teamId', 'playerId']) && room.modeId === 'ctf' && teams.includes(event.teamId) && (validId(event.playerId) || (event.type === 'flag-return' && event.playerId === null));
    return ['shot', 'hit', 'kill'].includes(event.type) && Object.keys(event).every(key => ['id', 'type', 'playerId', 'targetId', 'from', 'to'].includes(key)) && validId(event.playerId) && (event.targetId === undefined || validId(event.targetId)) && (event.from === undefined || finitePoint(event.from)) && (event.to === undefined || finitePoint(event.to));
  });
}

export class RoomClient {
  get serverOrigin() { return connectionOrigins.get(this) ?? null; }
  constructor({ onRoom = () => {}, onError = () => {}, onDisconnect = () => {}, onHideResult = () => {} } = {}) {
    this.onRoom = onRoom; this.onError = onError; this.onDisconnect = onDisconnect;
    this.id = null; this.room = null; this.connected = false; this.socket = null; this.cancelPending = null;
    this.actionSeq = 0; this.hideSeq = 0; this.onHideResult = onHideResult;
  }
  async connect(serverBase, request) {
    const base = normaliseServerUrl(serverBase);
    if (!request || !['create', 'join'].includes(request.type)) throw new Error('Choose Create room or Join room.');
    this.close();
    connectionOrigins.set(this, base);
    this.actionSeq = 0; this.hideSeq = 0;
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
        const packet = { type: request.type, protocol: PROTOCOL_VERSION, name: request.name, weaponId: request.weaponId, skinId: request.skinId ?? DEFAULT_SKIN_ID, finishId: request.finishId ?? 'standard' };
        if (request.type === 'join') packet.code = request.code;
        else Object.assign(packet, { mapId: request.mapId ?? DEFAULT_MAP_ID, modeId: request.modeId ?? 'ffa' });
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
        if (packet.type === 'hide-result' && welcomed) {
          if (packet.protocol !== PROTOCOL_VERSION) { this.onError(updateRequired); return; }
          const map = MAPS.find(map => map.id === this.room.mapId);
          if (!validHideResult(packet, map)) { this.onError('The server sent an invalid hiding result.'); return; }
          const own = this.room.players.find(player => player.id === this.id);
          if (packet.roundId === this.room.roundId && packet.lifeId === own?.lifeId) this.onHideResult(packet);
          return;
        }
        if (packet.type === 'welcome' || packet.type === 'state') {
          if (packet.protocol !== PROTOCOL_VERSION) { if (!welcomed) fail(updateRequired); else this.onError(updateRequired); return; }
          const recipientId = packet.type === 'welcome' ? packet.id : this.id;
          const own = Array.isArray(packet.room?.players) ? packet.room.players.find(player => player?.id === recipientId) : null;
          const valid = exactKeys(packet, packet.type === 'welcome' ? ['type', 'protocol', 'id', 'room', 'equipment', 'progression'] : ['type', 'protocol', 'room', 'equipment', 'progression'])
            && validRoom(packet.room) && validEquipmentSnapshot(packet.equipment, own) && validProgressionReceipt(packet.progression, packet.room, recipientId)
            && (!welcomed || (packet.equipment.lifeId >= this.room.selfEquipment.lifeId
              && packet.equipment.lastActionSeq >= this.room.selfEquipment.lastActionSeq
              && !(packet.equipment.lifeId === this.room.selfEquipment.lifeId && packet.room.phase === 'playing'
                && this.room.phase === 'playing' && packet.room.roundId === this.room.roundId && packet.room.timeLeft > this.room.timeLeft + 1e-8)));
          if (!valid) {
            if (!welcomed) fail('The server sent an invalid room snapshot.'); else this.onError('The server sent an invalid room snapshot.');
            return;
          }
          if (packet.type === 'welcome' && !welcomed) {
            this.id = packet.id; this.connected = true; welcomed = true; settled = true; cleanup();
            packet.room.selfEquipment = packet.equipment;
            packet.room.selfProgression = packet.progression;
            this.actionSeq = Math.max(this.actionSeq, packet.equipment.lastActionSeq);
            this.room = packet.room; resolve(packet); this.onRoom(this.room);
          } else if (packet.type === 'state' && welcomed) {
            if (!packet.room.players.some(player => player.id === this.id)) { this.onError('Your player is missing from the room snapshot.'); return; }
            packet.room.selfEquipment = packet.equipment;
            packet.room.selfProgression = packet.progression;
            this.actionSeq = Math.max(this.actionSeq, packet.equipment.lastActionSeq);
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
  sendEquipmentAction(action) {
    const own = this.room?.players.find(player => player.id === this.id);
    if (!own || !action || this.actionSeq >= Number.MAX_SAFE_INTEGER) return false;
    const packet = { type: 'equipment-action', seq: this.actionSeq + 1, lifeId: own.lifeId, ...action };
    if (!validEquipmentAction(packet) || hasOwn(action, 'type') || hasOwn(action, 'seq') || hasOwn(action, 'lifeId')) return false;
    if (!this.send(packet)) return false;
    this.actionSeq = packet.seq;
    return true;
  }
  sendHideAction(action) {
    const own = this.room?.players.find(player => player.id === this.id);
    if (!own || !exactKeys(action, ['kind', 'spotId']) || this.hideSeq >= Number.MAX_SAFE_INTEGER) return false;
    const packet = { type: 'hide-action', seq: this.hideSeq + 1, roundId: this.room.roundId, lifeId: own.lifeId, ...action };
    if (!validHideAction(packet, MAPS.find(map => map.id === this.room.mapId)) || !this.send(packet)) return false;
    this.hideSeq = packet.seq; return packet.seq;
  }
  close() {
    if (this.suppressDisconnect) this.suppressDisconnect();
    if (this.cancelPending) this.cancelPending();
    const socket = this.socket; this.socket = null; this.connected = false; this.id = null; this.room = null;
    connectionOrigins.delete(this);
    if (socket) socket.close();
  }
}

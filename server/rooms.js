import { randomInt } from 'node:crypto';
import * as THREE from 'three';
import { getMap } from '../src/maps.js';
import { getSkin } from '../src/skins.js';
import { getMode, assignTeams, createModeState, addParticipant, areEnemies, recordElimination, tickMode, removeParticipant, getModeSnapshot } from '../src/modes.js';
import { moveCircle } from '../src/collision.js';
import { WEAPONS, getWeapon, createWeaponState, tickWeapon, tryFire, startReload } from '../src/weapons.js';

const mapPhysics = new Map();
function physicsFor(map) {
  if (!mapPhysics.has(map.id)) {
    const wallBoxes = Object.freeze(map.solids.map(s => Object.freeze(new THREE.Box3(
      Object.freeze(new THREE.Vector3(s.x - s.w / 2, 0, s.z - s.d / 2)),
      Object.freeze(new THREE.Vector3(s.x + s.w / 2, s.height, s.z + s.d / 2)),
    ))));
    mapPhysics.set(map.id, Object.freeze({ solids: map.solids, wallBoxes }));
  }
  return mapPhysics.get(map.id);
}
const WEAPON_IDS = new Set(WEAPONS.map(weapon => weapon.id));
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const emptyInput = () => ({ x: 0, y: 0, yaw: 0, pitch: 0, fire: false, firePressed: false, jump: false, reload: false, zoom: false });

export function sanitizeName(name) {
  if (typeof name !== 'string') return 'Player';
  return Array.from(name.replace(/[<>\u0000-\u001f\u007f-\u009f]/g, '').trim()).slice(0, 16).join('') || 'Player';
}

function validWeapon(id) {
  if (!WEAPON_IDS.has(id)) throw new Error('Unknown weapon.');
  return id;
}

export class RoomManager {
  constructor({ maxRooms = 32, random = Math.random } = {}) {
    this.rooms = new Map();
    this.sessions = new Map();
    this.maxRooms = Math.min(32, maxRooms);
    this.random = random;
    this.now = 0;
  }

  roomFor(id) { return this.sessions.get(id); }

  create(id, name, weaponId = 'm4a1', { mapId = 'courtyard', modeId = 'ffa', skinId = 'ranger' } = {}) {
    validWeapon(weaponId);
    const map = getMap(mapId); getMode(modeId); getSkin(skinId);
    if (this.sessions.has(id)) throw new Error('Leave your current room first.');
    if (this.rooms.size >= this.maxRooms) throw new Error('Server room limit reached.');
    let code;
    do { code = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''); } while (this.rooms.has(code));
    const room = { code, hostId: id, phase: 'lobby', timeLeft: 180, winnerId: null, winnerName: null, winnerTeamId: null, mapId, modeId, map, physics: physicsFor(map), players: new Map(), lifeCounters: new Map(), events: [], nextEventId: 1,
      modeState: createModeState({ modeId, map, participants: [] }) };
    this.addPlayer(room, id, name, weaponId, skinId);
    this.rooms.set(code, room);
    return room;
  }

  join(id, code, name, weaponId = 'm4a1', { skinId = 'ranger' } = {}) {
    validWeapon(weaponId);
    getSkin(skinId);
    if (this.sessions.has(id)) throw new Error('Leave your current room first.');
    if (typeof code !== 'string' || code.length > 32) throw new Error('Room not found.');
    const room = this.rooms.get(code.trim().toUpperCase());
    if (!room) throw new Error('Room not found.');
    if (room.players.size >= 8) throw new Error('Room is full (eight players).');
    this.addPlayer(room, id, name, weaponId, skinId);
    return room;
  }

  addPlayer(room, id, name, weaponId, skinId) {
    const teamId = addParticipant(room.modeState, { id });
    const player = { id, name: sanitizeName(name), weaponId, teamId, skinId, pendingSkinId: null, kills: 0, deaths: 0, inventory: new Map(), input: emptyInput(), inputAt: -Infinity };
    room.players.set(id, player);
    this.sessions.set(id, room);
    this.spawn(room, player);
  }

  spawn(room, player) {
    const spawns = player.teamId ? room.map.teamSpawns[player.teamId] : [room.map.playerSpawn, ...room.map.spawns];
    const others = [...room.players.values()].filter(other => other !== player && other.health > 0);
    let spawn = spawns[0];
    let bestDistance = -1;
    for (const candidate of spawns) {
      const distance = others.length ? Math.min(...others.map(other => Math.hypot(candidate.x - other.x, candidate.z - other.z))) : Infinity;
      if (distance > bestDistance) { bestDistance = distance; spawn = candidate; }
    }
    Object.assign(player, spawn, { y: 0, velocityY: 0, yaw: Math.atan2(spawn.x, spawn.z), pitch: 0, health: 100, respawnRemaining: 0, protectedRemaining: 2, input: emptyInput(), inputAt: -Infinity });
    player.lifeId = (room.lifeCounters.get(player.id) || 0) + 1;
    room.lifeCounters.set(player.id, player.lifeId);
    if (player.pendingSkinId !== null) { player.skinId = player.pendingSkinId; player.pendingSkinId = null; }
    player.inventory = new Map(WEAPONS.map(weapon => [weapon.id, createWeaponState(weapon.id)]));
  }

  requirePlayer(id) {
    const room = this.sessions.get(id);
    if (!room) throw new Error('Join a room first.');
    return { room, player: room.players.get(id) };
  }

  rebuildMode(room, map, modeId) {
    const assignments = assignTeams([...room.players.keys()], modeId);
    const modeState = createModeState({ modeId, map, participants: [...room.players.keys()].map(id => ({ id, teamId: assignments[id] })) });
    Object.assign(room, { map, mapId: map.id, modeId, physics: physicsFor(map), modeState, timeLeft: 180, winnerId: null, winnerName: null, winnerTeamId: null, events: [] });
    for (const player of room.players.values()) Object.assign(player, { health: 0, teamId: assignments[player.id], kills: 0, deaths: 0 });
    for (const player of room.players.values()) this.spawn(room, player);
  }

  configure(id, { mapId, modeId }) {
    const map = getMap(mapId); getMode(modeId);
    const { room } = this.requirePlayer(id);
    if (room.hostId !== id) throw new Error('Only the host can configure.');
    if (room.phase === 'playing') throw new Error('Match already in progress.');
    this.rebuildMode(room, map, modeId); room.phase = 'lobby';
    return room;
  }

  setSkin(id, skinId) {
    getSkin(skinId);
    const { room, player } = this.requirePlayer(id);
    if (room.phase === 'playing') player.pendingSkinId = skinId;
    else { player.skinId = skinId; player.pendingSkinId = null; }
    return room;
  }

  start(id) {
    const { room } = this.requirePlayer(id);
    if (room.hostId !== id) throw new Error('Only the host can start.');
    if (room.players.size < 2) throw new Error('At least two players are required.');
    if (room.phase === 'playing') throw new Error('Match already in progress.');
    this.rebuildMode(room, room.map, room.modeId); room.phase = 'playing';
    return room;
  }

  input(id, packet) {
    const { player } = this.requirePlayer(id);
    for (const key of ['x', 'y', 'yaw', 'pitch']) {
      if (typeof packet[key] !== 'number' || !Number.isFinite(packet[key])) throw new Error('Input controls must be finite numbers.');
    }
    for (const key of ['fire', 'firePressed', 'jump', 'reload', 'zoom']) {
      if (packet[key] !== undefined && typeof packet[key] !== 'boolean') throw new Error('Input buttons must be boolean.');
    }
    let x = Math.max(-1, Math.min(1, packet.x));
    let y = Math.max(-1, Math.min(1, packet.y));
    const length = Math.hypot(x, y); if (length > 1) { x /= length; y /= length; }
    player.input = {
      x, y, yaw: packet.yaw % (Math.PI * 2), pitch: Math.max(-1.25, Math.min(1.25, packet.pitch)),
      fire: packet.fire === true, zoom: packet.zoom === true,
      firePressed: player.input.firePressed || packet.firePressed === true,
      jump: player.input.jump || packet.jump === true,
      reload: player.input.reload || packet.reload === true,
    };
    player.inputAt = this.now;
  }

  equip(id, weaponId) { validWeapon(weaponId); this.requirePlayer(id).player.weaponId = weaponId; }

  leave(id) {
    const room = this.sessions.get(id);
    if (!room) return null;
    for (const event of removeParticipant(room.modeState, id, room.players.get(id))) this.event(room, event);
    room.players.delete(id); this.sessions.delete(id);
    if (!room.players.size) this.rooms.delete(room.code);
    else if (room.hostId === id) room.hostId = room.players.keys().next().value;
    return room;
  }

  event(room, event) {
    room.events.push({ id: room.nextEventId++, ...event });
    if (room.events.length > 256) room.events.shift();
  }

  shoot(room, shooter, weapon) {
    const origin = new THREE.Vector3(shooter.x, shooter.y + 1.65, shooter.z);
    const facing = new THREE.Vector3(-Math.sin(shooter.yaw) * Math.cos(shooter.pitch), Math.sin(shooter.pitch), -Math.cos(shooter.yaw) * Math.cos(shooter.pitch));
    const right = new THREE.Vector3(Math.cos(shooter.yaw), 0, -Math.sin(shooter.yaw));
    const up = new THREE.Vector3().crossVectors(right, facing).normalize();
    const damage = new Map();
    let shotEnd = origin.clone().addScaledVector(facing, weapon.range);
    for (let pellet = 0; pellet < weapon.pellets; pellet++) {
      const spread = weapon.spread * (shooter.input.zoom ? 0.45 : 1);
      const direction = facing.clone().addScaledVector(right, (this.random() - 0.5) * spread).addScaledVector(up, (this.random() - 0.5) * spread).normalize();
      const ray = new THREE.Ray(origin, direction);
      const point = new THREE.Vector3();
      let distance = weapon.range;
      let target = null;
      for (const box of room.physics.wallBoxes) {
        if (ray.intersectBox(box, point)) distance = Math.min(distance, origin.distanceTo(point));
      }
      for (const player of room.players.values()) {
        if (player.health <= 0 || !areEnemies(room.modeState, shooter.id, player.id)) continue;
        const bounds = new THREE.Box3(new THREE.Vector3(player.x - 0.32, player.y, player.z - 0.32), new THREE.Vector3(player.x + 0.32, player.y + 1.84, player.z + 0.32));
        if (ray.intersectBox(bounds, point)) {
          const hitDistance = origin.distanceTo(point);
          if (hitDistance < distance) { distance = hitDistance; target = player; }
        }
      }
      if (pellet === 0) shotEnd = origin.clone().addScaledVector(direction, distance);
      if (target && target.protectedRemaining <= 0) damage.set(target, (damage.get(target) || 0) + weapon.damage);
    }
    this.event(room, { type: 'shot', playerId: shooter.id, from: { x: origin.x, y: origin.y, z: origin.z }, to: { x: shotEnd.x, y: shotEnd.y, z: shotEnd.z } });
    for (const [target, amount] of damage) {
      target.health = Math.max(0, target.health - amount);
      this.event(room, { type: 'hit', playerId: shooter.id, targetId: target.id });
      if (target.health === 0) {
        const events = recordElimination(room.modeState, { killerId: shooter.id, victimId: target.id, position: target, lifeId: target.lifeId });
        target.respawnRemaining = 2.5; target.input = emptyInput(); target.inputAt = -Infinity;
        this.event(room, { type: 'kill', playerId: shooter.id, targetId: target.id });
        for (const event of events) this.event(room, event);
        this.syncMode(room);
        if (room.phase === 'ended') break;
      }
    }
  }

  tick(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    let remaining = dt;
    while (remaining > 1e-9) {
      const step = Math.min(1 / 30, remaining); remaining -= step; this.now += step;
      for (const room of this.rooms.values()) this.tickRoom(room, step);
    }
  }

  tickRoom(room, dt) {
    if (room.phase !== 'playing') return;
    for (const player of room.players.values()) {
      if (room.phase !== 'playing') break;
      if (player.health <= 0) {
        player.respawnRemaining = Math.max(0, player.respawnRemaining - dt);
        if (player.respawnRemaining <= 1e-8) this.spawn(room, player);
        continue;
      }
      player.protectedRemaining = Math.max(0, player.protectedRemaining - dt);
      for (const state of player.inventory.values()) tickWeapon(state, dt);
      if (this.now - player.inputAt > 0.3 + 1e-9) player.input = emptyInput();
      const input = player.input;
      const weapon = getWeapon(player.weaponId);
      const state = player.inventory.get(player.weaponId);
      if (this.now - player.inputAt <= 0.3 + 1e-9) { player.yaw = input.yaw; player.pitch = input.pitch; }
      const speed = (weapon.classId === 'lmg' ? 4.4 : /sidearm|smg/.test(weapon.classId) ? 6 : 5.3) * (input.zoom ? 0.65 : 1);
      const moved = moveCircle(player, (Math.cos(player.yaw) * input.x - Math.sin(player.yaw) * input.y) * speed * dt, (-Math.sin(player.yaw) * input.x - Math.cos(player.yaw) * input.y) * speed * dt, 0.4, room.physics.solids);
      player.x = moved.x; player.z = moved.z;
      if (input.jump && player.y === 0) player.velocityY = 4.3;
      player.velocityY -= 12 * dt; player.y = Math.max(0, player.y + player.velocityY * dt);
      if (player.y === 0) player.velocityY = 0;
      if (input.reload) startReload(state);
      if ((weapon.automatic ? input.fire || input.firePressed : input.firePressed) && tryFire(state)) this.shoot(room, player, weapon);
      input.firePressed = false; input.jump = false; input.reload = false;
    }
    const actors = [...room.players.values()].map(player => ({ id: player.id, teamId: player.teamId, x: player.x, y: player.y, z: player.z, alive: player.health > 0, protectedRemaining: player.protectedRemaining, lifeId: player.lifeId }));
    for (const event of tickMode(room.modeState, dt, actors)) this.event(room, event);
    this.syncMode(room);
  }

  syncMode(room) {
    const state = room.modeState;
    if (state.ended && room.phase !== 'ended') room.winnerName = state.winnerId === null ? null : room.players.get(state.winnerId)?.name ?? null;
    room.timeLeft = state.timeLeft; room.winnerId = state.winnerId; room.winnerTeamId = state.winnerTeamId;
    if (state.ended) room.phase = 'ended';
    for (const player of room.players.values()) {
      const stats = state.stats[player.id]; player.kills = stats.kills; player.deaths = stats.deaths;
    }
  }

  snapshot(room, consumeEvents = true) {
    const events = structuredClone(room.events); if (consumeEvents) room.events = [];
    const { mapId, modeId, teamScores, flags, winnerTeamId } = getModeSnapshot(room.modeState);
    return { code: room.code, hostId: room.hostId, phase: room.phase, timeLeft: room.timeLeft, winnerId: room.winnerId, winnerName: room.winnerName, mapId, modeId, teamScores, winnerTeamId, flags, events,
      players: [...room.players.values()].map(player => {
        const state = player.inventory.get(player.weaponId);
        const { id, name, x, z, y, yaw, pitch, health, kills, deaths, weaponId, respawnRemaining, protectedRemaining, teamId, skinId, pendingSkinId } = player;
        return { id, name, x, z, y, yaw, pitch, health, kills, deaths, weaponId, teamId, skinId, pendingSkinId, ammo: state.ammo, reserve: state.reserve, reloadRemaining: state.reloadRemaining, respawnRemaining, protectedRemaining };
      }),
    };
  }
}

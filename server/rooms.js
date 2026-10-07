import { randomInt, randomUUID } from 'node:crypto';
import * as THREE from 'three';
import { getMap } from '../src/maps.js';
import { getSkin } from '../src/skins.js';
import { getGunFinish } from '../src/cosmetics.js';
import { emptyTally, awardTally, finishTally } from '../src/progression.js';
import { getMode, assignTeams, createModeState, addParticipant, areEnemies, recordElimination, tickMode, removeParticipant, getModeSnapshot } from '../src/modes.js';
import { moveCircle } from '../src/collision.js';
import { WEAPONS, getWeapon, tryFire, startReload } from '../src/weapons.js';
import { gunHitDamage } from '../src/gun-damage.js';
import { createEquipment, equipGun, setHeldItem, selectGrenade, tickEquipment, beginMelee, deathItems, clearEquipment, equipmentDTO } from '../src/equipment.js';
import { createLootState, reconcileStartingGuns, tickLoot, collectLoot, addDeathDrops, lootDTO } from '../src/loot.js';
import { createGearCombatState, meleeTarget, throwGrenade, stepGearCombat, gearCombatDTO } from '../src/gear-combat.js';
import { validEquipmentAction } from '../src/gear-protocol.js';
import { GEAR_BALANCE } from '../src/equipment-catalog.js';
import { damageVitals } from '../src/vitals.js';
import { startSupplyUse, cancelSupplyUse, advanceSupplyUse, isUsingSupply } from '../src/supplies.js';

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
const clearCombatInput = player => { player.input.fire = player.input.firePressed = player.input.reload = false; };

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
    this.actionSequences = new Map();
    this.connectionLives = new Map();
    this.maxRooms = Math.min(32, maxRooms);
    this.random = random;
    this.now = 0;
  }

  roomFor(id) { return this.sessions.get(id); }

  create(id, name, weaponId = 'm4a1', { mapId = 'courtyard', modeId = 'ffa', skinId = 'ranger', finishId = 'standard' } = {}) {
    validWeapon(weaponId);
    const map = getMap(mapId); getMode(modeId); getSkin(skinId); getGunFinish(finishId);
    if (this.sessions.has(id)) throw new Error('Leave your current room first.');
    if (this.rooms.size >= this.maxRooms) throw new Error('Server room limit reached.');
    let code;
    do { code = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''); } while (this.rooms.has(code));
    const room = { code, hostId: id, phase: 'lobby', roundId: null, timeLeft: 180, winnerId: null, winnerName: null, winnerTeamId: null, mapId, modeId, map, physics: physicsFor(map), players: new Map(), lifeCounters: new Map(), events: [], nextEventId: 1,
      modeState: createModeState({ modeId, map, participants: [] }), lootState: createLootState({ mapId, seed: 0, startingGunIds: [weaponId] }), gearCombatState: createGearCombatState() };
    this.addPlayer(room, id, name, weaponId, skinId, finishId);
    this.rooms.set(code, room);
    return room;
  }

  join(id, code, name, weaponId = 'm4a1', { skinId = 'ranger', finishId = 'standard' } = {}) {
    validWeapon(weaponId);
    getSkin(skinId); getGunFinish(finishId);
    if (this.sessions.has(id)) throw new Error('Leave your current room first.');
    if (typeof code !== 'string' || code.length > 32) throw new Error('Room not found.');
    const room = this.rooms.get(code.trim().toUpperCase());
    if (!room) throw new Error('Room not found.');
    if (room.players.size >= 8) throw new Error('Room is full (eight players).');
    this.addPlayer(room, id, name, weaponId, skinId, finishId);
    return room;
  }

  addPlayer(room, id, name, weaponId, skinId, finishId) {
    const teamId = addParticipant(room.modeState, { id });
    const player = { id, name: sanitizeName(name), weaponId, loadoutId: weaponId, startingGunId: weaponId, teamId, skinId, pendingSkinId: null, finishId, pendingFinishId: null, progression: emptyTally(), kills: 0, deaths: 0, inventory: new Map(), lastActionSeq: this.actionSequences.get(id) ?? 0, input: emptyInput(), inputAt: -Infinity };
    room.players.set(id, player);
    this.sessions.set(id, room);
    this.spawn(room, player);
    if (room.phase === 'playing') reconcileStartingGuns(room.lootState, [...room.players.values()].map(p => p.startingGunId));
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
    Object.assign(player, spawn, { y: 0, velocityY: 0, yaw: Math.atan2(spawn.x, spawn.z), pitch: 0, health: 100, armour: 0, respawnRemaining: 0, protectedRemaining: 2, flashRemaining: 0, input: emptyInput(), inputAt: -Infinity });
    player.lifeId = (this.connectionLives.get(player.id) || 0) + 1;
    this.connectionLives.set(player.id, player.lifeId);
    room.lifeCounters.set(player.id, player.lifeId);
    if (player.pendingSkinId !== null) { player.skinId = player.pendingSkinId; player.pendingSkinId = null; }
    if (player.pendingFinishId !== null) { player.finishId = player.pendingFinishId; player.pendingFinishId = null; }
    player.equipment = createEquipment(player.startingGunId);
    this.syncEquipment(player);
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
    for (const player of room.players.values()) Object.assign(player, { health: 0, teamId: assignments[player.id], kills: 0, deaths: 0, startingGunId: player.loadoutId, progression: emptyTally() });
    room.lootState = createLootState({ mapId: map.id, seed: randomInt(4294967296), startingGunIds: [...room.players.values()].map(p => p.startingGunId) });
    room.gearCombatState = createGearCombatState();
    for (const player of room.players.values()) this.spawn(room, player);
  }

  configure(id, { mapId, modeId }) {
    const map = getMap(mapId); getMode(modeId);
    const { room } = this.requirePlayer(id);
    if (room.hostId !== id) throw new Error('Only the host can configure.');
    if (room.phase === 'playing') throw new Error('Match already in progress.');
    this.rebuildMode(room, map, modeId); room.phase = 'lobby'; room.roundId = null;
    return room;
  }

  setSkin(id, skinId) {
    getSkin(skinId);
    const { room, player } = this.requirePlayer(id);
    if (room.phase === 'playing') player.pendingSkinId = skinId;
    else { player.skinId = skinId; player.pendingSkinId = null; }
    return room;
  }

  setFinish(id, finishId) {
    getGunFinish(finishId);
    const { room, player } = this.requirePlayer(id);
    if (room.phase === 'playing') player.pendingFinishId = finishId;
    else { player.finishId = finishId; player.pendingFinishId = null; }
    return room;
  }

  start(id) {
    const { room } = this.requirePlayer(id);
    if (room.hostId !== id) throw new Error('Only the host can start.');
    if (room.players.size < 2) throw new Error('At least two players are required.');
    if (room.phase === 'playing') throw new Error('Match already in progress.');
    this.rebuildMode(room, room.map, room.modeId); room.phase = 'playing'; room.roundId = randomUUID();
    return room;
  }

  input(id, packet) {
    const { room, player } = this.requirePlayer(id);
    for (const key of ['x', 'y', 'yaw', 'pitch']) {
      if (typeof packet[key] !== 'number' || !Number.isFinite(packet[key])) throw new Error('Input controls must be finite numbers.');
    }
    for (const key of ['fire', 'firePressed', 'jump', 'reload', 'zoom']) {
      if (packet[key] !== undefined && typeof packet[key] !== 'boolean') throw new Error('Input buttons must be boolean.');
    }
    let x = Math.max(-1, Math.min(1, packet.x));
    let y = Math.max(-1, Math.min(1, packet.y));
    const length = Math.hypot(x, y); if (length > 1) { x /= length; y /= length; }
    const combatAllowed = room.phase === 'playing' && player.health > 0 && packet.lifeId === player.lifeId && !isUsingSupply(player.equipment);
    player.input = {
      x, y, yaw: packet.yaw % (Math.PI * 2), pitch: Math.max(-1.25, Math.min(1.25, packet.pitch)),
      fire: combatAllowed && packet.fire === true, zoom: packet.zoom === true,
      firePressed: combatAllowed && (player.input.firePressed || packet.firePressed === true),
      jump: player.input.jump || packet.jump === true,
      reload: combatAllowed && (player.input.reload || packet.reload === true),
      lifeId: player.lifeId,
    };
    player.inputAt = this.now;
  }

  setLoadout(id, weaponId) {
    validWeapon(weaponId); const { room, player } = this.requirePlayer(id);
    if (room.phase === 'playing') throw new Error('Cannot change loadout during an active round.');
    player.loadoutId = weaponId;
    return room;
  }

  syncEquipment(player) { player.weaponId = player.equipment.activeGunId; player.inventory = player.equipment.owned; }

  actors(room) {
    return [...room.players.values()].map(p => ({ id: p.id, lifeId: p.lifeId, teamId: p.teamId, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, health: p.health, armour: p.armour, alive: p.health > 0, protectedRemaining: p.protectedRemaining, flashRemaining: p.flashRemaining, equipment: p.equipment }));
  }

  equipmentAction(id, packet) {
    const { room, player } = this.requirePlayer(id);
    const denied = reason => ({ ok: false, reason });
    if (!validEquipmentAction(packet)) return denied('Invalid equipment action');
    if (packet.seq <= player.lastActionSeq) return denied('Repeated equipment action');
    if (room.phase !== 'playing' || player.health <= 0 || packet.lifeId !== player.lifeId) return denied('Cannot change equipment while inactive');
    player.lastActionSeq = packet.seq; this.actionSequences.set(id, packet.seq);
    const previousUse = player.equipment.supplyUse;
    let result;
    if (packet.kind === 'equip-gun') result = equipGun(player.equipment, packet.weaponId, { source: packet.source });
    else if (packet.kind === 'held-item') result = setHeldItem(player.equipment, packet.heldItem);
    else if (packet.kind === 'select-grenade') result = selectGrenade(player.equipment, packet.grenadeType);
    else if (packet.kind === 'use-supply') result = startSupplyUse(player.equipment, player, packet.supplyType, { active: true, alive: true });
    else if (packet.kind === 'cancel-supply') result = cancelSupplyUse(player.equipment);
    else {
      if (isUsingSupply(player.equipment)) return denied('Finish or cancel supply use first');
      const actor = this.actors(room).find(actor => actor.id === id);
      if (player.input.lifeId === player.lifeId && this.now - player.inputAt <= .3 + 1e-9) {
        actor.yaw = player.input.yaw; actor.pitch = player.input.pitch;
      }
      result = throwGrenade(room.gearCombatState, actor, packet.grenadeType, { solids: room.physics.solids });
    }
    if (previousUse !== player.equipment.supplyUse) clearCombatInput(player);
    this.syncEquipment(player);
    return result;
  }

  equipmentSnapshot(id) {
    const { player } = this.requirePlayer(id);
    return { playerId: id, lifeId: player.lifeId, lastActionSeq: player.lastActionSeq, equipment: equipmentDTO(player.equipment) };
  }

  progressionSnapshot(id) {
    const { room, player } = this.requirePlayer(id);
    return room.roundId === null ? null : { roundId: room.roundId, playerId: id, modeId: room.modeId, tally: { ...player.progression } };
  }

  eliminate(room, killerId, target) {
    if (room.phase !== 'playing' || target.health <= 0) return false;
    const items = deathItems(target.equipment);
    target.health = 0; target.armour = 0; target.respawnRemaining = 2.5; target.input = emptyInput(); target.inputAt = -Infinity;
    clearEquipment(target.equipment);
    addDeathDrops(room.lootState, { actorId: target.id, lifeId: target.lifeId, position: target, items, solids: room.physics.solids });
    const previousKills = room.modeState.stats[killerId]?.kills;
    const events = recordElimination(room.modeState, { killerId, victimId: target.id, position: target, lifeId: target.lifeId });
    const killer = room.players.get(killerId);
    if (killer && room.modeState.stats[killerId].kills > previousKills)
      killer.progression = awardTally(killer.progression, room.modeId, 'eliminations');
    this.event(room, { type: 'kill', playerId: killerId, targetId: target.id });
    for (const event of events) this.event(room, event);
    this.syncMode(room);
    return true;
  }

  damage(room, sourceId, target, amount) {
    if (room.phase !== 'playing' || !target || target.health <= 0 || target.protectedRemaining > 0 || !areEnemies(room.modeState, sourceId, target.id)) return;
    const next = { health: target.health, armour: target.armour };
    const result = damageVitals(next, amount);
    if (!result.ok) return;
    this.event(room, { type: 'hit', playerId: sourceId, targetId: target.id });
    target.armour = next.armour;
    // eliminate owns the alive-to-dead transition, scoring and one-life drops.
    if (result.killed) this.eliminate(room, sourceId, target);
    else target.health = next.health;
  }

  leave(id, { disconnected = false } = {}) {
    if (disconnected) { this.actionSequences.delete(id); this.connectionLives.delete(id); }
    const room = this.sessions.get(id);
    if (!room) return null;
    cancelSupplyUse(room.players.get(id).equipment);
    for (const projectile of room.gearCombatState.projectiles) if (projectile.ownerId === id) projectile.visualOnly = true;
    for (const event of removeParticipant(room.modeState, id, room.players.get(id))) this.event(room, event);
    room.players.delete(id); this.sessions.delete(id);
    if (!room.players.size) this.rooms.delete(room.code);
    else if (room.hostId === id) room.hostId = room.players.keys().next().value;
    return room;
  }

  event(room, event) {
    const actor = room.players.get(event.playerId);
    if (room.phase === 'playing' && room.modeId === 'ctf' && actor && ['flag-capture', 'flag-return'].includes(event.type))
      actor.progression = awardTally(actor.progression, room.modeId, event.type === 'flag-capture' ? 'flagCaptures' : 'flagReturns');
    room.events.push({ id: room.nextEventId++, ...event });
    if (room.events.length > 256) room.events.shift();
  }

  shoot(room, shooter, weapon) {
    if (isUsingSupply(shooter.equipment)) return;
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
      let target = null, hitY = 0;
      for (const box of room.physics.wallBoxes) {
        if (ray.intersectBox(box, point)) distance = Math.min(distance, origin.distanceTo(point));
      }
      for (const player of room.players.values()) {
        if (player.health <= 0 || !areEnemies(room.modeState, shooter.id, player.id)) continue;
        const bounds = new THREE.Box3(new THREE.Vector3(player.x - 0.32, player.y, player.z - 0.32), new THREE.Vector3(player.x + 0.32, player.y + 1.84, player.z + 0.32));
        if (ray.intersectBox(bounds, point)) {
          const hitDistance = origin.distanceTo(point);
          if (hitDistance < distance) { distance = hitDistance; target = player; hitY = point.y; }
        }
      }
      if (pellet === 0) shotEnd = origin.clone().addScaledVector(direction, distance);
      if (target && target.protectedRemaining <= 0) damage.set(target, (damage.get(target) || 0) + gunHitDamage(weapon.damage, hitY, target.y));
    }
    this.event(room, { type: 'shot', playerId: shooter.id, from: { x: origin.x, y: origin.y, z: origin.z }, to: { x: shotEnd.x, y: shotEnd.y, z: shotEnd.z } });
    for (const [target, amount] of damage) {
      this.damage(room, shooter.id, target, amount);
      if (room.phase === 'ended') break;
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
    const pendingUses = [...room.players.values()].filter(p => isUsingSupply(p.equipment))
      .map(player => ({ player, equipment: player.equipment, use: player.equipment.supplyUse }));
    tickLoot(room.lootState, dt);
    for (const player of room.players.values()) {
      if (room.phase !== 'playing') break;
      player.flashRemaining = Math.max(0, player.flashRemaining - dt);
      if (player.health <= 0) {
        player.respawnRemaining = Math.max(0, player.respawnRemaining - dt);
        if (player.respawnRemaining <= 1e-8) this.spawn(room, player);
        continue;
      }
      player.protectedRemaining = Math.max(0, player.protectedRemaining - dt);
      tickEquipment(player.equipment, dt);
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
      if (!isUsingSupply(player.equipment) && input.lifeId === player.lifeId && input.reload && player.equipment.heldItem === 'gun') startReload(state);
      if (!isUsingSupply(player.equipment) && input.lifeId === player.lifeId && player.equipment.attackLockRemaining === 0) {
        if (player.equipment.heldItem === 'knife') {
          if ((input.fire || input.firePressed) && beginMelee(player.equipment).ok) {
            this.event(room, { type: 'melee', playerId: player.id });
            const targetId = meleeTarget(this.actors(room).find(a => a.id === player.id), this.actors(room), { solids: room.physics.solids, isEnemy: (a, b) => areEnemies(room.modeState, a, b) });
            if (targetId) this.damage(room, player.id, room.players.get(targetId), GEAR_BALANCE.knife.damage);
          }
        } else {
          if ((weapon.automatic ? input.fire || input.firePressed : input.firePressed) && tryFire(state)) this.shoot(room, player, weapon);
        }
      }
      input.firePressed = false; input.jump = false; input.reload = false;
    }
    if (room.phase !== 'playing') return;
    const effects = stepGearCombat(room.gearCombatState, this.actors(room), dt, { solids: room.physics.solids, isEnemy: (a, b) => areEnemies(room.modeState, a, b) });
    for (const event of effects.events) this.event(room, event);
    for (const intent of effects.damage) {
      this.damage(room, intent.sourceId, room.players.get(intent.targetId), intent.amount);
      if (room.phase !== 'playing') return;
    }
    for (const intent of effects.flashes) {
      const target = room.players.get(intent.targetId);
      if (target?.health > 0 && target.protectedRemaining === 0) target.flashRemaining = Math.min(3, Math.max(target.flashRemaining, intent.duration));
    }
    const actors = this.actors(room);
    for (const event of collectLoot(room.lootState, actors, { solids: room.physics.solids })) this.event(room, event);
    for (const event of tickMode(room.modeState, dt, actors)) this.event(room, event);
    this.syncMode(room);
    for (const { player, equipment, use } of pendingUses) {
      if (player.equipment !== equipment || equipment.supplyUse !== use) continue;
      const result = advanceSupplyUse(equipment, player, dt, { active: room.phase === 'playing', alive: player.health > 0 });
      if (['completed', 'cancelled'].includes(result.status)) clearCombatInput(player);
    }
  }

  syncMode(room) {
    const state = room.modeState;
    if (state.ended && room.phase !== 'ended') {
      room.winnerName = state.winnerId === null ? null : room.players.get(state.winnerId)?.name ?? null;
      for (const player of room.players.values()) player.progression = finishTally(player.progression, {
        modeId: room.modeId, naturalEnd: true,
        won: room.modeId === 'ffa' ? state.winnerId === player.id : state.winnerTeamId === player.teamId,
      });
    }
    room.timeLeft = state.timeLeft; room.winnerId = state.winnerId; room.winnerTeamId = state.winnerTeamId;
    if (state.ended) {
      room.phase = 'ended';
      for (const player of room.players.values()) { cancelSupplyUse(player.equipment); player.input = emptyInput(); player.inputAt = -Infinity; }
    }
    for (const player of room.players.values()) {
      const stats = state.stats[player.id]; player.kills = stats.kills; player.deaths = stats.deaths;
    }
  }

  snapshot(room, consumeEvents = true) {
    const events = structuredClone(room.events); if (consumeEvents) room.events = [];
    const { mapId, modeId, teamScores, flags, winnerTeamId } = getModeSnapshot(room.modeState);
    return { code: room.code, hostId: room.hostId, phase: room.phase, roundId: room.roundId, timeLeft: room.timeLeft, winnerId: room.winnerId, winnerName: room.winnerName, mapId, modeId, teamScores, winnerTeamId, flags, events, gear: { loot: lootDTO(room.lootState), ...gearCombatDTO(room.gearCombatState) },
      players: [...room.players.values()].map(player => {
        const state = player.inventory.get(player.weaponId);
        const { id, name, x, z, y, yaw, pitch, health, armour, kills, deaths, weaponId, respawnRemaining, protectedRemaining, teamId, skinId, pendingSkinId, finishId, pendingFinishId, lifeId, flashRemaining } = player;
        return { id, name, x, z, y, yaw, pitch, health, armour, kills, deaths, weaponId, teamId, skinId, pendingSkinId, finishId, pendingFinishId, lifeId, flashRemaining, heldItem: player.equipment.heldItem, ammo: state?.ammo ?? 0, reserve: state?.reserve ?? 0, reloadRemaining: state?.reloadRemaining ?? 0, respawnRemaining, protectedRemaining };
      }),
    };
  }
}

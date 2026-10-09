import * as THREE from 'three';
import { createAvatarModel } from './avatar.js';
import { disposeModel } from './game.js';
import { equipmentDTO, equipmentFromDTO } from './equipment.js';
import { getWeapon } from './weapons.js';
import { lootItemLabel } from './loot-labels.js';
import { isUsingSupply, cancelSupplyUse } from './supplies.js';
import { createHidingState, hidingContext } from './hiding.js';
import { validHideResult } from './hiding-protocol.js';
import { clearClimb } from './character-movement.js';
import { interpolateClimber } from './climb-presentation.js';

const neutral = (yaw, pitch, lifeId) => ({ type: 'input', lifeId, x: 0, y: 0, yaw, pitch, fire: false, firePressed: false, jump: false, reload: false, zoom: false });
const emptyPending = () => ({ firePressed: false, jump: false, reload: false });
const emptyWorld = () => ({ loot: [], projectiles: [], smokes: [] });

function addNameLabel(model, name) {
  if (typeof document === 'undefined') return;
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.fillStyle = '#10243bdd'; context.fillRect(0, 0, 256, 64);
  context.font = 'bold 26px sans-serif'; context.fillStyle = '#ffffff'; context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillText(name, 128, 32, 240);
  const texture = new THREE.CanvasTexture(canvas);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true }));
  label.name = 'name-label';
  label.position.y = 2.2; label.scale.set(1.7, .425, 1); model.add(label);
}

export class OnlineArena {
  constructor(game, client, { onEnd = () => {}, onToast = () => {} } = {}) {
    this.game = game; this.client = client; this.onEnd = onEnd; this.onToast = onToast;
    this.remotes = new Map(); this.running = false; this.suspended = true;
    this.pending = emptyPending();
    this.pendingHide = null; this.hidingReason = null;
    this.sendTimer = 0; this.hudTimer = 0; this.lastEvent = -1; this.endReported = false;
  }
  start(room, id, settings) {
    this.stop();
    const own = room.players.find(player => player.id === id);
    if (!own) throw new Error('Your player is missing from this room.');
    this.id = id; this.running = true; this.suspended = false; this.endReported = false;
    this.lastEvent = room.events.reduce((maximum, event) => Math.max(maximum, event.id), -1);
    this.sendTimer = 0; this.hudTimer = 0; this.previousRespawn = own.respawnRemaining;
    this.game.start(own.weaponId, { ...settings, mapId: room.mapId, modeId: room.modeId, skinId: own.skinId, finishId: own.finishId, bots: 0, progressionSource: 'online' }); this.game.active = false;
    this.game.lootState = null;
    this.game.yaw = own.yaw; this.game.pitch = own.pitch;
    Object.assign(this.game.player, { x: own.x, z: own.z, y: own.y, jump: own.y });
    this.sync(room, true); this.game.input.setEnabled(room.phase === 'playing' && !this.suspended); this.game.placeCamera();
  }
  sync(room, initial = false) {
    if (!this.running) return;
    const game = this.game, own = room.players.find(player => player.id === this.id);
    if (!own) return;
    if (!initial && own.lifeId < game.player.lifeId) return;
    // WebSocket messages are ordered: the first state after a successful
    // acknowledgement reconciles that action (including a subsequent ejection).
    // Until then, keep forwarding raw attacks without predicting actor state.
    if (this.pendingHide?.acknowledged) this.pendingHide = null;
    const equipment = equipmentFromDTO(room.selfEquipment.equipment);
    const previousEquipment = game.player.equipment, previousUse = previousEquipment?.supplyUse;
    const lifeChanged = game.player.lifeId !== own.lifeId;
    const hideChanged = (game.player.hiddenSpotId ?? null) !== own.hiddenSpotId;
    const climbChanged = (game.player.ladderId ?? null) !== (own.ladderId ?? null);
    const roundChanged = this.room && (this.room.roundId !== room.roundId || this.room.phase !== room.phase || this.room.mapId !== room.mapId || this.room.modeId !== room.modeId);
    const useChanged = previousUse?.type !== equipment.supplyUse?.type
      || (previousUse && equipment.supplyUse && equipment.supplyUse.remaining > previousUse.remaining + 1e-8);
    if (useChanged) { game.clearSupplyCombat(); this.pending.firePressed = this.pending.reload = false; }
    if (!initial && !lifeChanged && !roundChanged && own.health > 0 && room.phase === 'playing'
      && previousUse && !equipment.supplyUse
      && equipment.supplies[previousUse.type] === previousEquipment.supplies[previousUse.type] - 1
      && own[previousUse.type] > game.player[previousUse.type]) game.audio.supplyComplete?.(previousUse.type);
    if (lifeChanged || roundChanged || own.health <= 0) { game.input.clear(); this.pending = emptyPending(); this.pendingHide = null; }
    if (game.world.definition.id !== room.mapId) {
      for (const remote of this.remotes.values()) disposeModel(remote.model);
      this.remotes.clear(); game.loadMap(room.mapId); initial = true;
    }
    Object.assign(game.settings, { mapId: room.mapId, modeId: room.modeId, skinId: own.skinId, finishId: own.finishId });
    this.room = room;
    this.target = { x: own.x, z: own.z, y: own.y, ladderId:own.ladderId, lifeId:own.lifeId };
    const respawned = this.previousRespawn > 0 && own.respawnRemaining === 0;
    if (initial || respawned || lifeChanged || hideChanged || climbChanged) {
      Object.assign(game.player, { x: own.x, z: own.z, y: own.y, jump: own.y, velocityY: 0 });
    }
    if (initial || respawned || lifeChanged || hideChanged) {
      game.yaw = own.yaw; game.pitch = own.pitch; game.recoil = 0; game.input.clear();
    }
    if (own.health < game.player.health || own.armour < game.player.armour) game.damageFlash = .3;
    if (own.respawnRemaining > 0 && this.previousRespawn <= 0) { game.input.clear(); this.pending = emptyPending(); this.onToast('ELIMINATED · RESPAWNING'); }
    this.previousRespawn = own.respawnRemaining;
    Object.assign(game.player, { id: own.id, lifeId: own.lifeId, name: own.name, teamId: own.teamId, skinId: own.skinId, pendingSkinId: own.pendingSkinId, finishId: own.finishId, pendingFinishId: own.pendingFinishId, health: own.health, armour: own.armour, dead: own.respawnRemaining, protected: own.protectedRemaining, flashRemaining: own.flashRemaining, equipment });
    Object.assign(game.player, { hiddenSpotId: own.hiddenSpotId, grounded: own.grounded, supportId: own.supportId,
      ladderId:own.ladderId ?? null, ladderDistance:0, ladderBlockedId:null });
    if (initial || lifeChanged || hideChanged || climbChanged) game.placeCamera();
    game.matchView = {
      mapId: room.mapId, modeId: room.modeId, timeLeft: room.timeLeft, ended: room.phase === 'ended',
      winnerId: room.winnerId, winnerName: room.winnerName, winnerTeamId: room.winnerTeamId,
      teamScores: { ...room.teamScores }, flags: room.flags ? Object.fromEntries(Object.entries(room.flags).map(([team, flag]) => [team, { ...flag }])) : null,
      players: room.players.map(player => ({ id: player.id, name: player.name, teamId: player.teamId, skinId: player.skinId, kills: player.kills, deaths: player.deaths })),
    };
    game.match = { ...game.matchView, kills: own.kills, deaths: own.deaths };
    if (own.reloadRemaining > 0 && game.weaponState.reloadRemaining === 0 && !this.suspended) game.audio.reload();
    game.syncPlayerEquipment();
    if (own.hiddenSpotId) { game.weaponModel.visible = false; game.muzzle.visible = false; }
    // Always reconcile complete public arrays, including removals during menus.
    // RoomClient validated these plain DTOs; only loot items have nested records.
    game.gearWorld = {
      loot: room.gear.loot.map(record => ({ ...record, item: { ...record.item } })),
      projectiles: room.gear.projectiles.map(record => ({ ...record })),
      smokes: room.gear.smokes.map(record => ({ ...record })),
    };
    game.gearView?.sync(game.gearWorld);
    const present = new Set();
    for (const player of room.players) {
      if (player.id === this.id) continue;
      present.add(player.id);
      let remote = this.remotes.get(player.id);
      if (!remote || remote.model.userData.skinId !== player.skinId || remote.model.userData.teamId !== player.teamId || remote.model.userData.weaponId !== player.weaponId || (remote.model.userData.finishId ?? 'standard') !== player.finishId || (remote.model.userData.heldItem ?? 'gun') !== player.heldItem || remote.name !== player.name) {
        disposeModel(remote?.model);
        const model = createAvatarModel(THREE, player); game.world.botGroup.add(model);
        addNameLabel(model, player.name);
        model.position.set(player.x, player.y, player.z);
        remote = { model, player, name: player.name }; this.remotes.set(player.id, remote);
      }
      if (remote.player.lifeId !== player.lifeId || remote.player.hiddenSpotId !== player.hiddenSpotId
        || (remote.player.ladderId ?? null) !== (player.ladderId ?? null)) remote.model.position.set(player.x, player.y, player.z);
      remote.player = player; remote.model.visible = player.respawnRemaining <= 0 && !player.hiddenSpotId;
      remote.model.rotation.y = player.yaw + Math.PI;
    }
    for (const [id, remote] of this.remotes) if (!present.has(id)) { disposeModel(remote.model); this.remotes.delete(id); }
    for (const event of room.events) {
      if (event.id <= this.lastEvent) continue;
      this.lastEvent = event.id;
      if (event.type === 'shot') {
        if (event.from && event.to) game.tracer(new THREE.Vector3(event.from.x, event.from.y, event.from.z), new THREE.Vector3(event.to.x, event.to.y, event.to.z), event.playerId === this.id ? '#fff2a8' : '#ffb66d');
        if (event.playerId === this.id) { game.audio.shoot(game.weapon); game.shotFlash = .055; game.recoil = Math.min(.13, game.recoil + game.weapon.recoil * (game.input.zoom ? .65 : 1)); }
      } else if (event.type === 'hit') {
        if (event.playerId === this.id) { game.hitFlash = .18; game.audio.hit(); }
        if (event.targetId === this.id) game.damageFlash = .3;
      } else if (event.type === 'kill' && event.playerId === this.id) {
        game.audio.kill();
        this.onToast(room.modeId === 'ffa' ? `+1 ELIMINATION · ${own.kills} / 15` : room.modeId === 'tdm' ? `+1 ELIMINATION · ${own.teamId.toUpperCase()} ${room.teamScores[own.teamId]} / 30` : '+1 ELIMINATION');
      } else if (event.type === 'pickup' && event.playerId === this.id) {
        const label = lootItemLabel(event.item);
        this.onToast(`PICKED UP ${label}`);
        game.audio.pickup?.();
      } else if (['melee', 'grenade-throw', 'grenade-burst'].includes(event.type)) {
        game.gearView?.event?.(event);
        if (event.type === 'melee') game.audio.swing?.();
        else if (event.type === 'grenade-burst') game.audio.grenade?.(event.grenadeType);
      } else if (event.type.startsWith('flag-')) {
        const team = event.teamId.toUpperCase();
        const messages = { 'flag-pickup': `${team} FLAG PICKED UP`, 'flag-drop': `${team} FLAG DROPPED`, 'flag-return': `${team} FLAG RETURNED`, 'flag-capture': `${team} TEAM CAPTURED A FLAG` };
        this.onToast(messages[event.type]);
      }
    }
    this.updateGearView();
    if (room.phase !== 'playing' && !this.suspended) this.pause();
    if (room.phase === 'ended' && !initial && !this.endReported) { this.endReported = true; this.pause(); this.onEnd(game.match); }
  }
  updateObjectives(actorVisibility) {
    const game = this.game;
    const actors = [
      { id: this.id, x: game.player.x, y: game.player.jump, z: game.player.z, hiddenSpotId: game.player.hiddenSpotId },
      ...[...this.remotes].map(([id, remote]) => ({ id, x: remote.model.position.x, y: remote.model.position.y, z: remote.model.position.z, hiddenSpotId: remote.player.hiddenSpotId })),
    ];
    game.objectives.update({ flags: game.matchView.flags, actors, viewerId: this.id, actorVisibility });
  }
  updateGearView(dt = 0) {
    const game = this.game;
    const actorVisibility = game.gearView?.update({ viewer: { id: this.id, teamId: game.player.teamId, x: game.player.x, y: game.player.jump, z: game.player.z, camera: game.camera },
      actors: [...this.remotes.values()].map(remote => ({ ...remote.player, x: remote.model.position.x, y: remote.model.position.y, z: remote.model.position.z,
        alive: remote.player.health > 0 && remote.player.respawnRemaining <= 0, model: remote.model, label: remote.model.getObjectByName('name-label') })),
      flashRemaining: game.player.flashRemaining, dt });
    this.updateObjectives(actorVisibility);
  }
  getEquipmentView() { return equipmentDTO(this.game.player.equipment); }
  getHidingView() {
    const state = createHidingState(), map = this.game.world.definition;
    const own = this.room?.players.find(p => p.id === this.id);
    for (const player of this.room?.players ?? []) if (player.hiddenSpotId) {
      state.occupants.set(player.hiddenSpotId, { actorId: player.id, lifeId: player.lifeId });
      state.actors.set(player.id, { spotId: player.hiddenSpotId, lifeId: player.lifeId });
    }
    const context = own ? hidingContext(state, { ...own, alive: own.health > 0 && own.respawnRemaining <= 0 }, { map, world: this.game.world.spatial,
      active: this.running && !this.suspended && this.room.phase === 'playing' }) : { label: null, enabled: false, spotId: null };
    return { ...context, enabled: context.enabled && !this.pendingHide, hidden: !!own?.hiddenSpotId, pending: !!this.pendingHide, reason: this.hidingReason };
  }
  requestHide(action) {
    if (!this.running || this.suspended || this.room.phase !== 'playing' || this.game.player.health <= 0 || this.pendingHide) return { ok: false, reason: 'Cannot hide now' };
    const seq = this.client.sendHideAction(action);
    if (!seq) return { ok: false, reason: 'Unable to send hiding request' };
    this.pendingHide = { seq, socket: this.client.socket, roundId: this.room.roundId, lifeId: this.game.player.lifeId, remaining: 2 };
    this.hidingReason = null; return { ok: true };
  }
  receiveHideResult(packet) {
    const pending = this.pendingHide;
    if (!pending || !validHideResult(packet, this.game.world.definition) || pending.socket !== this.client.socket
      || packet.seq !== pending.seq || packet.roundId !== pending.roundId || packet.lifeId !== pending.lifeId
      || packet.roundId !== this.room?.roundId || packet.lifeId !== this.game.player.lifeId) return;
    if (packet.ok && this.game.player.hiddenSpotId !== packet.hiddenSpotId) pending.acknowledged = true;
    else this.pendingHide = null;
    this.hidingReason = packet.reason;
    if (!packet.ok) this.onToast(packet.reason);
  }
  requestEquipment(action) {
    let reason;
    if (!this.running || this.room.phase !== 'playing' || this.game.player.health <= 0 || this.game.player.dead > 0)
      reason = 'Cannot change equipment while inactive';
    else if (action?.kind === 'throw' && this.suspended) reason = 'Cannot throw while paused';
    else if (action?.kind === 'use-supply' && this.suspended) reason = 'Cannot use supplies while paused';
    else if (action?.kind === 'throw' && isUsingSupply(this.game.player.equipment) && !this.game.player.hiddenSpotId && !this.pendingHide) reason = 'Finish or cancel supply use first';
    else if (!this.client.sendEquipmentAction(action)) reason = 'Unable to send equipment action';
    if (reason) { this.onToast(reason); return { ok: false, reason }; }
    return { ok: true };
  }
  update(dt) {
    if (!this.running || !Number.isFinite(dt) || dt <= 0) return;
    const game = this.game;
    game.time += dt;
    if (this.pendingHide && ((this.pendingHide.remaining -= dt) <= 0 || this.pendingHide.socket !== this.client.socket)) {
      this.pendingHide = null; this.hidingReason = 'Hiding request timed out. Try again.'; this.onToast(this.hidingReason);
    }
    let input = null;
    if (!this.suspended && this.room.phase === 'playing' && game.player.dead <= 0 && game.player.health > 0) {
      input = game.input.read();
      if (input.grenadePickerPressed) { game.events.onEquipmentPicker?.(); if (this.suspended) input = null; }
      if (input?.hidePressed) {
        const view = this.getHidingView();
        if (view.enabled) this.requestHide({ kind: view.hidden ? 'exit' : 'enter', spotId: view.spotId });
      }
      if (input?.knifePressed) {
        this.requestEquipment({ kind: 'held-item', heldItem: game.player.equipment.heldItem === 'knife' ? 'gun' : 'knife' });
        game.input.zoom = false;
      }
      if (input && game.player.equipment.heldItem === 'knife') input.zoom = input.reload = false;
      if (input && isUsingSupply(game.player.equipment)) {
        input.reload = false; this.pending.reload = false;
        if (!game.player.hiddenSpotId && !this.pendingHide) { input.fire = input.firePressed = input.throwPressed = false; this.pending.firePressed = false; }
      }
    }
    if (input) {
      const sensitivity = .0026 * game.settings.sensitivity / (input.zoom ? Math.sqrt(game.weapon.zoom) : 1);
      game.yaw -= input.lookX * sensitivity; game.pitch = THREE.MathUtils.clamp(game.pitch - input.lookY * sensitivity, -1.25, 1.25);
      for (const key of ['firePressed', 'jump', 'reload']) this.pending[key] = this.pending[key] || !!input[key];
    }
    this.sendTimer -= dt;
    if (this.sendTimer <= 0 || input?.throwPressed ||
        ((game.player.hiddenSpotId || this.pendingHide) && input?.firePressed)) {
      const packet = neutral(game.yaw, game.pitch, game.player.lifeId);
      if (input) {
        const length = Math.max(1, Math.hypot(input.x, input.y));
        Object.assign(packet, { x: input.x / length, y: input.y / length, fire: !!input.fire, zoom: !!input.zoom }, this.pending);
      }
      // The server validates/releases a throw immediately using its latest
      // input aim. Flush this frame's look and pending edges before the action,
      // even between regular input intervals; never throw after a failed flush.
      const sent = this.client.send(packet);
      if (sent) this.pending = emptyPending();
      if (input?.throwPressed) {
        if (sent) this.requestEquipment({ kind: 'throw', grenadeType: game.player.equipment.selectedGrenade });
        else this.onToast('Unable to send throw aim');
      }
      this.sendTimer = .05;
    }
    const smoothing = 1 - Math.exp(-dt * 18);
    Object.assign(game.player, interpolateClimber(game.player,this.target,smoothing,game.world.spatial));
    game.player.jump = game.player.y;
    for (const remote of this.remotes.values()) {
      const target = remote.player;
      const position = interpolateClimber({ ...target, ...remote.model.position },target,smoothing,game.world.spatial);
      remote.model.position.set(position.x,position.y,position.z);
    }
    game.recoil *= Math.exp(-dt * 13); game.placeCamera();
    // Online shots follow the transmitted pitch. Keep recoil on the weapon
    // model so the reticle and the server's authoritative ray stay aligned.
    game.camera.rotation.set(game.pitch, game.yaw, 0, 'YXZ');
    const zoom = !!(input && input.zoom);
    const fov = zoom ? 75 / game.weapon.zoom : 75;
    game.camera.fov += (fov - game.camera.fov) * Math.min(1, dt * 14); game.camera.updateProjectionMatrix();
    game.weaponModel.visible = !game.player.hiddenSpotId && game.player.dead <= 0 && !(game.heldItem === 'gun' && zoom && game.weapon.classId === 'sniper');
    const reload = game.heldItem === 'gun' && game.weaponState.reloadRemaining > 0;
    game.weaponModel.position.set(zoom ? .08 : .28, -.27 - (isUsingSupply(game.player.equipment) ? .24 : reload ? .17 : 0), -.5 + game.recoil * .7);
    game.weaponModel.rotation.z = reload ? Math.sin(game.time * 6) * .15 - .3 : 0;
    game.shotFlash = Math.max(0, game.shotFlash - dt); game.muzzle.visible = game.heldItem === 'gun' && game.shotFlash > 0 && game.weaponModel.visible;
    game.hitFlash = Math.max(0, game.hitFlash - dt); game.damageFlash = Math.max(0, game.damageFlash - dt);
    game.effects = game.effects.filter(effect => {
      effect.life -= dt;
      if (effect.life <= 0) { disposeModel(effect.line); return false; }
      effect.line.material.opacity = effect.life / .12; return true;
    });
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) { game.events.onHud(game); this.hudTimer = .05; }
    this.updateGearView(dt);
    game.renderer.render(game.scene, game.camera);
  }
  pause() {
    this.suspended = true; this.game.pause(); this.pending = emptyPending();
    if (this.running) this.client.send(neutral(this.game.yaw, this.game.pitch, this.game.player.lifeId));
  }
  resume() {
    if (!this.running || this.room.phase !== 'playing') return;
    this.game.input.clear(); this.pending = emptyPending();
    this.suspended = false; this.game.active = false; this.game.input.setEnabled(true); this.sendTimer = 0;
  }
  stop() {
    if (this.running) this.pause();
    if (this.running && this.game.player.equipment) cancelSupplyUse(this.game.player.equipment);
    for (const remote of this.remotes.values()) disposeModel(remote.model);
    this.remotes.clear(); this.game.clearEffects();
    this.game.gearWorld = emptyWorld(); this.game.gearView?.sync(this.game.gearWorld);
    this.game.gearView?.clear();
    if (this.running) { this.game.objectives?.dispose(); this.game.objectives = null; }
    this.running = false; this.suspended = true; this.room = null; this.target = null;
    this.pendingHide = null; this.hidingReason = null; this.game.player.hiddenSpotId = null;
    Object.assign(this.game.player, clearClimb(this.game.player));
  }
}

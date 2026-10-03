import * as THREE from 'three';
import { createAvatarModel } from './avatar.js';
import { disposeModel } from './game.js';
import { equipmentDTO, equipmentFromDTO } from './equipment.js';
import { getWeapon } from './weapons.js';

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
  label.position.y = 2.2; label.scale.set(1.7, .425, 1); model.add(label);
}

export class OnlineArena {
  constructor(game, client, { onEnd = () => {}, onToast = () => {} } = {}) {
    this.game = game; this.client = client; this.onEnd = onEnd; this.onToast = onToast;
    this.remotes = new Map(); this.running = false; this.suspended = true;
    this.pending = emptyPending();
    this.sendTimer = 0; this.hudTimer = 0; this.lastEvent = -1; this.endReported = false;
  }
  start(room, id, settings) {
    this.stop();
    const own = room.players.find(player => player.id === id);
    if (!own) throw new Error('Your player is missing from this room.');
    this.id = id; this.running = true; this.suspended = false; this.endReported = false;
    this.lastEvent = room.events.reduce((maximum, event) => Math.max(maximum, event.id), -1);
    this.sendTimer = 0; this.hudTimer = 0; this.previousRespawn = own.respawnRemaining;
    this.game.start(own.weaponId, { ...settings, mapId: room.mapId, modeId: room.modeId, skinId: own.skinId, bots: 0 }); this.game.active = false;
    this.game.lootState = null;
    this.game.yaw = own.yaw; this.game.pitch = own.pitch;
    Object.assign(this.game.player, { x: own.x, z: own.z, jump: own.y });
    this.sync(room, true); this.game.input.setEnabled(room.phase === 'playing' && !this.suspended); this.game.placeCamera();
  }
  sync(room, initial = false) {
    if (!this.running) return;
    const game = this.game, own = room.players.find(player => player.id === this.id);
    if (!own) return;
    const equipment = equipmentFromDTO(room.selfEquipment.equipment);
    const lifeChanged = game.player.lifeId !== own.lifeId;
    const roundChanged = this.room && (this.room.phase !== room.phase || this.room.mapId !== room.mapId || this.room.modeId !== room.modeId);
    if (lifeChanged || roundChanged || own.health <= 0) { game.input.clear(); this.pending = emptyPending(); }
    if (game.world.definition.id !== room.mapId) {
      for (const remote of this.remotes.values()) disposeModel(remote.model);
      this.remotes.clear(); game.loadMap(room.mapId); initial = true;
    }
    Object.assign(game.settings, { mapId: room.mapId, modeId: room.modeId, skinId: own.skinId });
    this.room = room;
    this.target = { x: own.x, z: own.z, y: own.y };
    const respawned = this.previousRespawn > 0 && own.respawnRemaining === 0;
    if (initial || respawned || lifeChanged) {
      Object.assign(game.player, { x: own.x, z: own.z, jump: own.y });
      game.yaw = own.yaw; game.pitch = own.pitch; game.recoil = 0; game.input.clear();
    }
    if (own.health < game.player.health) game.damageFlash = .3;
    if (own.respawnRemaining > 0 && this.previousRespawn <= 0) { game.input.clear(); this.pending = emptyPending(); this.onToast('ELIMINATED · RESPAWNING'); }
    this.previousRespawn = own.respawnRemaining;
    Object.assign(game.player, { id: own.id, lifeId: own.lifeId, name: own.name, teamId: own.teamId, skinId: own.skinId, pendingSkinId: own.pendingSkinId, health: own.health, dead: own.respawnRemaining, protected: own.protectedRemaining, flashRemaining: own.flashRemaining, equipment });
    game.matchView = {
      mapId: room.mapId, modeId: room.modeId, timeLeft: room.timeLeft, ended: room.phase === 'ended',
      winnerId: room.winnerId, winnerName: room.winnerName, winnerTeamId: room.winnerTeamId,
      teamScores: { ...room.teamScores }, flags: room.flags ? Object.fromEntries(Object.entries(room.flags).map(([team, flag]) => [team, { ...flag }])) : null,
      players: room.players.map(player => ({ id: player.id, name: player.name, teamId: player.teamId, skinId: player.skinId, kills: player.kills, deaths: player.deaths })),
    };
    game.match = { ...game.matchView, kills: own.kills, deaths: own.deaths };
    if (own.reloadRemaining > 0 && game.weaponState.reloadRemaining === 0 && !this.suspended) game.audio.reload();
    game.syncPlayerEquipment();
    // Always reconcile complete public arrays, including removals during menus.
    game.gearWorld = structuredClone(room.gear);
    game.gearView?.sync(game.gearWorld);
    const present = new Set();
    for (const player of room.players) {
      if (player.id === this.id) continue;
      present.add(player.id);
      let remote = this.remotes.get(player.id);
      if (!remote || remote.model.userData.skinId !== player.skinId || remote.model.userData.teamId !== player.teamId || remote.model.userData.weaponId !== player.weaponId || remote.name !== player.name) {
        disposeModel(remote?.model);
        const model = createAvatarModel(THREE, player); game.world.botGroup.add(model);
        addNameLabel(model, player.name);
        model.position.set(player.x, player.y, player.z);
        remote = { model, player, name: player.name }; this.remotes.set(player.id, remote);
      }
      remote.player = player; remote.model.visible = player.respawnRemaining <= 0;
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
        const label = event.item.kind === 'gun' ? getWeapon(event.item.weaponId).name : event.item.kind === 'knife' ? 'KNIFE' : `${event.item.grenadeType.toUpperCase()} GRENADE`;
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
    this.updateObjectives();
    if (room.phase !== 'playing' && !this.suspended) this.pause();
    if (room.phase === 'ended' && !initial && !this.endReported) { this.endReported = true; this.pause(); this.onEnd(game.match); }
  }
  updateObjectives() {
    const game = this.game;
    const actors = this.room.phase === 'ended' ? [] : [
      { id: this.id, x: game.player.x, y: game.player.jump, z: game.player.z },
      ...[...this.remotes].map(([id, remote]) => ({ id, x: remote.model.position.x, y: remote.model.position.y, z: remote.model.position.z })),
    ];
    game.objectives.update({ flags: game.matchView.flags, actors, viewerId: this.id });
  }
  getEquipmentView() { return equipmentDTO(this.game.player.equipment); }
  requestEquipment(action) {
    let reason;
    if (!this.running || this.room.phase !== 'playing' || this.game.player.health <= 0 || this.game.player.dead > 0)
      reason = 'Cannot change equipment while inactive';
    else if (action?.kind === 'throw' && this.suspended) reason = 'Cannot throw while paused';
    else if (!this.client.sendEquipmentAction(action)) reason = 'Unable to send equipment action';
    if (reason) { this.onToast(reason); return { ok: false, reason }; }
    return { ok: true };
  }
  update(dt) {
    if (!this.running || !Number.isFinite(dt) || dt <= 0) return;
    const game = this.game;
    game.time += dt;
    let input = null;
    if (!this.suspended && this.room.phase === 'playing' && game.player.dead <= 0 && game.player.health > 0) {
      input = game.input.read();
      const sensitivity = .0026 * game.settings.sensitivity / (input.zoom ? Math.sqrt(game.weapon.zoom) : 1);
      game.yaw -= input.lookX * sensitivity; game.pitch = THREE.MathUtils.clamp(game.pitch - input.lookY * sensitivity, -1.25, 1.25);
      for (const key of ['firePressed', 'jump', 'reload']) this.pending[key] = this.pending[key] || !!input[key];
    }
    this.sendTimer -= dt;
    if (this.sendTimer <= 0) {
      const packet = neutral(game.yaw, game.pitch, game.player.lifeId);
      if (input) {
        const length = Math.max(1, Math.hypot(input.x, input.y));
        Object.assign(packet, { x: input.x / length, y: input.y / length, fire: !!input.fire, zoom: !!input.zoom }, this.pending);
      }
      if (this.client.send(packet)) this.pending = emptyPending();
      this.sendTimer = .05;
    }
    const smoothing = 1 - Math.exp(-dt * 18);
    game.player.x += (this.target.x - game.player.x) * smoothing;
    game.player.z += (this.target.z - game.player.z) * smoothing;
    game.player.jump += (this.target.y - game.player.jump) * smoothing;
    for (const remote of this.remotes.values()) {
      const target = remote.player;
      remote.model.position.lerp(new THREE.Vector3(target.x, target.y, target.z), smoothing);
    }
    this.updateObjectives();
    game.recoil *= Math.exp(-dt * 13); game.placeCamera();
    // Online shots follow the transmitted pitch. Keep recoil on the weapon
    // model so the reticle and the server's authoritative ray stay aligned.
    game.camera.rotation.set(game.pitch, game.yaw, 0, 'YXZ');
    const zoom = !!(input && input.zoom);
    const fov = zoom ? 75 / game.weapon.zoom : 75;
    game.camera.fov += (fov - game.camera.fov) * Math.min(1, dt * 14); game.camera.updateProjectionMatrix();
    game.weaponModel.visible = game.player.dead <= 0 && !(zoom && game.weapon.classId === 'sniper');
    const reload = game.weaponState.reloadRemaining > 0;
    game.weaponModel.position.set(zoom ? .08 : .28, -.27 - (reload ? .17 : 0), -.5 + game.recoil * .7);
    game.weaponModel.rotation.z = reload ? Math.sin(game.time * 6) * .15 - .3 : 0;
    game.shotFlash = Math.max(0, game.shotFlash - dt); game.muzzle.visible = game.shotFlash > 0 && game.weaponModel.visible;
    game.hitFlash = Math.max(0, game.hitFlash - dt); game.damageFlash = Math.max(0, game.damageFlash - dt);
    game.effects = game.effects.filter(effect => {
      effect.life -= dt;
      if (effect.life <= 0) { disposeModel(effect.line); return false; }
      effect.line.material.opacity = effect.life / .12; return true;
    });
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) { game.events.onHud(game); this.hudTimer = .05; }
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
    for (const remote of this.remotes.values()) disposeModel(remote.model);
    this.remotes.clear(); this.game.clearEffects();
    this.game.gearWorld = emptyWorld(); this.game.gearView?.sync(this.game.gearWorld);
    if (this.running) { this.game.objectives?.dispose(); this.game.objectives = null; }
    this.running = false; this.suspended = true; this.room = null; this.target = null;
  }
}

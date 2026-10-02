import * as THREE from 'three';
import { createWorld, createWeaponModel } from './world.js';
import { moveCircle, hasLineOfSight } from './collision.js';
import { getWeapon, createWeaponState, tickWeapon, tryFire, startReload } from './weapons.js';
import { assignTeams, createModeState, tickMode, recordElimination, getModeSnapshot, areEnemies } from './modes.js';
import { getMap, DEFAULT_MAP_ID } from './maps.js';
import { getSkin, SKINS, DEFAULT_SKIN_ID } from './skins.js';
import { createAvatarModel } from './avatar.js';
import { createNavigation } from './navigation.js';
import { chooseBotIntent } from './bot-brain.js';
import { ObjectiveView } from './objectives.js';

export function disposeModel(model) {
  if (!model) return;
  const geometries = new Set(), materials = new Set();
  model.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) for (const material of [].concat(object.material)) materials.add(material);
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => { if (material.map) material.map.dispose(); material.dispose(); });
  model.removeFromParent();
}

const DIFFICULTY = { easy: { speed: 1.6, interval: 1.2, accuracy: .34, damage: 6 }, normal: { speed: 2.1, interval: .95, accuracy: .45, damage: 8 }, hard: { speed: 2.7, interval: .72, accuracy: .62, damage: 11 } };
const BOT_RADIUS = .4;
const PLAYER_RADIUS = .34;
export class ArenaGame {
  constructor(canvas, input, audio, events) {
    this.input = input; this.audio = audio; this.events = events;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#8acfed');
    this.scene.fog = new THREE.Fog('#b5dcde', 42, 95);
    this.scene.add(new THREE.HemisphereLight('#fff7df', '#869390', 2));
    const sun = new THREE.DirectionalLight('#fff2d1', 2.4); sun.position.set(-15, 30, 15); this.scene.add(sun);
    this.camera = new THREE.PerspectiveCamera(75, 1, .05, 180);
    this.camera.rotation.order = 'YXZ'; this.scene.add(this.camera);
    this.world = createWorld(THREE, this.scene);
    this.player = { ...this.world.playerSpawn, id: 'local', name: 'You', lifeId: 0, skinId: DEFAULT_SKIN_ID, pendingSkinId: DEFAULT_SKIN_ID, health: 100, jump: 0, velocity: 0, dead: 0, protected: 2 };
    this.yaw = 0; this.pitch = 0; this.time = 0; this.recoil = 0;
    this.active = false; this.hasRound = false; this.bots = []; this.effects = [];
    this.inventory = new Map(); this.weapon = getWeapon('m4a1');
    this.setWeapon(this.weapon.id);
    this.match = { timeLeft: 180, kills: 0, deaths: 0, ended: false }; this.settings = { sensitivity: 1, bots: 5, difficulty: 'normal' };
    this.muzzle = new THREE.Mesh(new THREE.OctahedronGeometry(.09), new THREE.MeshBasicMaterial({ color: '#fff0a0', transparent: true, opacity: .9, depthTest: false }));
    this.muzzle.position.set(.28, -.18, -1.1); this.muzzle.visible = false; this.camera.add(this.muzzle);
    this.shotFlash = 0; this.damageFlash = 0; this.hitFlash = 0; this.hudTimer = 0; this.lastFire = false;
    this.resize(); this.placeCamera();
    window.addEventListener('resize', () => this.resize());
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.pause(); events.onFatal('The display’s graphics context was interrupted. Reload the game to restart.'); });
  }
  resize() { this.renderer.setSize(innerWidth, innerHeight, false); this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }
  setWeapon(id) {
    this.weapon = getWeapon(id);
    if (!this.inventory.has(this.weapon.id)) this.inventory.set(this.weapon.id, createWeaponState(this.weapon.id));
    this.weaponState = this.inventory.get(this.weapon.id);
    disposeModel(this.weaponModel);
    this.weaponModel = createWeaponModel(THREE, this.weapon);
    this.weaponModel.position.set(.28, -.27, -.5); this.camera.add(this.weaponModel);
    this.lastFire = false; this.recoil = 0;
  }
  loadMap(mapId) {
    const map = getMap(mapId);
    for (const bot of this.bots) disposeModel(bot.model);
    this.bots = []; this.clearEffects(); this.objectives?.dispose();
    this.navigation?.clearCache(); this.world?.dispose();
    this.world = createWorld(THREE, this.scene, map.id);
    this.navigation = createNavigation(map, { radius: BOT_RADIUS });
    this.objectives = new ObjectiveView(THREE, this.scene, map);
    this.scene.background = new THREE.Color(map.environment.sky);
    this.scene.fog = new THREE.Fog(map.environment.fog, 42, 95);
  }
  start(id, settings = {}) {
    this.settings = { sensitivity: 1, bots: 5, difficulty: 'normal', mapId: DEFAULT_MAP_ID, modeId: 'ffa', skinId: DEFAULT_SKIN_ID, ...settings };
    const count = Math.max(0, Math.min(8, Math.trunc(this.settings.bots) || 0)); // zero reserved for online adapter
    getSkin(this.settings.skinId);
    const ids = ['local', ...Array.from({ length: count }, (_, i) => `bot-${i}`)];
    const teams = assignTeams(ids, this.settings.modeId);
    this.modeState = createModeState({ modeId: this.settings.modeId, map: getMap(this.settings.mapId), participants: ids.map(id => ({ id, teamId: teams[id] })) });
    this.loadMap(this.settings.mapId); this.inventory.clear(); this.setWeapon(id);
    this.botTuning = DIFFICULTY[this.settings.difficulty] || DIFFICULTY.normal;
    Object.assign(this.player, { id: 'local', name: 'You', teamId: teams.local, lifeId: 0, pendingSkinId: this.settings.skinId });
    this.hasRound = true; this.endReported = false;
    this.resetPlayer(true);
    const assigned = new Set();
    for (let i = 0; i < count; i++) {
      const botId = `bot-${i}`, teamId = teams[botId];
      const skinId = SKINS[i % SKINS.length].id;
      const bot = { id: botId, name: `Bot ${i + 1}`, teamId, lifeId: 0, pendingSkinId: skinId,
        cooldown: 2 + i * .3, respawn: 0, phase: i * 2.3, waypoint: null, intentTimer: 0, pathTimer: 0,
        role: assigned.has(teamId) ? 'defend' : 'attack' };
      const spawnIndex = teamId === null ? i : this.bots.filter(other => other.teamId === teamId).length + Number(teamId === this.player.teamId);
      assigned.add(teamId); this.bots.push(bot); this.spawnBot(bot, spawnIndex);
      bot.cooldown = 2 + i * .3;
    }
    this.refreshMatchView(); this.input.clear(); this.resume();
  }
  spawnPoints(teamId) {
    const map = this.world.definition;
    return teamId === null ? [map.playerSpawn, ...map.spawns] : map.teamSpawns[teamId];
  }
  spawnBot(bot, index = this.bots.indexOf(bot)) {
    const points = bot.teamId === null ? this.world.definition.spawns : this.spawnPoints(bot.teamId);
    const spawn = points[index % points.length];
    disposeModel(bot.model); bot.skinId = bot.pendingSkinId; bot.lifeId++;
    bot.model = createAvatarModel(THREE, { skinId: bot.skinId, teamId: bot.teamId });
    bot.bar = new THREE.Mesh(new THREE.PlaneGeometry(.9, .09), new THREE.MeshBasicMaterial({ color: '#f45b4f', side: THREE.DoubleSide }));
    bot.bar.position.y = 2.13; bot.model.add(bot.bar); this.world.botGroup.add(bot.model);
    bot.model.position.set(spawn.x, 0, spawn.z);
    Object.assign(bot, { health: 100, respawn: 0, protected: 2.5, cooldown: 1.5, intentTimer: 0, pathTimer: 0, waypoint: null, intent: null, weaponState: createWeaponState('m4a1') });
  }
  setPendingSkin(skinId) { getSkin(skinId); this.player.pendingSkinId = skinId; }
  getActors() {
    return [{ id: this.player.id, name: this.player.name, teamId: this.player.teamId, x: this.player.x, y: this.player.jump, z: this.player.z,
      alive: this.player.health > 0 && this.player.dead <= 0, protectedRemaining: this.player.protected, lifeId: this.player.lifeId, skinId: this.player.skinId },
    ...this.bots.map(bot => ({ id: bot.id, name: bot.name, teamId: bot.teamId, x: bot.model.position.x, y: bot.model.position.y, z: bot.model.position.z,
      alive: bot.health > 0 && bot.respawn <= 0, protectedRemaining: bot.protected, lifeId: bot.lifeId, skinId: bot.skinId }))];
  }
  refreshMatchView() {
    this.matchView = { ...getModeSnapshot(this.modeState), players: this.getActors().map(actor => ({ id: actor.id, name: actor.name, teamId: actor.teamId,
      kills: this.modeState.stats[actor.id].kills, deaths: this.modeState.stats[actor.id].deaths, skinId: actor.skinId })) };
    const own = this.modeState.stats.local;
    Object.assign(this.match, { timeLeft: this.modeState.timeLeft, kills: own.kills, deaths: own.deaths, ended: this.modeState.ended });
    this.objectives.update({ flags: this.matchView.flags, actors: this.getActors(), viewerId: 'local' });
  }
  getMatchView() { return this.matchView; }
  finishRound() {
    if (!this.modeState.ended || this.endReported) return;
    this.refreshMatchView(); this.endReported = true; this.pause(); this.events.onEnd(this.match);
  }
  resetPlayer(initial = false) {
    const points = this.spawnPoints(this.player.teamId);
    let spawn = points[0];
    if (!initial && this.bots.length) {
      spawn = points.reduce((best, point) => {
        const distance = Math.min(...this.bots.filter(bot => bot.respawn <= 0).map(bot => Math.hypot(bot.model.position.x - point.x, bot.model.position.z - point.z)));
        return distance > best.distance ? { ...point, distance } : best;
      }, { ...spawn, distance: -1 });
    }
    Object.assign(this.player, { x: spawn.x, z: spawn.z, health: 100, dead: 0, jump: 0, velocity: 0, protected: 2.5, skinId: this.player.pendingSkinId });
    this.player.lifeId++;
    this.yaw = initial ? 0 : Math.atan2(spawn.x, spawn.z); this.pitch = 0; this.recoil = 0;
    this.inventory.clear(); this.setWeapon(this.weapon.id); this.input.clear(); this.placeCamera();
  }
  resume() { if (this.hasRound && !this.match.ended) { this.active = true; this.lastFire = false; this.input.setEnabled(true); } }
  pause() { this.active = false; this.input.setEnabled(false); this.lastFire = false; }
  quit() { this.pause(); this.hasRound = false; }
  clearEffects() { for (const effect of this.effects) { effect.line.removeFromParent(); effect.line.geometry.dispose(); effect.line.material.dispose(); } this.effects = []; }
  placeCamera() {
    this.camera.position.set(this.player.x, 1.65 + this.player.jump, this.player.z);
    this.camera.rotation.set(this.pitch + this.recoil, this.yaw, 0, 'YXZ');
  }
  update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.time += dt;
    if (this.active) {
      this.simulate(Math.min(dt, this.modeState.timeLeft));
      tickMode(this.modeState, dt, this.getActors()); this.refreshMatchView(); this.finishRound();
    }
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) { this.events.onHud(this); this.hudTimer = .045; }
    this.renderer.render(this.scene, this.camera);
  }
  simulate(dt) {
    if (this.modeState.ended) return;
    const input = this.input.read();
    this.player.protected = Math.max(0, this.player.protected - dt);
    if (this.player.dead > 0) {
      this.player.dead -= dt;
      if (this.player.dead <= 0) { this.resetPlayer(); this.events.onToast('BACK IN THE FIGHT'); }
    } else {
      const zoom = input.zoom;
      const sensitivity = .0026 * this.settings.sensitivity / (zoom ? Math.sqrt(this.weapon.zoom) : 1);
      this.yaw -= input.lookX * sensitivity;
      this.pitch = THREE.MathUtils.clamp(this.pitch - input.lookY * sensitivity, -1.25, 1.25);
      const speed = (this.weapon.classId === 'lmg' ? 4.4 : this.weapon.classId === 'sidearm' || this.weapon.classId === 'smg' ? 6 : 5.3) * (zoom ? .65 : 1);
      const dx = (Math.cos(this.yaw) * input.x - Math.sin(this.yaw) * input.y) * speed * dt;
      const dz = (-Math.sin(this.yaw) * input.x - Math.cos(this.yaw) * input.y) * speed * dt;
      const moved = moveCircle(this.player, dx, dz, PLAYER_RADIUS, this.world.solids);
      this.player.x = moved.x; this.player.z = moved.z;
      if (input.jump && this.player.jump === 0) this.player.velocity = 4.3;
      this.player.velocity -= 13 * dt;
      this.player.jump = Math.max(0, this.player.jump + this.player.velocity * dt);
      if (this.player.jump === 0) this.player.velocity = 0;
      tickWeapon(this.weaponState, dt);
      if (input.reload && startReload(this.weaponState)) this.audio.reload();
      this.placeCamera();
      if (input.fire && (this.weapon.automatic || input.firePressed)) {
        if (tryFire(this.weaponState)) this.shoot(zoom);
        else if (!this.lastFire && this.weaponState.ammo === 0) this.events.onToast(this.weaponState.reserve ? 'TAP RELOAD' : 'OUT OF AMMO · CHANGE LOADOUT');
      }
      this.lastFire = input.fire;
      const targetFov = zoom ? 75 / this.weapon.zoom : 75;
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 14); this.camera.updateProjectionMatrix();
      this.weaponModel.visible = !(zoom && this.weapon.classId === 'sniper');
      const reload = this.weaponState.reloadRemaining > 0;
      this.weaponModel.position.set(zoom ? .08 : .28, -.27 - (reload ? .17 : 0) + Math.sin(this.time * 10) * Math.hypot(input.x, input.y) * .012, -.5 + this.recoil * .7);
      this.weaponModel.rotation.z = reload ? Math.sin(this.time * 6) * .15 - .3 : 0;
    }
    this.recoil *= Math.exp(-dt * 13);
    this.updateBots(dt);
    this.shotFlash = Math.max(0, this.shotFlash - dt); this.muzzle.visible = this.shotFlash > 0 && this.weaponModel.visible;
    this.hitFlash = Math.max(0, this.hitFlash - dt); this.damageFlash = Math.max(0, this.damageFlash - dt);
    this.effects = this.effects.filter(effect => {
      effect.life -= dt;
      if (effect.life <= 0) { effect.line.removeFromParent(); effect.line.geometry.dispose(); effect.line.material.dispose(); return false; }
      effect.line.material.opacity = effect.life / .12;
      return true;
    });
  }
  updateBots(dt) {
    if (this.modeState.ended) return;
    for (const bot of this.bots) {
      if (this.modeState.ended) break;
      if (bot.respawn > 0) {
        bot.respawn -= dt;
        if (bot.respawn <= 0) this.spawnBot(bot);
        continue;
      }
      bot.protected = Math.max(0, bot.protected - dt);
      tickWeapon(bot.weaponState, dt);
      bot.cooldown -= dt; bot.intentTimer -= dt; bot.pathTimer -= dt;
      const actors = this.getActors(), actor = actors.find(actor => actor.id === bot.id);
      if (bot.intentTimer <= 0) {
        bot.intent = chooseBotIntent(actor, { actors, state: this.modeState, map: this.world.definition, role: bot.role });
        bot.intentTimer = .25; bot.pathTimer = 0;
      }
      if (bot.pathTimer <= 0 || (bot.waypoint && Math.hypot(bot.waypoint.x - actor.x, bot.waypoint.z - actor.z) < .06)) {
        const goal = bot.intent.goal;
        const pursuingHuman = goal && this.player.health > 0 && this.player.dead <= 0 && goal.x === this.player.x && goal.z === this.player.z;
        bot.waypoint = !goal ? null : pursuingHuman
          ? this.navigation.nextApproachWaypoint(actor, goal, PLAYER_RADIUS)
          : this.navigation.nextWaypoint(actor, goal);
        bot.pathTimer = .15;
      }
      const position = bot.model.position;
      if (bot.waypoint) {
        const dx = bot.waypoint.x - position.x, dz = bot.waypoint.z - position.z, length = Math.hypot(dx, dz);
        const step = Math.min(length, this.botTuning.speed * dt);
        if (length > .001) {
          const moved = moveCircle(position, dx / length * step, dz / length * step, BOT_RADIUS, this.world.solids);
          position.x = moved.x; position.z = moved.z;
          bot.model.rotation.y = Math.atan2(dx, dz);
          position.y = Math.sin(this.time * 8 + bot.phase) * .025;
        }
      }
      bot.bar.rotation.y = this.yaw - bot.model.rotation.y;
      const target = this.getActors().find(actor => actor.id === bot.intent.targetId);
      if (!target || !target.alive || target.protectedRemaining > 0 || !areEnemies(this.modeState, bot.id, target.id)) continue;
      const from = { x: position.x, y: position.y + 1.35, z: position.z };
      const to = { x: target.x, y: target.y + 1.35, z: target.z };
      if (Math.hypot(target.x - position.x, target.z - position.z) >= 31 || !hasLineOfSight(from, to, this.world.solids) || bot.cooldown > 0) continue;
      if (bot.weaponState.ammo === 0) { startReload(bot.weaponState); continue; }
      if (!tryFire(bot.weaponState)) continue;
      bot.cooldown = this.botTuning.interval * (.85 + Math.random() * .6);
      this.tracer(new THREE.Vector3(from.x, from.y, from.z), new THREE.Vector3(to.x, to.y, to.z), '#ffb66d');
      const moving = target.id === 'local' && (Math.hypot(this.input.move.x, this.input.move.y) > .2
        || ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].some(key => this.input.keys.has(key)));
      if (Math.random() < this.botTuning.accuracy * (moving ? .65 : 1)) {
        const victim = target.id === 'local' ? this.player : this.bots.find(bot => bot.id === target.id);
        this.damageActor(bot.id, victim, this.botTuning.damage);
      }
    }
    this.refreshMatchView();
  }
  damageActor(attackerId, victim, damage) {
    if (this.modeState.ended || !areEnemies(this.modeState, attackerId, victim.id) || victim.health <= 0
      || (victim.dead ?? victim.respawn) > 0 || victim.protected > 0) return false;
    victim.health = Math.max(0, victim.health - damage);
    if (victim.id === 'local') this.damageFlash = .3;
    else victim.bar.scale.x = victim.health / 100;
    if (victim.health === 0) {
      const position = victim.id === 'local' ? victim : victim.model.position;
      recordElimination(this.modeState, { killerId: attackerId, victimId: victim.id, position, lifeId: victim.lifeId });
      if (victim.id === 'local') { victim.dead = 2.5; this.input.clear(); this.events.onToast('ELIMINATED · RESPAWNING'); }
      else { victim.respawn = 2.5; victim.model.visible = false; }
      this.refreshMatchView(); this.finishRound();
    }
    return true;
  }
  shoot(zoom) {
    if (this.modeState.ended) return;
    this.audio.shoot(this.weapon); this.shotFlash = .055;
    this.camera.updateMatrixWorld(true);
    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    let landed = false, killed = false;
    for (let pellet = 0; pellet < this.weapon.pellets; pellet++) {
      if (this.modeState.ended) break;
      const spread = this.weapon.spread * (zoom ? .35 : 1);
      const direction = new THREE.Vector3((Math.random() - .5) * spread * 2, (Math.random() - .5) * spread * 2, -1).normalize().applyQuaternion(this.camera.quaternion);
      const ray = new THREE.Ray(origin, direction);
      let closest = this.weapon.range, victim = null, hitPoint = null;
      for (const bot of this.bots) {
        if (bot.respawn > 0 || bot.protected > 0 || !areEnemies(this.modeState, 'local', bot.id)) continue;
        const p = bot.model.position;
        const box = new THREE.Box3(new THREE.Vector3(p.x - .32, p.y + .05, p.z - .32), new THREE.Vector3(p.x + .32, p.y + 1.84, p.z + .32));
        const hit = ray.intersectBox(box, new THREE.Vector3());
        if (!hit) continue;
        const distance = origin.distanceTo(hit);
        if (distance < closest && hasLineOfSight(origin, hit, this.world.solids)) { closest = distance; victim = bot; hitPoint = hit; }
      }
      if (victim) {
        const falloff = this.weapon.classId === 'shotgun' || this.weapon.classId === 'smg' ? Math.max(.35, 1 - closest / this.weapon.range * .6) : 1;
        landed = this.damageActor('local', victim, this.weapon.damage * falloff * (hitPoint.y > victim.model.position.y + 1.48 ? 1.5 : 1)) || landed;
        if (victim.health <= 0) { killed = true; this.events.onToast(`+1 ELIMINATION · ${this.match.kills}`); }
      }
      if (pellet === 0) {
        const end = hitPoint || origin.clone().addScaledVector(direction, Math.min(35, this.weapon.range));
        // Visual tracers terminate at solid cover as well as the damage ray.
        let nearestWall = origin.distanceTo(end);
        for (const solid of this.world.solids) {
          const wall = new THREE.Box3(new THREE.Vector3(solid.x - solid.w / 2, 0, solid.z - solid.d / 2), new THREE.Vector3(solid.x + solid.w / 2, solid.height, solid.z + solid.d / 2));
          const hit = ray.intersectBox(wall, new THREE.Vector3());
          if (hit && origin.distanceTo(hit) < nearestWall) { nearestWall = origin.distanceTo(hit); end.copy(hit); }
        }
        this.tracer(new THREE.Vector3(.26, -.2, -.85).applyMatrix4(this.camera.matrixWorld), end, '#fff2a8');
      }
    }
    if (landed) { this.hitFlash = .18; killed ? this.audio.kill() : this.audio.hit(); }
    this.recoil = Math.min(.13, this.recoil + this.weapon.recoil * (zoom ? .65 : 1));
  }
  tracer(start, end, colour) {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: .9 }));
    this.scene.add(line); this.effects.push({ line, life: .12 });
  }
}

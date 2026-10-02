import * as THREE from 'three';
import { createWorld, createBotModel, createWeaponModel } from './world.js';
import { canOccupy, moveCircle, hasLineOfSight } from './collision.js';
import { getWeapon, createWeaponState, tickWeapon, tryFire, startReload } from './weapons.js';
import { createMatch, tickMatch, recordKill, recordDeath } from './match.js';

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
    this.player = { ...this.world.playerSpawn, health: 100, jump: 0, velocity: 0, dead: 0, protected: 2 };
    this.yaw = 0; this.pitch = 0; this.time = 0; this.recoil = 0;
    this.active = false; this.hasRound = false; this.bots = []; this.effects = [];
    this.inventory = new Map(); this.weapon = getWeapon('m4a1');
    this.setWeapon(this.weapon.id);
    this.match = createMatch(); this.settings = { sensitivity: 1, bots: 5, difficulty: 'normal' };
    this.navSize = 45; this.navOrigin = -22; this.navTimer = 0;
    this.walkable = new Uint8Array(this.navSize * this.navSize);
    this.distances = new Int16Array(this.walkable.length);
    for (let z = 0; z < this.navSize; z++) for (let x = 0; x < this.navSize; x++) this.walkable[z * this.navSize + x] = canOccupy(x - 22, z - 22, .42, this.world.solids) ? 1 : 0;
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
  start(id, settings) {
    for (const bot of this.bots) disposeModel(bot.model);
    this.bots = []; this.clearEffects(); this.inventory.clear(); this.setWeapon(id);
    this.settings = { ...settings }; this.botTuning = DIFFICULTY[settings.difficulty] || DIFFICULTY.normal;
    this.match = createMatch(); this.hasRound = true;
    this.resetPlayer(true);
    for (let i = 0; i < settings.bots; i++) {
      const model = createBotModel(THREE, [0xeb744f, 0xe8a446, 0xc9725a, 0xd95151][i % 4]);
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(.9, .09), new THREE.MeshBasicMaterial({ color: 0xf45b4f, side: THREE.DoubleSide }));
      bar.position.y = 2.13; model.add(bar);
      this.world.botGroup.add(model);
      const bot = { model, bar, health: 100, cooldown: 2 + i * .3, respawn: 0, phase: i * 2.3, waypoint: null };
      const point = this.world.spawns[i % this.world.spawns.length];
      model.position.set(point.x, 0, point.z); this.bots.push(bot);
    }
    this.navTimer = 0; this.input.clear(); this.resume();
  }
  resetPlayer(initial = false) {
    let spawn = this.world.playerSpawn;
    if (!initial && this.bots.length) {
      const points = [this.world.playerSpawn, ...this.world.spawns];
      spawn = points.reduce((best, point) => {
        const distance = Math.min(...this.bots.filter(bot => bot.respawn <= 0).map(bot => Math.hypot(bot.model.position.x - point.x, bot.model.position.z - point.z)));
        return distance > best.distance ? { ...point, distance } : best;
      }, { ...spawn, distance: -1 });
    }
    Object.assign(this.player, { x: spawn.x, z: spawn.z, health: 100, dead: 0, jump: 0, velocity: 0, protected: 2.5 });
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
    this.time += dt;
    if (this.active) {
      tickMatch(this.match, dt);
      if (this.match.ended) { this.pause(); this.events.onEnd(this.match); }
      else this.simulate(dt);
    }
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) { this.events.onHud(this); this.hudTimer = .045; }
    this.renderer.render(this.scene, this.camera);
  }
  simulate(dt) {
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
      const moved = moveCircle(this.player, dx, dz, .34, this.world.solids);
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
    this.navTimer -= dt;
    if (this.navTimer <= 0) { this.updateNavigation(); this.navTimer = .7; }
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
  updateNavigation() {
    const size = this.navSize;
    const px = Math.round(this.player.x) + 22, pz = Math.round(this.player.z) + 22;
    let start = pz * size + px;
    if (!this.walkable[start]) {
      let best = Infinity;
      for (let i = 0; i < this.walkable.length; i++) if (this.walkable[i]) {
        const distance = Math.abs(i % size - px) + Math.abs(Math.floor(i / size) - pz);
        if (distance < best) { start = i; best = distance; }
      }
    }
    this.distances.fill(-1); this.distances[start] = 0;
    const queue = new Int16Array(this.walkable.length); let read = 0, write = 1; queue[0] = start;
    while (read < write) {
      const index = queue[read++], x = index % size, z = Math.floor(index / size);
      for (const [nx, nz] of [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]]) {
        if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
        const next = nz * size + nx;
        if (this.walkable[next] && this.distances[next] === -1) { this.distances[next] = this.distances[index] + 1; queue[write++] = next; }
      }
    }
  }
  updateBots(dt) {
    const playerTarget = { x: this.player.x, y: 1.25 + this.player.jump, z: this.player.z };
    for (const bot of this.bots) {
      if (bot.respawn > 0) {
        bot.respawn -= dt;
        if (bot.respawn <= 0) {
          const choices = this.world.spawns.filter(point => Math.hypot(point.x - this.player.x, point.z - this.player.z) > 9);
          const spawn = choices[Math.floor(Math.random() * choices.length)] || this.world.spawns[0];
          bot.model.position.set(spawn.x, 0, spawn.z); bot.health = 100; bot.bar.scale.x = 1; bot.model.visible = true; bot.cooldown = 1.5;
        }
        continue;
      }
      const position = bot.model.position;
      const dx = this.player.x - position.x, dz = this.player.z - position.z;
      const distance = Math.hypot(dx, dz);
      const visible = hasLineOfSight({ x: position.x, y: 1.35, z: position.z }, playerTarget, this.world.solids);
      let vx = 0, vz = 0;
      if (visible) {
        const approach = distance > 10 ? 1 : distance < 5 ? -.7 : 0;
        const strafe = Math.sin(this.time * .7 + bot.phase) * .6;
        vx = (dx * approach - dz * strafe) / Math.max(distance, .1);
        vz = (dz * approach + dx * strafe) / Math.max(distance, .1);
      } else {
        const cx = Math.round(position.x) + 22, cz = Math.round(position.z) + 22;
        let best = Infinity, target = null;
        for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
          const nx = cx + ox, nz = cz + oz;
          if (nx < 0 || nz < 0 || nx >= this.navSize || nz >= this.navSize) continue;
          const index = nz * this.navSize + nx, score = this.distances[index];
          const point = { x: nx - 22, z: nz - 22 };
          if (score >= 0 && score < best && hasLineOfSight(position, point, this.world.solids)) { best = score; target = point; }
        }
        if (target) { const length = Math.hypot(target.x - position.x, target.z - position.z); if (length > .05) { vx = (target.x - position.x) / length; vz = (target.z - position.z) / length; } }
      }
      const moved = moveCircle(position, vx * this.botTuning.speed * dt, vz * this.botTuning.speed * dt, .4, this.world.solids);
      position.x = moved.x; position.z = moved.z;
      bot.model.rotation.y = Math.atan2(dx, dz);
      bot.model.position.y = Math.sin(this.time * 8 + bot.phase) * .025 * Math.hypot(vx, vz);
      bot.bar.rotation.y = this.yaw - bot.model.rotation.y;
      bot.cooldown -= dt;
      if (visible && distance < 31 && bot.cooldown <= 0 && this.player.dead <= 0) {
        bot.cooldown = this.botTuning.interval * (.85 + Math.random() * .6);
        this.tracer(new THREE.Vector3(position.x, 1.2, position.z), new THREE.Vector3(this.player.x + (Math.random() - .5), 1.1 + this.player.jump, this.player.z), '#ffb66d');
        const moving = Math.hypot(this.input.move.x, this.input.move.y) > .2 || ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].some(key => this.input.keys.has(key));
        if (this.player.protected <= 0 && Math.random() < this.botTuning.accuracy * (moving ? .65 : 1)) {
          this.player.health = Math.max(0, this.player.health - this.botTuning.damage); this.damageFlash = .3;
          if (this.player.health === 0) { recordDeath(this.match); this.player.dead = 2.5; this.input.clear(); this.events.onToast('ELIMINATED · RESPAWNING'); }
        }
      }
    }
  }
  shoot(zoom) {
    this.audio.shoot(this.weapon); this.shotFlash = .055;
    this.camera.updateMatrixWorld(true);
    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    let landed = false, killed = false;
    for (let pellet = 0; pellet < this.weapon.pellets; pellet++) {
      const spread = this.weapon.spread * (zoom ? .35 : 1);
      const direction = new THREE.Vector3((Math.random() - .5) * spread * 2, (Math.random() - .5) * spread * 2, -1).normalize().applyQuaternion(this.camera.quaternion);
      const ray = new THREE.Ray(origin, direction);
      let closest = this.weapon.range, victim = null, hitPoint = null;
      for (const bot of this.bots) {
        if (bot.respawn > 0) continue;
        const p = bot.model.position;
        const box = new THREE.Box3(new THREE.Vector3(p.x - .43, .05, p.z - .43), new THREE.Vector3(p.x + .43, 1.87, p.z + .43));
        const hit = ray.intersectBox(box, new THREE.Vector3());
        if (!hit) continue;
        const distance = origin.distanceTo(hit);
        if (distance < closest && hasLineOfSight(origin, hit, this.world.solids)) { closest = distance; victim = bot; hitPoint = hit; }
      }
      if (victim) {
        const falloff = this.weapon.classId === 'shotgun' || this.weapon.classId === 'smg' ? Math.max(.35, 1 - closest / this.weapon.range * .6) : 1;
        victim.health -= this.weapon.damage * falloff * (hitPoint.y > 1.48 ? 1.5 : 1);
        victim.bar.scale.x = Math.max(0, victim.health / 100); landed = true;
        if (victim.health <= 0) {
          victim.respawn = 2.5; victim.model.visible = false; recordKill(this.match); killed = true;
          this.events.onToast(`+1 ELIMINATION · ${this.match.kills} / 15`);
        }
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

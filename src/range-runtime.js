import * as THREE from 'three';
import { createBody } from './character-movement.js';
import { tickEquipment } from './equipment.js';
import { RANGE_MAP, RANGE_TARGETS } from './range-map.js';
import { createRangeState, tickRangeTargets, traceRangeRay, applyRangeHit, recordRangeShot, rangeSnapshot } from './range-rules.js';
import { createRangeEquipment, equipRangeGun, replenishRangeReserves } from './range-equipment.js';
import { createRangeProgression } from './range-progression.js';
import { newSoloRunId } from './solo-progression.js';
import { createRangeView } from './range-view.js';
import { hasOwn } from './has-own.js';

export class RangeRuntime {
  constructor(game) { this.game = game; this.disposed = false; this.shotLanded = false; }
  start(weaponId, settings) {
    const game = this.game;
    this.state = createRangeState();
    game.modeState = { kind: 'range', ended: false };
    game.loadWorldDefinition(RANGE_MAP, { practice: true });
    this.world = game.world;
    this.view = createRangeView(THREE, game.scene, { targets: RANGE_TARGETS });
    game.player.equipment = createRangeEquipment(weaponId);
    Object.assign(game.player, createBody(this.world.playerSpawn, this.world.spatial, { radius: .34 }), {
      id: 'local', name: 'You', teamId: null, lifeId: 1, jump: 0, health: 100, armour: 0, dead: 0,
      protected: 0, flashRemaining: 0, hiddenSpotId: null,
      skinId: settings.skinId, pendingSkinId: settings.skinId, finishId: settings.finishId, pendingFinishId: settings.finishId,
    });
    game.hasRound = true; game.endReported = false;
    game.yaw = 0; game.pitch = 0; game.recoil = 0; game.lastFire = false;
    game.shotFlash = 0; game.hitFlash = 0; game.damageFlash = 0; game.hudTimer = 0; game.muzzle.visible = false;
    game.camera.fov = 75; game.camera.updateProjectionMatrix();
    game.simulationTime = 0; game.gearEvents = []; game.pickupEvents = []; game.gearEventId = 0;
    game.syncPlayerEquipment(); game.input.clear(); game.placeCamera();
    // Retain the closable session before invoking the synchronous start sink.
    // A failing UI/storage callback must still receive stop during rollback.
    let startEvent;
    this.progression = createRangeProgression({ runId: newSoloRunId(), targetIds: RANGE_TARGETS.map(target => target.id),
      onEvent: event => { if (event.type === 'start') startEvent = event; else game.events.onProgression?.(event); } });
    game.events.onProgression?.(startEvent);
    this.refreshView();
  }
  update(dt) {
    const game = this.game;
    if (this.disposed || !game.active || !Number.isFinite(dt) || dt <= 0) return;
    let remaining = dt;
    while (remaining > 0 && game.active && !this.disposed) {
      // Land on the next ready-to-fire instant. Equal frame subdivisions
      // otherwise turn a 30 Hz gun into a 20 Hz gun on 50 ms frames.
      const cooldown = game.weaponState.cooldown;
      const step = Math.min(remaining, .05, game.weapon.fireInterval, cooldown > 0 ? cooldown : Infinity);
      remaining = Math.max(0, remaining - step);
      game.simulationTime += step;
      tickRangeTargets(this.state, step);
      replenishRangeReserves(game.player.equipment);
      tickEquipment(game.player.equipment, step);
      game.stepPlayerControls(step, game.input.read(), game.getActors(), { allowGear: false });
      game.recoil *= Math.exp(-step * 13);
      game.stepCombatFeedback(step);
      this.view.update(step, game.camera);
    }
    this.refreshView();
  }
  beginShot() { this.shotLanded = false; }
  resolvePellet({ origin, direction, weapon }) {
    if (this.disposed) return { landed: false, killed: false, hitPoint: null };
    const hit = traceRangeRay(this.state, { origin, direction, range: weapon.range, solids: this.game.world.solids });
    if (!hit) return { landed: false, killed: false, hitPoint: null };
    const falloff = weapon.classId === 'shotgun' || weapon.classId === 'smg'
      ? Math.max(.35, 1 - hit.distance / weapon.range * .6) : 1;
    const result = applyRangeHit(this.state, hit, weapon.damage * falloff);
    this.shotLanded ||= result.landed;
    if (result.kill) this.progression.kill(result.kill);
    if (result.landed) this.view.hit({ ...hit, damage: result.damage });
    return { landed: result.landed, killed: result.killed, hitPoint: new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z) };
  }
  finishShot() {
    if (this.disposed) return;
    recordRangeShot(this.state, this.shotLanded);
    this.refreshView();
  }
  requestEquipment(action) {
    if (this.disposed || !action || typeof action !== 'object' || Array.isArray(action)
      || Reflect.ownKeys(action).length !== 3 || action.kind !== 'equip-gun'
      || !['kind', 'weaponId', 'source'].every(key => hasOwn(action, key)))
      return { ok: false, reason: 'Only guns are available in practice' };
    const result = equipRangeGun(this.game.player.equipment, action.weaponId, { source: action.source });
    if (result.ok) this.game.syncPlayerEquipment();
    return result;
  }
  refreshView() {
    if (this.disposed) return;
    const game = this.game, snapshot = rangeSnapshot(this.state);
    const { targetKills, shotsFired, shotsHit, accuracy } = snapshot;
    game.matchView = { modeId: 'range', mapId: 'shooting-range', ended: false,
      timeLeft: null, winnerId: null, winnerName: null, winnerTeamId: null, teamScores: { blue: 0, red: 0 }, flags: {},
      players: [{ id: game.player.id, name: game.player.name, teamId: null, skinId: game.player.skinId, kills: targetKills, deaths: 0 }],
      range: { targetKills, shotsFired, shotsHit, accuracy, earnedXP: this.progression.snapshot().earnedTotal } };
    game.match = { timeLeft: null, kills: targetKills, deaths: 0, ended: false };
    this.view.sync(snapshot);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try { this.progression?.close(); }
    finally {
      this.view?.dispose();
      // Startup may fail after attaching a world but before it is assigned here.
      const world = this.world ?? (this.game.world?.definition === RANGE_MAP ? this.game.world : null);
      world?.dispose();
      if (this.game.world === world) this.game.world = null;
      this.game.clearEffects();
    }
  }
}

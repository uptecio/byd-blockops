import * as THREE from 'three';
import { disposeModel } from './game.js';
import { createEquipment, refillOwnedAmmo } from './equipment.js';
import { createLootState } from './loot.js';
import { ZOMBIE_BALANCE, createSurvival, tickSurvival, nextZombieSpawn, resolveZombieSpawn,
  recordZombieDeath, settleSurvival, survivalView } from './zombie-survival.js';
import { createZombieBrain, selectZombieSpawn, stepZombieBrain } from './zombie-brain.js';
import { createZombieModel, animateZombieModel } from './zombie-avatar.js';

export class ZombieRuntime {
  constructor(game) { this.game = game; this.disposed = false; }
  start(weaponId, settings) {
    const game = this.game;
    this.state = createSurvival(settings.mapId); game.modeState = this.state;
    game.loadMap(settings.mapId); game.player.equipment = createEquipment(weaponId);
    Object.assign(game.player, { id:'local', name:'You', teamId:null, lifeId:0, pendingSkinId:settings.skinId });
    game.hasRound = true; game.endReported = false; game.resetPlayer(true);
    game.lootState = createLootState({ mapId:settings.mapId, seed:Math.floor(Math.random()*4294967296), startingGunIds:[weaponId] });
    game.simulationTime = 0; game.gearEvents = []; game.pickupEvents = []; game.gearEventId = 0;
    this.refreshView(); game.refreshGearView(); game.input.clear(); game.resume();
    game.audio.zombieWave?.(); game.events.onToast('WAVE 1 · SURVIVE');
  }
  canAttack() { return !this.disposed && this.state.phase === 'fighting' && !this.state.ended; }
  isEnemy(sourceId, targetId) {
    return sourceId === 'local' ? this.state.activeIds.has(targetId)
      : targetId === 'local' && this.state.activeIds.has(sourceId);
  }
  actors() {
    return this.game.bots.map(z => ({ id:z.id, name:z.model.name, kind:z.kind, lifeId:z.lifeId,
      teamId:null, skinId:null, equipment:null, x:z.model.position.x,y:0,z:z.model.position.z,
      yaw:z.yaw,pitch:0,health:z.health,alive:z.health>0,protectedRemaining:0,flashRemaining:z.flashRemaining }));
  }
  record() {
    this.game.events.onSurvivalRecord?.({ mapId:this.state.mapId, waves:this.state.completedWaves, kills:this.state.kills });
  }
  beginStep(dt) {
    if (this.disposed || this.state.ended) return;
    const game = this.game;
    if (game.player.health <= 0) { this.finishStep(); return; }
    for (const event of tickSurvival(this.state, dt)) if (event.type === 'wave-start') {
      game.audio.zombieWave?.(); game.events.onToast(`WAVE ${event.wave} · SURVIVE`);
    }
    const candidate = nextZombieSpawn(this.state);
    if (!candidate) return;
    // Re-evaluate occupied locations at acceptance, not when the wave was queued.
    const point = selectZombieSpawn({ map:game.world.definition,navigation:game.navigation,
      player:game.getActors()[0],zombies:this.actors(),
      fovRadians:2*Math.atan(Math.tan(game.camera.fov*Math.PI/360)*game.camera.aspect) });
    if (!point) { resolveZombieSpawn(this.state,candidate.id,false); return; }
    const model = createZombieModel(THREE,candidate.kind);
    if (!resolveZombieSpawn(this.state,candidate.id,true)) { disposeModel(model); return; }
    model.position.set(point.x,0,point.z); game.world.botGroup.add(model);
    game.bots.push({ ...candidate,lifeId:1,model,bar:model.getObjectByName('health-bar'),health:100,
      respawn:0,protected:0,flashRemaining:0,slashRemaining:0,brain:createZombieBrain(candidate.kind),yaw:0 });
  }
  updateEnemies(dt, actors) {
    if (!this.canAttack()) return;
    const game = this.game, player = actors[0];
    for (const zombie of game.bots) {
      if (this.state.ended) break;
      if (zombie.health <= 0) continue;
      const actor = actors.find(a => a.id === zombie.id);
      zombie.flashRemaining = Math.max(0,zombie.flashRemaining-dt);
      zombie.slashRemaining = Math.max(0,zombie.slashRemaining-dt);
      actor.flashRemaining = zombie.flashRemaining;
      const next = stepZombieBrain(zombie.brain,{ actor,player,zombies:actors.slice(1),navigation:game.navigation,
        solids:game.world.solids,smokes:game.gearCombatState.smokes,dt });
      const moving = Math.hypot(next.x-actor.x,next.z-actor.z)>1e-8;
      zombie.model.position.set(next.x,0,next.z); zombie.yaw=next.yaw; zombie.model.rotation.y=next.yaw+Math.PI;
      Object.assign(actor,{ x:next.x,z:next.z,yaw:next.yaw });
      zombie.bar.rotation.y=game.yaw-zombie.model.rotation.y;
      if (next.attack) {
        zombie.slashRemaining=.2;
        game.damageActor(zombie.id,game.player,ZOMBIE_BALANCE[zombie.kind].damage,actors);
      }
      animateZombieModel(zombie.model,{ time:game.simulationTime,moving,slashing:zombie.slashRemaining>0 });
    }
  }
  onEliminated(victim) {
    if (victim.id === 'local') {
      this.finishStep();
    } else {
      recordZombieDeath(this.state,victim.id); victim.model.visible=false; this.refreshView();
    }
  }
  finishStep() {
    if (this.disposed) return;
    const game=this.game;
    game.bots=game.bots.filter(z => { if (z.health>0) return true; disposeModel(z.model); return false; });
    for (const event of settleSurvival(this.state,game.player.health>0)) {
      if (event.type === 'recovery') {
        // The preparation break starts clean, without spending or rerolling loot.
        const combat=game.gearCombatState;
        combat.projectiles.length=0; combat.smokes.length=0; combat.events.length=0; combat.reservedSmoke=0;
        game.gearEvents=game.pickupEvents.slice();
        game.clearEffects(); game.gearView?.clear();
        game.player.flashRemaining=0; game.shotFlash=0; game.hitFlash=0; game.damageFlash=0; game.recoil=0;
        game.muzzle.visible=false;
        game.player.health=100; refillOwnedAmmo(game.player.equipment); game.syncPlayerEquipment();
        game.refreshGearView();
        game.audio.zombieRecovery?.(); game.events.onToast('WAVE CLEAR · HEALTH & AMMO RESTORED'); this.record();
      } else if (event.type === 'ended') this.record();
    }
    this.refreshView(); game.finishRound();
  }
  refreshView() {
    const game=this.game,survival=survivalView(this.state);
    game.matchView={ modeId:'zombies',mapId:this.state.mapId,timeLeft:0,ended:this.state.ended,survival,
      winnerId:null,winnerTeamId:null,teamScores:{ red:0,blue:0 },flags:{},
      players:[{ id:'local',name:'You',teamId:null,kills:this.state.kills,deaths:this.state.ended?1:0,skinId:game.player.skinId }] };
    Object.assign(game.match,{ timeLeft:0,kills:this.state.kills,deaths:this.state.ended?1:0,ended:this.state.ended });
  }
  dispose() {
    if (this.disposed) return;
    this.disposed=true;
    for(const zombie of this.game.bots) disposeModel(zombie.model);
    this.game.bots=[]; this.state?.activeIds.clear();
  }
}

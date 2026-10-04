import { getMap } from './maps.js';

export const ZOMBIE_BALANCE = Object.freeze({
  maxAlive: 8, spawnInterval: 1, recoverySeconds: 10, spawnDistance: 8, separation: .8, pathInterval: .15,
  walker: Object.freeze({ health: 100, speed: 2.1, damage: 20, interval: 1.2 }),
  runner: Object.freeze({ health: 100, speed: 3.4, damage: 15, interval: .9 }),
});

export function waveConfig(wave) {
  const total = 5 + 2 * (wave - 1);
  if (!Number.isSafeInteger(wave) || wave < 1 || !Number.isSafeInteger(total)) throw new RangeError('Invalid zombie wave');
  const runners = wave < 3 ? 0 : Math.floor(total * Math.min(.5, .25 + .025 * (wave - 3)));
  return { total, walkers: total - runners, runners };
}

export function createSurvival(mapId) {
  getMap(mapId);
  return { modeId: 'zombies', mapId, phase: 'fighting', ended: false, wave: 1, completedWaves: 0,
    kills: 0, elapsed: 0, queued: 5, spawned: 0, activeIds: new Set(), spawnRemaining: 0,
    recoveryRemaining: 0, nextId: 1 };
}

export function tickSurvival(state, dt) {
  if (state.ended || !Number.isFinite(dt) || dt <= 0) return [];
  state.elapsed = Math.min(Number.MAX_SAFE_INTEGER, state.elapsed + dt);
  if (state.phase === 'recovery') {
    state.recoveryRemaining = Math.max(0, state.recoveryRemaining - dt);
    if (state.recoveryRemaining > 1e-9) return [];
    const next = waveConfig(state.wave + 1);
    Object.assign(state, { phase: 'fighting', wave: state.wave + 1, queued: next.total,
      spawned: 0, spawnRemaining: 0, recoveryRemaining: 0 });
    return [{ type: 'wave-start', wave: state.wave }];
  }
  state.spawnRemaining = Math.max(0, state.spawnRemaining - dt);
  if (state.spawnRemaining < 1e-9) state.spawnRemaining = 0;
  return [];
}

export function nextZombieSpawn(state) {
  if (state.ended || state.phase !== 'fighting' || state.queued <= 0 || state.spawnRemaining > 0
    || state.activeIds.size >= ZOMBIE_BALANCE.maxAlive) return null;
  if (!Number.isSafeInteger(state.nextId) || state.nextId >= Number.MAX_SAFE_INTEGER) throw new RangeError('Zombie identity exhausted');
  const { total, runners } = waveConfig(state.wave), i = state.spawned;
  return { id: `zombie-${state.nextId}`, kind: Math.floor((i + 1) * runners / total) > Math.floor(i * runners / total) ? 'runner' : 'walker' };
}

export function resolveZombieSpawn(state, id, accepted) {
  const candidate = nextZombieSpawn(state);
  if (!candidate || candidate.id !== id || typeof accepted !== 'boolean') return false;
  state.spawnRemaining = ZOMBIE_BALANCE.spawnInterval;
  if (!accepted) return false;
  state.activeIds.add(id); state.nextId++; state.spawned++; state.queued--;
  return true;
}

export function recordZombieDeath(state, id) {
  if (state.ended || state.phase !== 'fighting' || !state.activeIds.has(id)) return false;
  if (!Number.isSafeInteger(state.kills + 1)) throw new RangeError('Zombie score exhausted');
  state.activeIds.delete(id); state.kills++;
  return true;
}

export function settleSurvival(state, playerAlive) {
  if (state.ended) return [];
  if (!playerAlive) {
    state.phase = 'ended'; state.ended = true;
    return [{ type: 'ended' }];
  }
  if (state.phase !== 'fighting' || state.queued !== 0 || state.activeIds.size !== 0) return [];
  state.completedWaves = state.wave; state.phase = 'recovery';
  state.recoveryRemaining = ZOMBIE_BALANCE.recoverySeconds;
  return [{ type: 'recovery', completedWaves: state.completedWaves }];
}

export function survivalView(state) {
  const { phase, wave, completedWaves, kills, elapsed, queued, recoveryRemaining } = state;
  return { phase, wave, completedWaves, kills, elapsed, queued, recoveryRemaining,
    alive: state.activeIds.size, remaining: queued + state.activeIds.size };
}

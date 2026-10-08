import { createSpatialWorld, interactionReach, dropAnchor } from './spatial.js';

export const MODES = Object.freeze([
  Object.freeze({ id: 'ffa', name: 'Free For All', duration: 180, scoreLimit: 15 }),
  Object.freeze({ id: 'tdm', name: 'Team Deathmatch', duration: 180, scoreLimit: 30 }),
  Object.freeze({ id: 'ctf', name: 'Capture The Flag', duration: 180, scoreLimit: 3 }),
]);

const teams = ['red', 'blue'];
const privateState = new WeakMap();
const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const validId = id => typeof id === 'string' && id.trim().length > 0;
const validPoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.z) && Number.isFinite(point.y ?? 0);
const validLife = lifeId => Number.isSafeInteger(lifeId) && lifeId >= 0;
const registered = (state, id) => validId(id) && owns(state.stats, id);
const define = (object, key, value) => Object.defineProperty(object, key, { value, enumerable: true, configurable: true, writable: true });
const otherTeam = teamId => teamId === 'red' ? 'blue' : 'red';
const closeEnough = (state, a, b) => interactionReach(a, b, privateState.get(state).world);
const flagEvent = (type, teamId, playerId) => ({ type, teamId, playerId });

export function getMode(id) {
  const mode = MODES.find(mode => mode.id === id);
  if (!mode) throw new Error('Unknown mode.');
  return mode;
}

export function assignTeams(ids, modeId) {
  getMode(modeId);
  if (!Array.isArray(ids) || ids.some(id => !validId(id)) || new Set(ids).size !== ids.length) throw new Error('Participant IDs must be distinct nonempty strings.');
  const assignments = {};
  ids.forEach((id, index) => define(assignments, id, modeId === 'ffa' ? null : teams[index % 2]));
  return assignments;
}

export function createModeState({ modeId, map, participants } = {}) {
  const mode = getMode(modeId);
  if (!map || !validId(map.id)) throw new Error('A map ID is required.');
  if (!Array.isArray(participants)) throw new Error('Participants must be an array.');
  const stats = {};
  for (const participant of participants) {
    if (!participant || !validId(participant.id) || owns(stats, participant.id)) throw new Error('Participant IDs must be distinct nonempty strings.');
    if (modeId === 'ffa' ? participant.teamId !== null : !teams.includes(participant.teamId)) throw new Error('Invalid participant team.');
    define(stats, participant.id, { teamId: participant.teamId, kills: 0, deaths: 0 });
  }
  let bases = null, flags = null;
  if (modeId === 'ctf') {
    if (!map.bases || !teams.every(team => validPoint(map.bases[team]))) throw new Error('CTF requires two finite flag bases.');
    bases = {}; flags = {};
    for (const teamId of teams) {
      const { x, y = 0, z } = map.bases[teamId];
      bases[teamId] = { x, y, z };
      flags[teamId] = { teamId, status: 'home', x, y, z, carrierId: null, returnRemaining: 0 };
    }
  }
  const state = { modeId, mapId: map.id, timeLeft: mode.duration, ended: false, winnerId: null, winnerTeamId: null, teamScores: { red: 0, blue: 0 }, stats, flags };
  privateState.set(state, { bases, world: createSpatialWorld(map), eliminatedLives: new Map() });
  return state;
}

export function addParticipant(state, participant) {
  if (!participant || !validId(participant.id) || registered(state, participant.id)) throw new Error('A new participant ID is required.');
  let teamId = null;
  if (state.modeId !== 'ffa') {
    const counts = { red: 0, blue: 0 };
    for (const stats of Object.values(state.stats)) counts[stats.teamId]++;
    teamId = counts.red <= counts.blue ? 'red' : 'blue';
  }
  define(state.stats, participant.id, { teamId, kills: 0, deaths: 0 });
  return teamId;
}

export function areEnemies(state, attackerId, targetId) {
  return attackerId !== targetId && registered(state, attackerId) && registered(state, targetId)
    && (state.modeId === 'ffa' || state.stats[attackerId].teamId !== state.stats[targetId].teamId);
}

function dropFlags(state, id, position) {
  const events = [];
  if (state.flags) for (const teamId of teams) {
    const flag = state.flags[teamId];
    if (flag.status !== 'carried' || flag.carrierId !== id) continue;
    const anchor = dropAnchor({ x: position.x, y: position.y ?? 0, z: position.z }, privateState.get(state).world);
    if (!anchor) { returnFlag(state, flag); events.push(flagEvent('flag-return', teamId, null)); continue; }
    Object.assign(flag, { status: 'dropped', ...anchor, carrierId: null, returnRemaining: 15 });
    events.push(flagEvent('flag-drop', teamId, id));
  }
  return events;
}

function returnFlag(state, flag) {
  Object.assign(flag, privateState.get(state).bases[flag.teamId], { status: 'home', carrierId: null, returnRemaining: 0 });
}

function finish(state, winnerId = null, winnerTeamId = null) {
  state.ended = true; state.winnerId = winnerId; state.winnerTeamId = winnerTeamId;
}

export function recordElimination(state, notification) {
  if (state.ended || !notification) return [];
  const { killerId, victimId, position, lifeId } = notification;
  if (!areEnemies(state, killerId, victimId) || !validPoint(position) || !validLife(lifeId)) return [];
  const eliminated = privateState.get(state).eliminatedLives;
  let lives = eliminated.get(victimId);
  if (lives && lives.has(lifeId)) return [];
  if (!lives) { lives = new Set(); eliminated.set(victimId, lives); }
  lives.add(lifeId);
  const killer = state.stats[killerId];
  killer.kills++; state.stats[victimId].deaths++;
  const events = dropFlags(state, victimId, position);
  const limit = getMode(state.modeId).scoreLimit;
  if (state.modeId === 'ffa' && killer.kills >= limit) finish(state, killerId);
  if (state.modeId === 'tdm' && ++state.teamScores[killer.teamId] >= limit) finish(state, null, killer.teamId);
  return events;
}

export function removeParticipant(state, id, position) {
  if (!registered(state, id) || !validPoint(position)) return [];
  const events = state.ended ? [] : dropFlags(state, id, position);
  delete state.stats[id];
  // Keep dedupe history: a delayed kill for a departed life must not score if
  // the same participant ID is subsequently added again during this round.
  return events;
}

function validActors(state, actors) {
  if (!Array.isArray(actors)) return [];
  const counts = new Map();
  for (const actor of actors) if (actor && validId(actor.id)) counts.set(actor.id, (counts.get(actor.id) || 0) + 1);
  return actors.filter(actor => actor && registered(state, actor.id) && counts.get(actor.id) === 1
    && actor.teamId === state.stats[actor.id].teamId && validPoint(actor) && Number.isFinite(actor.y)
    && typeof actor.alive === 'boolean' && Number.isFinite(actor.protectedRemaining) && actor.protectedRemaining >= 0 && validLife(actor.lifeId))
    .slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function tickFlags(state, dt, actors) {
  const events = [];
  // Coordinates follow the carrier; adapters report deaths/disconnects through
  // recordElimination/removeParticipant so drops use the authoritative location.
  for (const actor of actors) for (const flag of Object.values(state.flags)) {
    if (flag.status === 'carried' && flag.carrierId === actor.id) { flag.x = actor.x; flag.y = actor.y; flag.z = actor.z; }
  }
  // Automatic returns have no participant; use stable Red/Blue flag order.
  for (const teamId of teams) {
    const flag = state.flags[teamId];
    if (flag.status !== 'dropped') continue;
    flag.returnRemaining = Math.max(0, flag.returnRemaining - dt);
    if (flag.returnRemaining <= 1e-9) { returnFlag(state, flag); events.push(flagEvent('flag-return', teamId, null)); }
  }
  for (const actor of actors) {
    const ownFlag = state.flags[actor.teamId];
    if (actor.alive && !actor.hiddenSpotId && ownFlag.status === 'dropped' && closeEnough(state, actor, ownFlag)) {
      returnFlag(state, ownFlag); events.push(flagEvent('flag-return', actor.teamId, actor.id));
    }
  }
  for (const actor of actors) {
    if (!actor.alive || actor.hiddenSpotId || actor.protectedRemaining > 0 || Object.values(state.flags).some(flag => flag.carrierId === actor.id)) continue;
    const enemy = state.flags[otherTeam(actor.teamId)];
    if (enemy.status !== 'carried' && closeEnough(state, actor, enemy)) {
      Object.assign(enemy, { status: 'carried', x: actor.x, y: actor.y, z: actor.z, carrierId: actor.id, returnRemaining: 0 });
      events.push(flagEvent('flag-pickup', enemy.teamId, actor.id));
    }
  }
  for (const actor of actors) {
    if (!actor.alive || actor.hiddenSpotId) continue;
    const enemy = state.flags[otherTeam(actor.teamId)], ownFlag = state.flags[actor.teamId];
    if (enemy.status === 'carried' && enemy.carrierId === actor.id && ownFlag.status === 'home' && closeEnough(state, actor, ownFlag)) {
      returnFlag(state, enemy); state.teamScores[actor.teamId]++;
      events.push(flagEvent('flag-capture', actor.teamId, actor.id));
      if (state.teamScores[actor.teamId] >= getMode(state.modeId).scoreLimit) { finish(state, null, actor.teamId); return events; }
    }
  }
  return events;
}

export function tickMode(state, dt, actors) {
  if (state.ended || !Number.isFinite(dt) || dt <= 0) return [];
  const elapsed = Math.min(dt, state.timeLeft);
  state.timeLeft = Math.max(0, state.timeLeft - elapsed);
  if (state.timeLeft < 1e-9) state.timeLeft = 0;
  const events = state.flags ? tickFlags(state, elapsed, validActors(state, actors)) : [];
  if (!state.ended && state.timeLeft === 0) {
    if (state.modeId === 'ffa') {
      const leaders = Object.keys(state.stats).sort((a, b) => state.stats[b].kills - state.stats[a].kills);
      finish(state, leaders.length && (leaders.length === 1 || state.stats[leaders[0]].kills > state.stats[leaders[1]].kills) ? leaders[0] : null);
    } else finish(state, null, state.teamScores.red === state.teamScores.blue ? null : state.teamScores.red > state.teamScores.blue ? 'red' : 'blue');
  }
  return events;
}

export function getModeSnapshot(state) {
  const { modeId, mapId, timeLeft, ended, winnerId, winnerTeamId } = state;
  return { modeId, mapId, timeLeft, ended, winnerId, winnerTeamId, teamScores: { ...state.teamScores },
    flags: state.flags ? { red: { ...state.flags.red }, blue: { ...state.flags.blue } } : null };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES, getMode, assignTeams, createModeState, addParticipant, areEnemies, recordElimination, tickMode, removeParticipant, getModeSnapshot } from '../src/modes.js';

const map = { id: 'fixture', bounds: { min: -30, max: 30 }, solids: [], bases: { red: { x: 0, z: 0 }, blue: { x: 10, z: 0 } } };
const participants = [{ id: 'a', teamId: 'red' }, { id: 'b', teamId: 'blue' }, { id: 'c', teamId: 'red' }];
const stateFor = (modeId = 'ctf') => createModeState({ modeId, map, participants: participants.map(p => ({ ...p, teamId: modeId === 'ffa' ? null : p.teamId })) });
const actor = (id, x, extra = {}) => ({ id, teamId: id === 'b' ? 'blue' : 'red', x, y: 0, z: 0, alive: true, protectedRemaining: 0, lifeId: 0, ...extra });
const kill = (state, lifeId, killerId = 'a', victimId = 'b', position = { x: 5, z: 0 }) => recordElimination(state, { killerId, victimId, position, lifeId });
const event = (type, teamId, playerId) => ({ type, teamId, playerId });

test('approved catalogs and strict mode selection agree with balanced team assignments', () => {
  assert.deepEqual(MODES.map(({ id, duration, scoreLimit }) => [id, duration, scoreLimit]), [['ffa', 180, 15], ['tdm', 180, 30], ['ctf', 180, 3]]);
  assert.equal(getMode('tdm').name, 'Team Deathmatch');
  assert.throws(() => getMode('missing'));
  assert.deepEqual(assignTeams(['local', 'bot-0', 'bot-1'], 'ctf'), { local: 'red', 'bot-0': 'blue', 'bot-1': 'red' });
  assert.deepEqual(assignTeams(['a', 'b'], 'ffa'), { a: null, b: null });
  assert.throws(() => assignTeams(['a', 'a'], 'tdm'));
  assert.throws(() => assignTeams(['a'], 'missing'));
});

test('joiners balance existing teams, keep old assignments and reject duplicate participants', () => {
  const state = stateFor('tdm');
  assert.equal(addParticipant(state, { id: 'd' }), 'blue');
  assert.equal(addParticipant(state, { id: 'e' }), 'red');
  assert.equal(state.stats.a.teamId, 'red');
  assert.equal(state.stats.b.teamId, 'blue');
  assert.throws(() => addParticipant(state, { id: 'a' }));
  assert.equal(addParticipant(stateFor('ffa'), { id: 'd' }), null);
});

test('friendly, self and unregistered eliminations cannot change scores or dedupe a valid kill', () => {
  const state = stateFor('tdm');
  assert.equal(areEnemies(state, 'a', 'b'), true);
  for (const [killer, victim] of [['a', 'c'], ['a', 'a'], ['missing', 'b'], ['a', 'missing']]) {
    assert.equal(areEnemies(state, killer, victim), false);
    assert.deepEqual(kill(state, 0, killer, victim), []);
  }
  kill(state, 0);
  assert.deepEqual(state.teamScores, { red: 1, blue: 0 });
  assert.equal(state.stats.a.kills, 1); assert.equal(state.stats.b.deaths, 1);
});

test('victim lives score once even when a duplicate names a different killer', () => {
  const state = stateFor('tdm');
  kill(state, 7); kill(state, 7, 'c'); kill(state, 8, 'c'); kill(state, 7);
  assert.deepEqual(state.teamScores, { red: 2, blue: 0 });
  assert.equal(state.stats.a.kills, 1); assert.equal(state.stats.c.kills, 1); assert.equal(state.stats.b.deaths, 2);
});

test('FFA ends on the fifteenth individual kill, with independent opponents and frozen final scores', () => {
  const state = stateFor('ffa');
  assert.equal(areEnemies(state, 'a', 'c'), true);
  kill(state, 0, 'c', 'a');
  for (let i = 0; i < 14; i++) kill(state, i);
  assert.equal(state.ended, false); assert.equal(state.stats.c.kills, 1);
  kill(state, 14);
  assert.equal(state.ended, true); assert.equal(state.winnerId, 'a'); assert.equal(state.winnerTeamId, null);
  const before = structuredClone(state);
  kill(state, 15); tickMode(state, 200, []);
  assert.deepEqual(state, before); assert.deepEqual(state.teamScores, { red: 0, blue: 0 });
});

test('TDM combines teammates kills and ends at exactly thirty', () => {
  const state = stateFor('tdm');
  for (let i = 0; i < 29; i++) kill(state, i, i % 2 ? 'c' : 'a');
  assert.equal(state.ended, false); assert.equal(state.teamScores.red, 29);
  kill(state, 29, 'c'); kill(state, 30);
  assert.equal(state.ended, true); assert.equal(state.teamScores.red, 30);
  assert.equal(state.winnerTeamId, 'red'); assert.equal(state.winnerId, null);
});

test('all modes run for 180 seconds and tied leaders finish in a draw', () => {
  for (const id of ['ffa', 'tdm', 'ctf']) {
    const state = stateFor(id);
    tickMode(state, 179.99, []); assert.equal(state.ended, false);
    tickMode(state, .01, []);
    assert.equal(state.timeLeft, 0); assert.equal(state.ended, true);
    assert.equal(state.winnerId, null); assert.equal(state.winnerTeamId, null);
  }
  const ffa = stateFor('ffa'); kill(ffa, 0); kill(ffa, 0, 'b', 'c');
  tickMode(ffa, 180, []); assert.equal(ffa.winnerId, null);
});

test('timeout picks the unique individual or team leader without a deaths tiebreaker', () => {
  const ffa = stateFor('ffa'); kill(ffa, 0); tickMode(ffa, 181, []); assert.equal(ffa.winnerId, 'a');
  const tdm = stateFor('tdm'); kill(tdm, 0, 'b', 'a'); tickMode(tdm, 180, []); assert.equal(tdm.winnerTeamId, 'blue');
  const ctf = stateFor(); tickMode(ctf, .1, [actor('a', 10)]); tickMode(ctf, .1, [actor('a', 0)]); tickMode(ctf, 180, []); assert.equal(ctf.winnerTeamId, 'red');
});

test('invalid deltas neither advance timers nor perform nearby flag interactions', () => {
  const state = stateFor(), before = structuredClone(state);
  for (const dt of [0, -1, NaN, Infinity, undefined, null, '1']) assert.deepEqual(tickMode(state, dt, [actor('a', 10)]), []);
  assert.deepEqual(state, before);
});

test('CTF pickup and capture use inclusive 1.2 horizontal and .75 vertical reach', () => {
  const state = stateFor();
  assert.deepEqual(tickMode(state, .1, [actor('a', 8.799)]), []);
  assert.deepEqual(tickMode(state, .1, [actor('a', 8.8, { y: .75001 })]), []);
  assert.deepEqual(tickMode(state, .1, [actor('a', 8.8, { y: .75 })]), [event('flag-pickup', 'blue', 'a')]);
  assert.equal(state.flags.blue.carrierId, 'a');
  assert.deepEqual(tickMode(state, .1, [actor('a', 1.201)]), []);
  assert.deepEqual(tickMode(state, .1, [actor('a', 1.2)]), [event('flag-capture', 'red', 'a')]);
  assert.equal(state.teamScores.red, 1); assert.equal(state.flags.blue.status, 'home');
  assert.equal(state.flags.blue.x, 10); assert.equal(state.flags.blue.carrierId, null);
});

test('CTF eliminations do not add capture scores', () => {
  const state = stateFor();
  for (let i = 0; i < 35; i++) kill(state, i);
  assert.deepEqual(state.teamScores, { red: 0, blue: 0 }); assert.equal(state.ended, false); assert.equal(state.stats.a.kills, 35);
});

test('a carrier cannot capture while their own flag is missing', () => {
  const state = stateFor();
  tickMode(state, .1, [actor('a', 10), actor('b', 0)]);
  assert.deepEqual(tickMode(state, .1, [actor('a', 0), actor('b', 10)]), []);
  assert.equal(state.flags.blue.status, 'carried'); assert.equal(state.flags.red.status, 'carried');
  assert.deepEqual(state.teamScores, { red: 0, blue: 0 });
});

test('death drops carried flag at supplied position, duplicate death cannot re-drop it', () => {
  const state = stateFor(); tickMode(state, .1, [actor('a', 10)]);
  assert.deepEqual(kill(state, 0, 'b', 'a', { x: 4, z: 2 }), [event('flag-drop', 'blue', 'a')]);
  assert.deepEqual(state.flags.blue, { teamId: 'blue', status: 'dropped', x: 4, y: 0, z: 2, carrierId: null, returnRemaining: 15 });
  tickMode(state, 1, []); kill(state, 0, 'b', 'a', { x: 9, z: 9 });
  assert.equal(state.flags.blue.x, 4); assert.equal(state.flags.blue.returnRemaining, 14);
});

test('dropped flags remain for 14.99 seconds then auto-return at 15', () => {
  const state = stateFor(); tickMode(state, .1, [actor('a', 10)]); kill(state, 0, 'b', 'a');
  assert.deepEqual(tickMode(state, 14.99, []), []); assert.equal(state.flags.blue.status, 'dropped');
  assert.deepEqual(tickMode(state, .01, []), [event('flag-return', 'blue', null)]);
  assert.equal(state.flags.blue.status, 'home'); assert.equal(state.flags.blue.x, 10);
});

test('own-team touching a dropped flag returns it before a competing enemy pickup', () => {
  const state = stateFor(); tickMode(state, .1, [actor('a', 10)]); kill(state, 0, 'b', 'a');
  assert.deepEqual(tickMode(state, .1, [actor('a', 5), actor('b', 5)]), [event('flag-return', 'blue', 'b')]);
  assert.equal(state.flags.blue.status, 'home');
});

test('touch returns run before captures, permitting same-tick capture after an ally returns home flag', () => {
  const state = stateFor(); tickMode(state, .1, [actor('a', 10), actor('b', 0)]);
  kill(state, 0, 'c', 'b', { x: 0, z: 0 });
  assert.deepEqual(tickMode(state, .1, [actor('a', 0), actor('c', 0)]), [event('flag-return', 'red', 'a'), event('flag-capture', 'red', 'a')]);
  assert.equal(state.teamScores.red, 1);
});

test('enemy can recover dropped flag and its position follows its sole carrier', () => {
  const state = stateFor(); tickMode(state, .1, [actor('a', 10)]); kill(state, 0, 'b', 'a');
  assert.deepEqual(tickMode(state, .1, [actor('c', 5)]), [event('flag-pickup', 'blue', 'c')]);
  tickMode(state, .1, [actor('c', 3, { z: 2 })]);
  assert.equal(state.flags.blue.x, 3); assert.equal(state.flags.blue.z, 2); assert.equal(state.flags.blue.returnRemaining, 0);
});

test('dead, protected, unregistered, malformed and wrong-team actors cannot steal', () => {
  for (const bad of [actor('a', 10, { alive: false }), actor('a', 10, { protectedRemaining: 1 }), actor('ghost', 10), actor('a', NaN), actor('a', 10, { lifeId: -1 }), actor('a', 10, { teamId: 'blue' })]) {
    const state = stateFor(); assert.deepEqual(tickMode(state, .1, [bad]), []); assert.equal(state.flags.blue.status, 'home');
  }
});

test('simultaneous pickups use participant-ID order regardless of actor input ordering', () => {
  for (const actors of [[actor('c', 10), actor('a', 10)], [actor('a', 10), actor('c', 10)]]) {
    const state = stateFor();
    assert.deepEqual(tickMode(state, .1, actors), [event('flag-pickup', 'blue', 'a')]);
    assert.equal(Object.values(state.flags).filter(flag => flag.carrierId === 'a').length, 1);
  }
});

test('exactly the third capture ends CTF and later ticks cannot move flags or score', () => {
  const state = stateFor();
  for (let i = 0; i < 3; i++) {
    tickMode(state, .1, [actor('a', 10)]);
    assert.deepEqual(tickMode(state, .1, [actor('a', 0)]), [event('flag-capture', 'red', 'a')]);
    assert.equal(state.ended, i === 2);
  }
  assert.equal(state.teamScores.red, 3); assert.equal(state.winnerTeamId, 'red');
  const before = structuredClone(state); tickMode(state, 100, [actor('a', 10)]); kill(state, 99);
  assert.deepEqual(state, before);
});

test('disconnect drops flag before removing stats and does not erase accrued team score', () => {
  const state = stateFor(); tickMode(state, .1, [actor('a', 10)]);
  assert.deepEqual(removeParticipant(state, 'a', { x: 6, z: 1 }), [event('flag-drop', 'blue', 'a')]);
  assert.equal(state.stats.a, undefined); assert.equal(state.flags.blue.x, 6); assert.equal(areEnemies(state, 'a', 'b'), false);
  const tdm = stateFor('tdm'); kill(tdm, 0); removeParticipant(tdm, 'a', { x: 0, z: 0 });
  assert.equal(tdm.teamScores.red, 1);
  assert.deepEqual(removeParticipant(tdm, 'missing', { x: 0, z: 0 }), []);
});

test('snapshots and input map mutations cannot mutate rule state or saved flag bases', () => {
  const definition = structuredClone(map);
  const state = createModeState({ modeId: 'ctf', map: definition, participants });
  definition.bases.blue.x = 99;
  const snapshot = getModeSnapshot(state); assert.equal('stats' in snapshot, false);
  assert.deepEqual(Object.keys(snapshot).sort(), ['ended', 'flags', 'mapId', 'modeId', 'teamScores', 'timeLeft', 'winnerId', 'winnerTeamId'].sort());
  snapshot.flags.blue.x = 50; snapshot.teamScores.red = 8;
  tickMode(state, .1, [actor('a', 10)]); tickMode(state, .1, [actor('a', 0)]);
  assert.equal(state.flags.blue.x, 10); assert.equal(state.teamScores.red, 1);
  assert.equal(getModeSnapshot(stateFor('ffa')).flags, null);
});

test('invalid setup and malformed notifications cannot poison state', () => {
  assert.throws(() => createModeState({ modeId: 'wrong', map, participants }));
  assert.throws(() => createModeState({ modeId: 'ctf', map: { id: 'bad', bases: { red: { x: NaN, z: 0 }, blue: map.bases.blue } }, participants }));
  assert.throws(() => createModeState({ modeId: 'tdm', map, participants: [{ id: 'a', teamId: 'green' }] }));
  assert.throws(() => createModeState({ modeId: 'tdm', map, participants: [participants[0], participants[0]] }));
  const state = stateFor(), before = structuredClone(state);
  for (const lifeId of [NaN, Infinity, -1, 1.5, '0', undefined]) assert.deepEqual(kill(state, lifeId), []);
  assert.deepEqual(kill(state, 0, 'a', 'b', { x: NaN, z: 0 }), []);
  assert.deepEqual(recordElimination(state, null), []);
  assert.deepEqual(state, before);
  const active = stateFor(); tickMode(active, .1, [actor('a', 10)]);
  const carried = structuredClone(active); assert.deepEqual(removeParticipant(active, 'a', { x: Infinity, z: 0 }), []); assert.deepEqual(active, carried);
  assert.doesNotThrow(() => tickMode(state, .1, null));
});

test('participant IDs matching object prototype names remain real isolated participants', () => {
  const state = createModeState({ modeId: 'ffa', map, participants: [{ id: '__proto__', teamId: null }, { id: 'constructor', teamId: null }] });
  assert.equal(areEnemies(state, '__proto__', 'constructor'), true);
  recordElimination(state, { killerId: '__proto__', victimId: 'constructor', lifeId: 0, position: { x: 0, z: 0 } });
  assert.equal(state.stats.__proto__.kills, 1); assert.equal(state.stats.constructor.deaths, 1);
  assert.equal({}.kills, undefined);
});

test('ended rooms allow roster joins and leaves without changing final flags, clock, score or winner', () => {
  const state = stateFor();
  tickMode(state, .1, [actor('a', 10)]);
  tickMode(state, 180, []);
  const final = getModeSnapshot(state);
  assert.equal(addParticipant(state, { id: 'd' }), 'blue');
  assert.deepEqual(removeParticipant(state, 'a', { x: 5, z: 0 }), []);
  assert.equal(state.stats.a, undefined); assert.deepEqual(state.stats.d, { teamId: 'blue', kills: 0, deaths: 0 });
  assert.deepEqual(getModeSnapshot(state), final);
  assert.deepEqual(tickMode(state, 1, [actor('d', 0, { teamId: 'blue' })]), []);
});

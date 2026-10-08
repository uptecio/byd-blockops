import test from 'node:test';
import assert from 'node:assert/strict';
import { createModeState, tickMode, recordElimination } from '../src/modes.js';

function round() { return createModeState({ modeId: 'ffa', map: { id: 'test', bounds: { min: -30, max: 30 }, solids: [] }, participants: [{ id: 'local', teamId: null }, { id: 'bot-0', teamId: null }] }); }
function kill(state, lifeId, killerId = 'local', victimId = 'bot-0') { recordElimination(state, { killerId, victimId, lifeId, position: { x: 0, z: 0 } }); }
test('a round expires after three minutes, never going below zero', () => {
  const state = round(); tickMode(state, 179, []); assert.equal(state.ended, false);
  tickMode(state, 2, []); assert.equal(state.ended, true); assert.equal(state.timeLeft, 0);
});
test('fifteenth elimination ends the round and later kills do not count', () => {
  const state = round(); for (let i = 0; i < 14; i++) kill(state, i);
  assert.equal(state.ended, false); kill(state, 14); kill(state, 15);
  assert.equal(state.stats.local.kills, 15); assert.equal(state.ended, true);
});
test('deaths are tracked separately and ended rounds stop advancing', () => {
  const state = round(); kill(state, 0, 'bot-0', 'local');
  assert.equal(state.stats.local.deaths, 1); assert.equal(state.stats.local.kills, 0);
  for (let i = 0; i < 15; i++) kill(state, i);
  tickMode(state, 80, []); kill(state, 1, 'bot-0', 'local');
  assert.equal(state.timeLeft, 180); assert.equal(state.stats.local.deaths, 1);
});
test('invalid elapsed time cannot corrupt round state', () => {
  const state = round(); for (const dt of [-1, NaN, Infinity, undefined]) tickMode(state, dt, []);
  assert.equal(state.timeLeft, 180);
});

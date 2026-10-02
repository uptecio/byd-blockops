import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, tickMatch, recordKill, recordDeath } from '../src/match.js';

test('a round expires after three minutes, never going below zero', () => {
  const round = createMatch();
  tickMatch(round, 179);
  assert.equal(round.ended, false);
  tickMatch(round, 2);
  assert.equal(round.ended, true);
  assert.equal(round.timeLeft, 0);
});
test('fifteenth elimination ends the round and later kills do not count', () => {
  const round = createMatch();
  for (let i = 0; i < 14; i++) recordKill(round);
  assert.equal(round.ended, false);
  recordKill(round);
  recordKill(round);
  assert.equal(round.kills, 15);
  assert.equal(round.ended, true);
});
test('deaths are tracked separately and ended rounds stop advancing', () => {
  const round = createMatch();
  recordDeath(round);
  assert.equal(round.deaths, 1);
  assert.equal(round.kills, 0);
  for (let i = 0; i < 15; i++) recordKill(round);
  tickMatch(round, 80);
  recordDeath(round);
  assert.equal(round.timeLeft, 180);
  assert.equal(round.deaths, 1);
});
test('invalid elapsed time cannot corrupt round state', () => {
  const round = createMatch();
  for (const dt of [-1, NaN, Infinity, undefined]) tickMatch(round, dt);
  assert.equal(round.timeLeft, 180);
});

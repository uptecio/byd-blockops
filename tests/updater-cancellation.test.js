import test from 'node:test';
import assert from 'node:assert/strict';
import { transferStopped } from '../android/tests/helpers/updater-native.js';

test('host accepts only the requested cancellation result with no bytes or sessions', () => {
  for (const [action, phase, message] of [
    ['cancel', 'idle', 'Update cancelled. You can retry.'],
    ['background', 'error', 'Update interrupted. Return Home to retry.'],
  ]) {
    const result = { phase, message, downloaded: 0, sessions: [] };
    assert.equal(transferStopped(result, action), true);
    for (const patch of [{ phase: 'ready' }, { phase: 'installing' }, { message: 'Unrelated error' },
      { downloaded: 1 }, { sessions: [7] }, { ownedSession: 7 }]) {
      assert.equal(transferStopped({ ...result, ...patch }, action), false, JSON.stringify(patch));
    }
  }
});

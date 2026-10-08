import test from 'node:test';
import assert from 'node:assert/strict';
import { createInputFixture } from './helpers/input-fixture.js';
const event = (type, fields = {}) => Object.assign(new Event(type, { cancelable: true }), fields);

test('H queues one fresh hide edge, held H never toggles twice, and E remains zoom', t => {
  const f = createInputFixture(); t.after(f.restore); f.input.setEnabled(true);
  f.window.dispatchEvent(event('keydown', { code: 'KeyH' }));
  assert.equal(f.input.read().hidePressed, true); assert.equal(f.input.read().hidePressed, false);
  for (const repeat of [true, false]) { f.window.dispatchEvent(event('keydown', { code: 'KeyH', repeat })); assert.equal(f.input.read().hidePressed, false); }
  f.window.dispatchEvent(event('keyup', { code: 'KeyH' })); f.window.dispatchEvent(event('keydown', { code: 'KeyH' }));
  const read = f.input.read(); assert.equal(read.hidePressed, true); assert.equal(read.fire, false); assert.equal(read.lookX, 0);
  f.window.dispatchEvent(event('keydown', { code: 'KeyE' })); assert.equal(f.input.read().zoom, true);
});

test('touch hide does not aim/fire and cancellation blur background and disable clear its edge', t => {
  const f = createInputFixture(); t.after(f.restore); f.input.setEnabled(true);
  const button = f.buttons.get('hide-button'); assert.ok(button);
  button.dispatchEvent(event('pointerdown', { pointerId: 1, clientX: 1, clientY: 1 }));
  button.dispatchEvent(event('pointermove', { pointerId: 1, clientX: 100, clientY: 100 }));
  const read = f.input.read(); assert.equal(read.hidePressed, true); assert.equal(read.fire, false); assert.equal(read.lookX, 0);
  assert.equal(f.input.read().hidePressed, false);
  for (const cancel of [() => button.dispatchEvent(event('pointercancel')), () => f.window.dispatchEvent(event('blur')),
    () => { f.document.hidden = true; f.document.dispatchEvent(event('visibilitychange')); }, () => f.input.setEnabled(false)]) {
    button.dispatchEvent(event('pointerup', { pointerId: 1 })); button.dispatchEvent(event('pointerdown', { pointerId: 1 })); cancel();
    assert.equal(f.input.read().hidePressed, false);
  }
});

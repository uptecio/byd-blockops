import test from 'node:test';
import assert from 'node:assert/strict';
import { createInputFixture } from './helpers/input-fixture.js';
import { createHeadlessGame, cleanupGame } from './helpers/game-fixture.js';

const event = (type, fields = {}) => Object.assign(new Event(type, { cancelable: true }), fields);
test('one pointer tap creates exactly one throw edge', t => {
  const { input, buttons, restore } = createInputFixture(); t.after(restore); input.setEnabled(true);
  buttons.get('throw-button')?.dispatchEvent(event('pointerdown', { pointerId: 7 }));
  assert.equal(input.read().throwPressed, true); assert.equal(input.read().throwPressed, false);
  input.clear(); assert.equal(input.read().throwPressed, false);
});
test('held and repeated G do not repeat throws, Q and T are independent edges', t => {
  const { input, window, restore } = createInputFixture(); t.after(restore); input.setEnabled(true);
  window.dispatchEvent(event('keydown', { code: 'KeyG', repeat: false })); assert.equal(input.read().throwPressed, true);
  window.dispatchEvent(event('keydown', { code: 'KeyG', repeat: true })); assert.equal(input.read().throwPressed, false);
  window.dispatchEvent(event('keydown', { code: 'KeyG', repeat: false })); assert.equal(input.read().throwPressed, false);
  window.dispatchEvent(event('keydown', { code: 'KeyQ' })); window.dispatchEvent(event('keydown', { code: 'KeyT' }));
  const read = input.read(); assert.equal(read.knifePressed, true); assert.equal(read.grenadePickerPressed, true); assert.equal(read.throwPressed, false);
});
test('pointer cancellation and backgrounding clear every combat edge and held pointer', t => {
  const { input, buttons, document, restore } = createInputFixture(); t.after(restore); input.setEnabled(true);
  for (const id of ['fire-button', 'throw-button', 'knife-button', 'grenade-type-button']) buttons.get(id)?.dispatchEvent(event('pointerdown', { pointerId: 7 }));
  buttons.get('fire-button').dispatchEvent(event('pointercancel', { pointerId: 7 }));
  for (const key of ['fire', 'firePressed', 'throwPressed', 'knifePressed', 'grenadePickerPressed']) assert.equal(input.read()[key], false, key);
  buttons.get('throw-button')?.dispatchEvent(event('pointerdown', { pointerId: 8 }));
  document.hidden = true; document.dispatchEvent(event('visibilitychange')); assert.equal(input.read().throwPressed, false);
});
test('cancelling the movement pointer also clears attacks and a queued throw', t => {
  const { input, buttons, restore } = createInputFixture(); t.after(restore); input.setEnabled(true);
  buttons.get('joystick').dispatchEvent(event('pointerdown', { pointerId: 1, clientX: 80, clientY: 50 }));
  buttons.get('fire-button').dispatchEvent(event('pointerdown', { pointerId: 2 }));
  buttons.get('throw-button').dispatchEvent(event('pointerdown', { pointerId: 3 }));
  buttons.get('joystick').dispatchEvent(event('pointercancel', { pointerId: 1 }));
  const read = input.read(); assert.equal(read.fire, false); assert.equal(read.throwPressed, false); assert.equal(read.x, 0);
});
test('real solo input toggles only an owned knife and throws once with attack suppression', t => {
  const game = createHeadlessGame(); t.after(() => cleanupGame(game)); game.start('m4a1', { bots: 1, difficulty: 'easy' });
  game.input.knifePressed = true; game.simulateStep(.01); assert.equal(game.player.equipment.heldItem, 'gun');
  game.player.equipment.knife = true; game.input.knifePressed = true; game.simulateStep(.01); assert.equal(game.player.equipment.heldItem, 'knife');
  game.input.knifePressed = true; game.simulateStep(.01); assert.equal(game.player.equipment.heldItem, 'gun');
  game.player.protected = 0; game.player.equipment.grenades.frag = 2; game.input.throwPressed = true; game.input.fire = true;
  const ammo = game.weaponState.ammo; game.simulateStep(.01); game.simulateStep(.01);
  assert.equal(game.player.equipment.grenades.frag, 1); assert.equal(game.weaponState.ammo, ammo); assert.equal(game.player.equipment.activeGunId, 'm4a1');
});
test('T opens the solo picker without spending or attacking in the paused frame', t => {
  const game = createHeadlessGame(); t.after(() => cleanupGame(game)); game.start('m4a1', { bots: 1 });
  game.player.equipment.grenades.frag = 1; game.events.onEquipmentPicker = () => game.pause();
  game.input.grenadePickerPressed = true; game.input.throwPressed = true; game.input.fire = true; const ammo = game.weaponState.ammo;
  game.simulateStep(.01); assert.equal(game.active, false); assert.equal(game.weaponState.ammo, ammo); assert.equal(game.player.equipment.grenades.frag, 1);
});
test('opening the picker pauses all remaining solo simulation substeps', t => {
  const game = createHeadlessGame(); t.after(() => cleanupGame(game)); game.start('m4a1', { bots: 1 });
  game.events.onEquipmentPicker = () => game.pause(); game.input.grenadePickerPressed = true;
  const time = game.simulationTime; game.simulate(.12); assert.equal(game.simulationTime, time);
});

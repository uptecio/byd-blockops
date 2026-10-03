import test from 'node:test';
import assert from 'node:assert/strict';
import { createInputFixture } from './helpers/input-fixture.js';
import { createHeadlessGame, cleanupGame } from './helpers/game-fixture.js';
import { OnlineArena } from '../src/online-game.js';
import { RoomClient } from '../src/network.js';
import { RoomManager } from '../server/rooms.js';

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

function onlineThrowFixture(t) {
  const game = createHeadlessGame(), manager = new RoomManager({ random: () => .5 });
  const room = manager.create('p1', 'Host', 'm4a1'); manager.join('p2', room.code, 'Guest', 'm4a1'); manager.start('p1');
  const player = room.players.get('p1'); Object.assign(player, { x: 0, y: 0, z: 19, yaw: 0, pitch: 0 }); player.equipment.grenades.frag = 2;
  const snapshot = manager.snapshot(room, false); snapshot.selfEquipment = manager.equipmentSnapshot('p1');
  const packets = [], results = [], client = new RoomClient(); Object.assign(client, { id: 'p1', connected: true, room: snapshot });
  const receive = text => {
    const packet = JSON.parse(text); packets.push(packet);
    if (packet.type === 'input') manager.input('p1', packet);
    else if (packet.type === 'equipment-action') results.push(manager.equipmentAction('p1', packet));
  };
  client.socket = { readyState: 1, send: receive }; const messages = [];
  const arena = new OnlineArena(game, client, { onToast: message => messages.push(message) }); arena.start(snapshot, 'p1', { sensitivity: 1 });
  t.after(() => { arena.stop(); cleanupGame(game); });
  return { game, arena, client, room, player, packets, results, messages, receive };
}

for (const [label, dt, sendTimer] of [['at the normal input interval', .05, 0], ['between normal input intervals', .01, .04]]) {
  test(`online drag and throw launches with current aim ${label}`, t => {
    const { game, arena, room, packets, results } = onlineThrowFixture(t); arena.sendTimer = sendTimer;
    game.input.look.x = 604.1524333826525; game.input.look.y = -96.15384615384616;
    game.input.throwPressed = game.input.firePressed = game.input.jump = game.input.reload = true;
    arena.update(dt);
    assert.equal(room.gearCombatState.projectiles.length, 1);
    const projectile = room.gearCombatState.projectiles[0];
    assert.ok(Math.abs(projectile.vx - 11.626949060527737) < 1e-8, `expected current +X aim, got vx=${projectile.vx}`);
    assert.ok(Math.abs(projectile.vz) < 1e-8, `old forward aim leaked into vz=${projectile.vz}`);
    assert.ok(Math.abs(projectile.vy - 5.968847511054276) < 1e-8, `expected current upward aim, got vy=${projectile.vy}`);
    assert.deepEqual(packets.map(packet => packet.type), ['input', 'equipment-action']); assert.deepEqual(results, [{ ok: true }]);
    for (const edge of ['firePressed', 'jump', 'reload']) { assert.equal(packets[0][edge], true); assert.equal(arena.pending[edge], false); }
    arena.update(.05); assert.equal(room.gearCombatState.projectiles.length, 1);
    for (const edge of ['firePressed', 'jump', 'reload']) assert.equal(packets.at(-1)[edge], false);
  });
}

test('failed online throw aim send spends no grenade and retains other one-shot edges until sent', t => {
  const { game, arena, client, room, player, packets, messages, receive } = onlineThrowFixture(t); arena.sendTimer = .04;
  client.socket.send = text => { if (JSON.parse(text).type === 'input') throw new Error('transport unavailable'); receive(text); };
  game.input.look.x = 604.1524333826525; game.input.throwPressed = game.input.firePressed = game.input.jump = game.input.reload = true;
  arena.update(.01);
  assert.equal(room.gearCombatState.projectiles.length, 0); assert.equal(player.equipment.grenades.frag, 2);
  assert.equal(packets.some(packet => packet.type === 'equipment-action'), false);
  for (const edge of ['firePressed', 'jump', 'reload']) assert.equal(arena.pending[edge], true);
  assert.equal(messages.at(-1), 'Unable to send throw aim');
  client.socket.send = receive; arena.update(.05);
  for (const edge of ['firePressed', 'jump', 'reload']) { assert.equal(packets.at(-1)[edge], true); assert.equal(arena.pending[edge], false); }
  assert.equal(room.gearCombatState.projectiles.length, 0, 'failed throw is not replayed without another press');
});

import test from 'node:test';
import { PROTOCOL_VERSION } from '../src/protocol.js';
import assert from 'node:assert/strict';
import { createHeadlessGame, cleanupGame } from './helpers/game-fixture.js';
import { createInputFixture, InputElement } from './helpers/input-fixture.js';
import { EquipmentUI } from '../src/equipment-ui.js';
import { MultiplayerUI } from '../src/multiplayer-ui.js';
import { RoomClient } from '../src/network.js';
import { OnlineArena } from '../src/online-game.js';
import { chooseBotIntent } from '../src/bot-brain.js';
import { createEquipment, equipmentDTO, equipmentFromDTO, equipGun, pickupEquipment } from '../src/equipment.js';
import { validEquipmentAction, validGearEvent, validGearWorld } from '../src/gear-protocol.js';
import { RoomManager } from '../server/rooms.js';

function unavailable(t, object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  Object.defineProperty(object, key, { configurable: true, writable: true, value: undefined });
  t.after(() => descriptor ? Object.defineProperty(object, key, descriptor) : delete object[key]);
}
const nullPrototype = value => Object.assign(Object.create(null), value);

function arena(t) {
  const game = createHeadlessGame();
  t.after(() => cleanupGame(game));
  return game;
}
function roomFixture() {
  const manager = new RoomManager({ random: () => .5 });
  const state = manager.create('self', 'Host', 'm4a1');
  manager.join('other', state.code, 'Guest', 'ak47'); manager.start('self');
  const snapshot = () => ({ ...manager.snapshot(state), selfEquipment: manager.equipmentSnapshot('self') });
  return { manager, state, snapshot };
}

test('Solo first update advances bots and the match without Object.hasOwn', t => {
  unavailable(t, Object, 'hasOwn');
  const game = arena(t); game.start('m4a1', { bots: 1 });
  const remaining = game.modeState.timeLeft;
  game.update(.02);
  assert.ok(game.bots[0].intent.goal, 'The first live bot chooses its movement goal');
  assert.ok(game.modeState.timeLeft < remaining, 'The first simulation step reaches the match clock');
  assert.equal(game.player.equipment.owned.get('m4a1').ammo, 30);
  assert.equal(game.gearView.loot.size, 20);
});

test('Solo HUD refresh replaces equipment lists without Element.replaceChildren', t => {
  const dom = createInputFixture(); t.after(dom.restore);
  unavailable(t, InputElement.prototype, 'replaceChildren');
  const game = arena(t); game.start('m4a1', { bots: 1 });
  const ui = new EquipmentUI({ getView: () => ({ ...game.getEquipmentView(), lifeId: game.player.lifeId, roundId: game.modeState }),
    onAction: action => game.requestEquipment(action), onPicker() {}, onToast() {} });
  game.events.onHud = () => ui.render();
  game.update(.02);
  assert.deepEqual(dom.buttons.get('grenade-options').children.map(button => button.textContent), ['Explosive · 0', 'Smoke · 0', 'Flash · 0']);
  assert.deepEqual(dom.buttons.get('carried-guns').children.map(button => button.dataset.carriedWeapon), ['m4a1']);
  assert.equal(game.requestEquipment({ kind: 'equip-gun', weaponId: 'mp5', source: 'armory' }).ok, true);
  game.player.equipment.grenades.smoke = 1;
  game.update(.1);
  assert.deepEqual(dom.buttons.get('carried-guns').children.map(button => button.dataset.carriedWeapon), ['mp5']);
  assert.deepEqual(dom.buttons.get('grenade-options').children.map(button => button.textContent), ['Explosive · 0', 'Smoke · 1', 'Flash · 0']);
  ui.openPicker(); assert.equal(document.activeElement.dataset.grenadeType, 'smoke');
});

test('online roster refresh removes obsolete players without Element.replaceChildren', t => {
  const dom = createInputFixture(); t.after(dom.restore);
  unavailable(t, InputElement.prototype, 'replaceChildren');
  const { snapshot } = roomFixture(), room = snapshot();
  const ui = Object.assign(Object.create(MultiplayerUI.prototype), { room, client: { id: 'self' } });
  ui.renderRoom();
  assert.deepEqual(dom.buttons.get('room-roster').children.map(row => row.children[0].textContent), ['Host (YOU)', 'Guest']);
  room.players = room.players.slice(0, 1); room.players[0].kills = 2;
  ui.renderRoom();
  assert.deepEqual(dom.buttons.get('room-roster').children.map(row => row.children[0].textContent), ['Host (YOU)']);
  assert.deepEqual(dom.buttons.get('online-scoreboard').children.map(row => row.children[1].textContent), ['2 / 0']);
});

test('equipment validation supports null prototypes and rejects forged keys without Object.hasOwn', t => {
  unavailable(t, Object, 'hasOwn');
  const dto = equipmentDTO(createEquipment('m4a1'));
  dto.grenades = nullPrototype(dto.grenades); dto.owned = dto.owned.map(nullPrototype);
  const equipment = equipmentFromDTO(nullPrototype(dto));
  assert.equal(equipment.owned.get('m4a1').ammo, 30);
  assert.equal(equipGun(equipment, 'mp5', nullPrototype({ source: 'armory' })).ok, true);
  assert.equal(pickupEquipment(equipment, nullPrototype({ kind: 'knife' })).ok, true);
  for (const invalid of [
    { ...dto, hasOwnProperty: () => true },
    { ...dto, [Symbol('extra')]: true },
    Object.assign(Object.create({ startingGunId: 'm4a1' }), { ...dto }),
    { ...dto, grenades: { frag: 4, smoke: 0, flash: 0 } },
  ]) assert.throws(() => equipmentFromDTO(invalid), /Invalid equipment DTO/);
  assert.equal(pickupEquipment(equipment, { kind: 'grenade', grenadeType: 'frag', hasOwnProperty: () => true }).ok, false);
  assert.equal(equipment.grenades.frag, 0);
});

test('Solo action dispatch keeps exact own keys without Object.hasOwn', t => {
  unavailable(t, Object, 'hasOwn');
  const game = arena(t); game.start('m4a1', { bots: 0 });
  assert.equal(game.requestEquipment(nullPrototype({ kind: 'equip-gun', weaponId: 'mp5', source: 'armory' })).ok, true);
  const before = game.getEquipmentView();
  const inheritedKind = Object.assign(Object.create({ kind: 'equip-gun' }), { weaponId: 'awp', source: 'armory', extra: true });
  for (const action of [inheritedKind, { kind: '__proto__' }, { kind: 'toString' },
    { kind: 'equip-gun', weaponId: 'awp', source: 'armory', hasOwnProperty: () => true },
    { kind: 'throw', grenadeType: 'frag', [Symbol('extra')]: true }]) {
    assert.equal(game.requestEquipment(action).ok, false);
    assert.deepEqual(game.getEquipmentView(), before);
  }
});

test('bot membership ignores inherited and shadowed stats without Object.hasOwn', t => {
  unavailable(t, Object, 'hasOwn');
  const actor = { id: 'ghost', alive: true, x: 0, z: 0, teamId: null };
  const target = { id: 'local', alive: true, x: 1, z: 1, teamId: null, protectedRemaining: 0 };
  const stats = Object.assign(Object.create({ ghost: { teamId: null } }), { local: { teamId: null }, hasOwnProperty: () => true });
  const context = { actors: [actor, target], state: { ended: false, modeId: 'ffa', stats }, map: { solids: [] } };
  assert.deepEqual(chooseBotIntent(actor, context), { goal: null, targetId: null });
});

test('protocol 4 action and event validation retains exact shapes without Object.hasOwn', t => {
  unavailable(t, Object, 'hasOwn');
  const action = { type: 'equipment-action', seq: 1, lifeId: 1, kind: 'equip-gun', weaponId: 'mp5', source: 'armory' };
  assert.equal(validEquipmentAction(nullPrototype(action)), true);
  for (const invalid of [{ ...action, kind: '__proto__' }, { ...action, kind: 'toString' },
    { ...action, hasOwnProperty: () => true }, { ...action, [Symbol('extra')]: true },
    Object.assign(Object.create({ kind: 'equip-gun' }), action), { ...action, seq: 0 }]) assert.equal(validEquipmentAction(invalid), false);
  const event = { id: 1, type: 'pickup', playerId: 'self', itemId: 'drop:1', item: nullPrototype({ kind: 'grenade', grenadeType: 'frag' }) };
  assert.equal(validGearEvent(nullPrototype(event)), true);
  assert.equal(validGearEvent({ ...event, type: 'toString' }), false);
  assert.equal(validGearEvent({ ...event, item: { ...event.item, hasOwnProperty: () => true } }), false);
});

test('online snapshots are deeply detached without structuredClone', t => {
  const game = arena(t), { snapshot } = roomFixture(), room = snapshot();
  room.gear.projectiles.push({ id: 'projectile:1', grenadeType: 'frag', ownerId: 'self', ownerTeamId: null, ownerLifeId: 1, x: 0, y: 1, z: 0, vx: 1, vy: 0, vz: 0, fuseRemaining: 1 });
  room.gear.smokes.push({ id: 'smoke:1', ownerId: 'self', x: 0, y: 1, z: 0, radius: 4, remaining: 8 });
  assert.equal(validGearWorld(room.gear), true);
  const expected = JSON.parse(JSON.stringify(room.gear));
  unavailable(t, globalThis, 'structuredClone');
  const online = new OnlineArena(game, { send: () => true }); t.after(() => online.stop());
  online.start(room, 'self', {});
  assert.deepEqual(game.gearWorld, expected);
  room.gear.loot[0].item.kind = 'knife'; room.gear.loot[0].x = 123;
  room.gear.projectiles[0].x = 123; room.gear.smokes[0].remaining = 1;
  room.gear.loot.pop(); room.gear.projectiles.push({}); room.gear.smokes.pop();
  assert.deepEqual(game.gearWorld, expected, 'Neither nested item nor array/record mutations can alter the rendered snapshot');
  game.gearWorld.projectiles[0].y = 9; assert.equal(room.gear.projectiles[0].y, 1);
  room.gear = { loot: [], projectiles: [], smokes: [] }; online.sync(room);
  assert.equal(game.gearView.loot.size + game.gearView.projectiles.size + game.gearView.smokes.size, 0);
});

test('online receipt and equipment acknowledgement work with all three newer APIs absent', async t => {
  // The Node server retains its own capabilities; prepare its wire snapshots before limiting the client environment.
  const { manager, state } = roomFixture(), game = arena(t), errors = [];
  const packet = type => ({ type, protocol: PROTOCOL_VERSION, ...(type === 'welcome' ? { id: 'self' } : {}), room: manager.snapshot(state), equipment: manager.equipmentSnapshot('self') });
  const welcome = packet('welcome');
  const expectedAction = { type: 'equipment-action', seq: 1, lifeId: 2, kind: 'equip-gun', weaponId: 'mp5', source: 'armory' };
  assert.equal(manager.equipmentAction('self', expectedAction).ok, true);
  const acknowledgement = packet('state');
  unavailable(t, Object, 'hasOwn'); unavailable(t, globalThis, 'structuredClone');
  const dom = createInputFixture(); t.after(dom.restore);
  unavailable(t, InputElement.prototype, 'replaceChildren');
  // Replace only the transport: packets still pass through RoomClient validation and OnlineArena.
  class Socket {
    constructor() { this.listeners = new Map(); this.readyState = 1; this.sent = []; }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    emit(type, packet) { this.listeners.get(type)?.({ data: JSON.stringify(packet) }); }
    send(text) { this.sent.push(JSON.parse(text)); }
    close() { this.readyState = 3; this.emit('close'); }
  }
  const previousSocket = globalThis.WebSocket;
  globalThis.WebSocket = Socket; t.after(() => { globalThis.WebSocket = previousSocket; });
  let online;
  const client = new RoomClient({ onError: error => errors.push(error), onRoom: room => {
    if (online.running) online.sync(room); else online.start(room, client.id, {});
  } });
  online = new OnlineArena(game, client); t.after(() => { online.stop(); client.close(); });
  const pending = client.connect('http://localhost:4180', { type: 'create', name: 'Host', weaponId: 'm4a1' });
  pending.catch(() => {});
  const socket = client.socket;
  socket.emit('open'); socket.emit('message', welcome); await pending;
  const ui = new EquipmentUI({ getView: () => ({ ...game.getEquipmentView(), lifeId: game.player.lifeId, roundId: state }),
    onAction: action => online.requestEquipment(action), onPicker() {}, onToast() {} });
  game.events.onHud = () => ui.render(); online.update(.02);
  assert.equal(dom.buttons.get('carried-guns').children[0].dataset.carriedWeapon, 'm4a1');
  assert.equal(online.requestEquipment(nullPrototype({ kind: 'equip-gun', weaponId: 'mp5', source: 'armory' })).ok, true);
  assert.equal(game.weapon.id, 'm4a1', 'Sending an action cannot grant the gun before authoritative receipt');
  const action = socket.sent.find(message => message.type === 'equipment-action');
  assert.deepEqual(action, expectedAction);
  socket.emit('message', acknowledgement); online.update(.1);
  assert.equal(game.weapon.id, 'mp5');
  assert.deepEqual(dom.buttons.get('carried-guns').children.map(button => button.dataset.carriedWeapon), ['mp5']);
  const accepted = client.room, invalid = JSON.parse(JSON.stringify(acknowledgement)); invalid.equipment.equipment.grenades.frag = 4;
  socket.emit('message', invalid); assert.equal(client.room, accepted); assert.equal(errors.length, 1);
  const before = socket.sent.length;
  for (const forged of [{ type: 'equipment-action' }, { seq: 2 }, { lifeId: 1 }, { hasOwnProperty: () => true }]) {
    assert.equal(client.sendEquipmentAction({ kind: 'equip-gun', weaponId: 'awp', source: 'armory', ...forged }), false);
  }
  assert.equal(socket.sent.length, before); assert.equal(client.actionSeq, 1);
});

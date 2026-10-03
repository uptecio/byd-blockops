import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiplayerUI } from '../src/multiplayer-ui.js';
import { RoomManager } from '../server/rooms.js';
import { createHeadlessGame, cleanupGame } from './helpers/game-fixture.js';

class Element extends EventTarget {
  constructor() { super(); this.value = ''; this.hidden = false; this.dataset = {}; this.children = []; this.classList = { toggle() {} }; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  getContext() { return null; }
}
function fixture(t, initialMode = 'lobby') {
  const previous = Object.fromEntries(['document', 'location', 'localStorage'].map(key => [key, globalThis[key]]));
  const elements = new Map(), body = { dataset: { mode: initialMode } };
  globalThis.document = { body, getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); }, createElement() { return new Element(); } };
  globalThis.location = { hostname: 'localhost', origin: 'http://localhost:4180', search: '' };
  globalThis.localStorage = { getItem() { return null; }, setItem() {} };
  document.getElementById('settings-screen').hidden = true;
  const game = createHeadlessGame(); game.audio.unlock = () => {};
  const manager = new RoomManager({ random: () => .5 });
  const state = manager.create('p1', 'Host', 'm4a1'); manager.join('p2', state.code, 'Guest', 'm4a1');
  const messages = [], sent = [], modes = [];
  const ui = new MultiplayerUI({ getGame: () => game, getSettings: () => ({ sensitivity: 1 }),
    getSelected: () => ({ id: 'mp5' }), getSelection: () => ({ weaponId: 'mp5', skinId: 'ranger' }),
    onSkin() {}, onConfiguration() {}, onRoomSettings() {}, onHome() {}, onLoadout() {},
    onMode(mode) { modes.push(mode); body.dataset.mode = mode; if (mode !== 'playing') ui.pause(); },
    onToast(message) { messages.push(message); document.getElementById('toast').textContent = message; },
  });
  ui.client.id = 'p2'; ui.client.connected = true;
  ui.client.socket = { readyState: 1, send(text) { sent.push(JSON.parse(text)); } };
  function receive() {
    const snapshot = manager.snapshot(state, false); snapshot.selfEquipment = manager.equipmentSnapshot('p2');
    ui.client.room = snapshot; ui.receive(snapshot); return snapshot;
  }
  t.after(() => { ui.arena?.stop(); cleanupGame(game); for (const key of Object.keys(previous)) if (previous[key] === undefined) delete globalThis[key]; else globalThis[key] = previous[key]; });
  return { ui, game, manager, state, sent, messages, modes, receive, body, elements };
}

test('returning from an unchanged menu never requests the previewed gun or removes the original', t => {
  const { ui, game, manager, sent, receive } = fixture(t);
  manager.start('p1'); receive(); ui.pause(); sent.length = 0;
  ui.deploy();
  assert.equal(ui.arena.suspended, false);
  assert.equal(sent.some(packet => packet.type === 'equip' || packet.type === 'equipment-action'), false);
  assert.deepEqual(game.getEquipmentView().owned.map(gun => gun.weaponId), ['m4a1']);
});

test('a remote start keeps an open Armory suspended and plain guest resume preserves its starter', t => {
  const { ui, game, manager, sent, receive, body, modes } = fixture(t);
  receive(); body.dataset.mode = 'armory'; manager.start('p1'); receive();
  assert.equal(body.dataset.mode, 'armory'); assert.equal(ui.arena.suspended, true); assert.equal(game.input.enabled, false);
  assert.equal(modes.includes('playing'), false); assert.equal(sent.at(-1).fire, false);
  sent.length = 0; ui.deploy();
  assert.equal(ui.arena.suspended, false); assert.equal(body.dataset.mode, 'playing');
  assert.equal(sent.some(packet => packet.type === 'equipment-action'), false);
  assert.deepEqual(game.getEquipmentView().owned.map(gun => gun.weaponId), ['m4a1']);
});

test('explicit equip returns only after its authoritative acknowledgement without premature resume', t => {
  const { ui, game, manager, sent, receive, body } = fixture(t);
  manager.start('p1'); receive(); ui.pause(); body.dataset.mode = 'armory';
  ui.deploy({ equipWeaponId: 'mp5', source: 'armory' });
  assert.equal(ui.arena.suspended, true); assert.equal(body.dataset.mode, 'armory'); assert.equal(game.weapon.id, 'm4a1');
  const action = sent.findLast(packet => packet.type === 'equipment-action');
  assert.equal(action.weaponId, 'mp5'); assert.equal(action.lifeId, manager.equipmentSnapshot('p2').lifeId);
  receive(); assert.equal(ui.arena.suspended, true, 'an unrelated snapshot cannot resume');
  assert.equal(manager.equipmentAction('p2', action).ok, true); receive();
  assert.equal(ui.arena.suspended, false); assert.equal(body.dataset.mode, 'playing'); assert.equal(game.weapon.id, 'mp5');
});

test('stale equip acknowledgement after respawn cannot resume or remove the next life starter', t => {
  const { ui, game, manager, state, sent, receive, body } = fixture(t);
  manager.start('p1'); receive(); ui.pause(); body.dataset.mode = 'armory';
  ui.deploy({ equipWeaponId: 'mp5' });
  const action = sent.findLast(packet => packet.type === 'equipment-action');
  manager.eliminate(state, state.players.get('p1'), state.players.get('p2')); manager.tick(3.1); receive();
  assert.equal(manager.equipmentAction('p2', action).ok, false); receive();
  assert.equal(ui.arena.suspended, true); assert.equal(body.dataset.mode, 'armory');
  assert.deepEqual(game.getEquipmentView().owned.map(gun => gun.weaponId), ['m4a1']);
});

test('denied actions show an in-game toast and keep explicit equip returns suspended', t => {
  const { ui, manager, receive, messages, elements, body } = fixture(t);
  manager.start('p1'); receive(); ui.pause(); body.dataset.mode = 'armory';
  ui.deploy({ equipWeaponId: 'mp5' }); ui.client.onError('Find this gun as loot'); receive();
  assert.deepEqual(messages, ['Find this gun as loot']);
  assert.equal(elements.get('toast').textContent, 'Find this gun as loot'); assert.equal(ui.arena.suspended, true);
});

test('lobby selections use loadout messages and never active equipment actions', t => {
  const { ui, sent, receive, manager } = fixture(t); receive();
  assert.equal(ui.setLoadout('mp5'), true);
  assert.deepEqual(sent.at(-1), { type: 'loadout', weaponId: 'mp5' });
  manager.start('p1'); receive(); const before = sent.length;
  assert.equal(ui.setLoadout('awp'), false); assert.equal(sent.length, before);
});

test('a remote start while lobby settings are open keeps that overlay and controls suspended', t => {
  const { ui, game, manager, receive, body, modes } = fixture(t); receive();
  document.getElementById('settings-screen').hidden = false;
  manager.start('p1'); receive();
  assert.equal(body.dataset.mode, 'lobby'); assert.equal(modes.includes('playing'), false);
  assert.equal(document.getElementById('settings-screen').hidden, false);
  assert.equal(ui.arena.suspended, true); assert.equal(game.input.enabled, false);
});

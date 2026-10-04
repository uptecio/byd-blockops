import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiplayerUI } from '../src/multiplayer-ui.js';
import { RoomManager } from '../server/rooms.js';
import { createHeadlessGame, cleanupGame } from './helpers/game-fixture.js';
import { createInputFixture } from './helpers/input-fixture.js';

class Element extends EventTarget {
  constructor() { super(); this.value = ''; this.hidden = false; this.dataset = {}; this.children = []; this.classList = { toggle() {} }; }
  append(...items) { this.children.push(...items); }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text || ''; }
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

test('accepted equip followed by death before acknowledgement keeps Armory suspended', t => {
  const { ui, game, manager, state, sent, receive, body } = fixture(t);
  manager.start('p1'); receive(); ui.pause(); body.dataset.mode = 'armory';
  ui.deploy({ equipWeaponId: 'mp5' });
  const action = sent.findLast(packet => packet.type === 'equipment-action');
  assert.equal(manager.equipmentAction('p2', action).ok, true);
  manager.eliminate(state, state.players.get('p1'), state.players.get('p2'));
  const snapshot = receive();
  assert.equal(snapshot.selfEquipment.lifeId, action.lifeId, 'death retains the accepted action life');
  assert.equal(snapshot.selfEquipment.lastActionSeq, action.seq);
  assert.equal(snapshot.selfEquipment.equipment.activeGunId, 'mp5', 'dead equipment remembers the accepted gun');
  assert.deepEqual(snapshot.selfEquipment.equipment.owned, []);
  assert.equal(body.dataset.mode, 'armory'); assert.equal(ui.arena.suspended, true); assert.equal(game.input.enabled, false);
  assert.equal(ui.pendingDeployment, null, 'death cancels the return intent');
  receive(); assert.equal(body.dataset.mode, 'armory');
  manager.tick(3.1); receive();
  assert.equal(body.dataset.mode, 'armory'); assert.equal(ui.arena.suspended, true);
  assert.equal(game.getEquipmentView().activeGunId, 'm4a1');
  assert.equal(game.getEquipmentView().startingGunRemoved, false);
  assert.equal(game.getEquipmentView().owned.some(gun => gun.weaponId === 'm4a1'), true);
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
test('remote-start lifecycle reconciliation can close background overlays while keeping controls suspended', t => {
  const { ui, game, manager, receive, body, modes } = fixture(t, 'armory'); receive();
  document.getElementById('settings-screen').hidden = false;
  ui.onRemoteStart = () => {
    document.getElementById('settings-screen').hidden = true;
    body.dataset.mode = 'paused'; ui.pause();
  };
  manager.start('p1'); receive();
  assert.equal(body.dataset.mode, 'paused');
  assert.equal(document.getElementById('settings-screen').hidden, true);
  assert.equal(ui.arena.suspended, true); assert.equal(game.input.enabled, false);
  assert.equal(modes.includes('playing'), false);
  receive(); assert.equal(ui.arena.suspended, true, 'later snapshots cannot grant Resume');
  ui.deploy(); assert.equal(ui.arena.suspended, false, 'explicit return restores controls');
});
test('a remote round start replaces an obsolete Home confirmation instead of retaining it as a menu', t => {
  const { ui, game, manager, receive, body } = fixture(t, 'confirm-home'); receive();
  manager.start('p1'); receive();
  assert.equal(body.dataset.mode, 'playing');
  assert.equal(ui.arena.suspended, false); assert.equal(game.input.enabled, true);
});
test('real online input queues knife and one throw, while T immediately sends neutral controls', t => {
  const { ui, game, manager, receive, sent } = fixture(t); manager.start('p1'); receive(); sent.length = 0;
  game.input.knifePressed = true; game.input.throwPressed = true; game.input.firePressed = true;
  ui.update(.05);
  assert.deepEqual(sent.filter(packet => packet.type === 'equipment-action').map(packet => packet.kind), ['held-item', 'throw']);
  assert.equal(sent.findLast(packet => packet.type === 'input').firePressed, true, 'equipment edges do not drain fire');
  assert.equal(game.player.equipment.heldItem, 'gun', 'queued actions cannot grant local knife');
  ui.update(.05); assert.equal(sent.filter(packet => packet.kind === 'throw').length, 1);
  sent.length = 0; game.events.onEquipmentPicker = () => ui.pause();
  game.input.grenadePickerPressed = game.input.throwPressed = game.input.fire = true; ui.update(.05);
  assert.equal(ui.arena.suspended, true); assert.equal(sent.some(packet => packet.type === 'equipment-action'), false);
  assert.equal(sent.filter(packet => packet.type === 'input').every(packet => !packet.fire && !packet.firePressed && !packet.reload && !packet.jump), true);
});

async function equipmentFixture(t) {
  const dom = createInputFixture(); t.after(dom.restore);
  const game = createHeadlessGame(); t.after(() => cleanupGame(game)); game.start('m4a1', { bots: 1 }); game.pause();
  const { EquipmentUI } = await import('../src/equipment-ui.js');
  const messages = [];
  const ui = new EquipmentUI({ getView: () => ({ ...game.getEquipmentView(), lifeId: game.player.lifeId, roundId: game.modeState, alive: game.player.health > 0 }),
    onAction: action => game.requestEquipment(action), onPicker: () => { game.pause(); dom.input.clear(); }, onToast: message => messages.push(message) });
  return { ...dom, game, ui, messages };
}
test('preview then cancellation and plain Return to Match never equip a gun', async t => {
  const { game, ui } = await equipmentFixture(t);
  ui.previewGun('mp5', 'armory'); ui.close(); assert.equal(ui.confirmGun(), null);
  assert.equal(game.player.equipment.activeGunId, 'm4a1'); assert.equal(game.player.equipment.startingGunRemoved, false);
});
test('confirming an owned gun preserves ammunition and removed original shows loot denial', async t => {
  const { game, ui, messages, buttons } = await equipmentFixture(t);
  game.requestEquipment({ kind: 'equip-gun', weaponId: 'mp5', source: 'armory' }); game.weaponState.ammo = 7; game.weaponState.reserve = 12;
  ui.previewGun('awp', 'armory'); assert.equal(ui.confirmGun().ok, true);
  ui.previewGun('mp5', 'carried'); assert.equal(ui.confirmGun().ok, true); assert.equal(game.weaponState.ammo, 7); assert.equal(game.weaponState.reserve, 12);
  ui.previewGun('m4a1', 'armory'); ui.render(); assert.equal(buttons.get('equipment-selection-status').textContent, 'Find this gun as loot');
  assert.equal(ui.confirmGun().ok, false); assert.equal(messages.at(-1), 'Find this gun as loot'); assert.equal(game.player.equipment.activeGunId, 'mp5');
});
test('Armory gun cards explain unavailable original and owned ammunition directly on touch', async t => {
  const { game, ui } = await equipmentFixture(t);
  game.requestEquipment({ kind: 'equip-gun', weaponId: 'mp5', source: 'armory' }); game.weaponState.ammo = 7; game.weaponState.reserve = 12;
  const original = document.getElementById('original-card'); original.dataset.weapon = 'm4a1';
  const carried = document.getElementById('owned-card'); carried.dataset.weapon = 'mp5'; ui.render();
  assert.equal(original.querySelector('.weapon-type').textContent, 'Find this gun as loot');
  assert.equal(carried.querySelector('.weapon-type').textContent, 'CARRIED · 7 / 12');
});
test('a changed life or round discards pending preview before confirmation', async t => {
  const { game, ui } = await equipmentFixture(t); ui.previewGun('mp5', 'armory'); game.resetPlayer();
  assert.equal(ui.confirmGun(), null); assert.equal(game.player.equipment.activeGunId, 'm4a1');
  ui.previewGun('awp', 'armory'); game.start('m4a1', { bots: 1 }); assert.equal(ui.confirmGun(), null);
});
test('grenade picker clears combat, selects without throwing and requires explicit resume', async t => {
  const { game, ui, input, buttons } = await equipmentFixture(t); game.player.equipment.grenades.smoke = 1;
  input.fire = input.throwPressed = true; ui.openPicker(); assert.equal(input.read().fire, false); assert.equal(buttons.get('grenade-picker').hidden, false);
  assert.equal(ui.selectType('smoke').ok, true); assert.equal(game.player.equipment.selectedGrenade, 'smoke'); assert.equal(game.player.equipment.grenades.smoke, 1);
  assert.equal(game.active, false); ui.close(); assert.equal(buttons.get('grenade-picker').hidden, true);
});
test('an empty grenade picker focuses its enabled Return button', async t => {
  const { ui } = await equipmentFixture(t); const resume = document.getElementById('grenade-picker-resume'); ui.openPicker();
  assert.equal(document.activeElement, resume);
});

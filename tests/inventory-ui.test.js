import test from 'node:test';
import assert from 'node:assert/strict';
import { EquipmentUI } from '../src/equipment-ui.js';
import { pickupEquipment } from '../src/equipment.js';
import { OnlineArena } from '../src/online-game.js';
import { RoomClient } from '../src/network.js';
import { RoomManager } from '../server/rooms.js';
import { createHeadlessGame, cleanupGame } from './helpers/game-fixture.js';
import { createInventoryDOM } from './helpers/inventory-dom-fixture.js';

function fixture(t, options = {}) {
  const dom = createInventoryDOM(t), game = createHeadlessGame();
  game.start('m4a1', { bots: 0 }); t.after(() => cleanupGame(game));
  const messages = [], picker = [], actions = [];
  const getView = () => ({ ...game.getEquipmentView(), alive: game.player.health > 0 && game.player.dead <= 0,
    lifeId: game.player.lifeId, roundId: game.hasRound && !game.match.ended ? game.modeState : null });
  const ui = new EquipmentUI({ getView, onAction(action) { actions.push(action); return game.requestEquipment(action); },
    onToast: message => messages.push(message), onPicker: visible => picker.push(visible),
    canSelectInventory: () => game.input.enabled, ...options });
  const collect = item => { assert.equal(pickupEquipment(game.player.equipment, item).ok, true); ui.render(); };
  return { ...dom, game, ui, getView, messages, picker, actions, collect };
}

// Catches showing unowned/zero-count equipment or grouping away the numbered inventory.
test('inventory contains owned guns, knife and positive grenades in one numbered order', t => {
  const { ui, game, collect, slots } = fixture(t); ui.render();
  collect({ kind: 'gun', weaponId: 'mp5', ammo: 7, reserve: 12 });
  collect({ kind: 'knife' }); collect({ kind: 'grenade', grenadeType: 'smoke' });
  collect({ kind: 'grenade', grenadeType: 'frag' }); collect({ kind: 'grenade', grenadeType: 'smoke' });
  assert.deepEqual(slots.children.map(button => button.dataset.inventoryKey), ['gun:m4a1', 'gun:mp5', 'knife', 'grenade:frag', 'grenade:smoke']);
  assert.deepEqual(slots.children.map(button => button.querySelector('.inventory-number').textContent), ['1', '2', '3', '4', '5']);
  assert.deepEqual(slots.children.map(button => button.querySelector('.inventory-name').textContent), ['M4A1', 'MP5', 'Knife', 'Explosive', 'Smoke']);
  assert.deepEqual(slots.children.map(button => button.querySelector('.inventory-count').textContent), ['30 / 470', '7 / 12', 'x1', 'x1', 'x2']);
  assert.equal(game.player.equipment.activeGunId, 'm4a1', 'pickup never equips the collected gun');
});

// Catches using armory acquisition, automatic starter removal on pickup, or refilling an owned gun.
test('a collected gun equips immediately from inventory and preserves its ammunition on return', t => {
  const { ui, game, collect, tap, slot, actions, picker } = fixture(t); ui.render();
  collect({ kind: 'gun', weaponId: 'mp5', ammo: 7, reserve: 12 });
  tap('gun:mp5');
  assert.equal(game.weapon.id, 'mp5'); assert.equal(game.weaponState.ammo, 7); assert.equal(game.weaponState.reserve, 12);
  assert.equal(game.player.equipment.startingGunRemoved, true); assert.equal(slot('gun:m4a1'), undefined);
  assert.deepEqual(actions[0], { kind: 'equip-gun', weaponId: 'mp5', source: 'inventory' });
  collect({ kind: 'gun', weaponId: 'awp', ammo: 2, reserve: 8 }); tap('gun:awp'); tap('gun:mp5');
  assert.equal(game.weaponState.ammo, 7); assert.equal(game.weaponState.reserve, 12);
  assert.equal(game.active, true); assert.deepEqual(picker, []); assert.equal(ui.pendingSelection, null);
});

// Catches treating grenade selection as a throw or erasing the separate held item marker.
test('knife and grenade taps show distinct held and throw selections without throwing or opening a picker', t => {
  const { ui, game, collect, tap, slot, actions, picker } = fixture(t); ui.render();
  collect({ kind: 'knife' }); collect({ kind: 'grenade', grenadeType: 'frag' }); collect({ kind: 'grenade', grenadeType: 'smoke' });
  tap('knife'); tap('grenade:smoke');
  assert.equal(game.player.equipment.heldItem, 'knife'); assert.equal(game.player.equipment.selectedGrenade, 'smoke');
  assert.deepEqual(game.player.equipment.grenades, { frag: 1, smoke: 1, flash: 0 });
  assert.equal(game.gearCombatState.projectiles.length, 0);
  assert.equal(slot('knife').querySelector('.inventory-status').textContent, 'HELD');
  assert.equal(slot('grenade:smoke').querySelector('.inventory-status').textContent, 'THROW');
  assert.equal(slot('gun:m4a1').getAttribute('aria-pressed'), 'false');
  assert.equal(slot('knife').getAttribute('aria-pressed'), 'true');
  assert.equal(slot('grenade:smoke').getAttribute('aria-pressed'), 'true');
  assert.equal(slot('grenade:frag').getAttribute('aria-pressed'), 'false');
  assert.deepEqual(actions, [{ kind: 'held-item', heldItem: 'knife' }, { kind: 'select-grenade', grenadeType: 'smoke' }]);
  assert.deepEqual(picker, []); assert.equal(game.active, true);
  tap('gun:m4a1'); assert.equal(game.player.equipment.heldItem, 'gun');
  assert.equal(slot('gun:m4a1').querySelector('.inventory-status').textContent, 'HELD');
  assert.equal(slot('grenade:smoke').querySelector('.inventory-status').textContent, 'THROW');
});

// Catches disabled-only protection that lets synthetic/stale clicks reach equipment actions.
for (const reason of ['paused', 'dead', 'no round', 'default guard']) test(`inventory rejects taps while ${reason}`, t => {
  const { ui, game, collect, tap, slots, actions } = fixture(t, reason === 'default guard' ? { canSelectInventory: undefined } : {});
  collect({ kind: 'gun', weaponId: 'mp5', ammo: 7, reserve: 12 });
  if (reason === 'paused') game.pause();
  if (reason === 'dead') game.player.health = 0;
  if (reason === 'no round') game.hasRound = false;
  ui.render(); assert.equal(slots.children.every(button => button.disabled), true);
  tap('gun:mp5'); assert.equal(game.player.equipment.activeGunId, 'm4a1'); assert.deepEqual(actions, []);
});

// Catches reusing a live target's new identity to accept a tap begun in a previous life/round.
for (const transition of ['life', 'round']) test(`a tap begun before a changed ${transition} cannot equip after render`, t => {
  const { ui, game, collect, slot, send, actions } = fixture(t);
  collect({ kind: 'gun', weaponId: 'mp5', ammo: 7, reserve: 12 });
  const button = slot('gun:mp5'); send(button, 'pointerdown');
  if (transition === 'life') game.resetPlayer(); else game.start('m4a1', { bots: 0 });
  collect({ kind: 'gun', weaponId: 'mp5', ammo: 1, reserve: 4 }); ui.render();
  send(button, 'pointerup'); send(button, 'click');
  assert.equal(game.player.equipment.activeGunId, 'm4a1'); assert.deepEqual(actions, []);
});

// Catches stale entries dispatching a now-unowned gun through an acquisition path.
test('ownership and rendered identity are rechecked when the click arrives', t => {
  const { ui, game, collect, slot, send, actions } = fixture(t);
  collect({ kind: 'gun', weaponId: 'mp5', ammo: 7, reserve: 12 });
  const button = slot('gun:mp5'); game.player.equipment.owned.delete('mp5'); send(button, 'click');
  assert.deepEqual(actions, []); assert.equal(game.player.equipment.owned.has('mp5'), false);
  game.resetPlayer(); send(slot('gun:m4a1'), 'click'); assert.deepEqual(actions, []);
  ui.render(); assert.deepEqual(document.getElementById('inventory-slots').children.map(item => item.dataset.inventoryKey), ['gun:m4a1']);
});

// Catches wholesale list recreation, which loses focused/held touch targets and scroll position.
test('ammo, counts and held state update keyed buttons and labels without replacing touch targets', t => {
  const { ui, game, collect, slot, slots } = fixture(t);
  collect({ kind: 'gun', weaponId: 'mp5', ammo: 7, reserve: 12 }); collect({ kind: 'grenade', grenadeType: 'smoke' });
  const gun = slot('gun:mp5'), grenade = slot('grenade:smoke'), label = gun.querySelector('.inventory-count');
  slots.scrollLeft = 86; gun.focus(); game.player.equipment.owned.get('mp5').ammo = 6;
  collect({ kind: 'grenade', grenadeType: 'smoke' }); ui.render();
  assert.equal(slot('gun:mp5'), gun); assert.equal(slot('grenade:smoke'), grenade);
  assert.equal(gun.querySelector('.inventory-count'), label); assert.equal(label.textContent, '6 / 12');
  assert.equal(grenade.querySelector('.inventory-count').textContent, 'x2');
  assert.equal(slots.scrollLeft, 86); assert.equal(document.activeElement, gun);
});

// Catches browser-generated clicks following a scroll gesture or global pointer cancellation.
for (const gesture of ['swipe', 'scroll', 'cancel']) test(`${gesture} suppresses equipment selection until a fresh tap`, t => {
  const { ui, game, collect, slot, slots, send, tap, actions } = fixture(t);
  collect({ kind: 'gun', weaponId: 'mp5', ammo: 7, reserve: 12 });
  const button = slot('gun:mp5'); send(button, 'pointerdown');
  if (gesture === 'swipe') send(document, 'pointermove', { clientX: 70 });
  if (gesture === 'scroll') { slots.scrollLeft = 40; send(slots, 'scroll'); }
  if (gesture === 'cancel') send(document, 'pointercancel');
  ui.render(); send(button, 'pointerup'); send(button, 'click');
  assert.equal(game.weapon.id, 'm4a1'); assert.deepEqual(actions, []);
  tap('gun:mp5'); assert.equal(game.weapon.id, 'mp5');
});

// Catches losing horizontal inventory access under the game's global touch-action:none.
test('a horizontal pointer drag scrolls the inventory and keeps its initial offset across HUD updates', t => {
  const { ui, game, collect, slots, slot, send } = fixture(t);
  collect({ kind: 'gun', weaponId: 'mp5', ammo: 7, reserve: 12 });
  slots.scrollLeft = 15; const button = slot('gun:mp5'); send(button, 'pointerdown', { clientX: 150 });
  send(document, 'pointermove', { clientX: 110 }); assert.equal(slots.scrollLeft, 55);
  game.player.equipment.owned.get('mp5').ammo = 6; ui.render();
  send(document, 'pointermove', { clientX: 90 }); assert.equal(slots.scrollLeft, 75);
  send(button, 'pointerup', { clientX: 90 }); send(button, 'click');
  assert.equal(game.weapon.id, 'm4a1');
});

// Catches a finished swipe hijacking a later aim or movement pointer with the reused pointer ID.
test('a swipe released without a click cannot scroll the inventory during later combat gestures', t => {
  const { collect, slots, slot, send } = fixture(t);
  collect({ kind: 'gun', weaponId: 'mp5', ammo: 7, reserve: 12 });
  const button = slot('gun:mp5'); send(button, 'pointerdown', { clientX: 150 });
  send(document, 'pointermove', { clientX: 110 }); send(document, 'pointerup', { clientX: 110 });
  const left = slots.scrollLeft;
  send(document, 'pointerdown', { clientX: 300 }); send(document, 'pointermove', { clientX: 20 });
  assert.equal(slots.scrollLeft, left);
});

// Catches active pointer streams scrolling or equipping after the match becomes inactive.
test('pausing during an inventory press cancels scrolling and selection even after resume', t => {
  const { game, collect, slots, slot, send, actions } = fixture(t);
  collect({ kind: 'gun', weaponId: 'mp5', ammo: 7, reserve: 12 });
  const button = slot('gun:mp5'); send(button, 'pointerdown', { clientX: 150 });
  game.pause(); send(document, 'pointermove', { clientX: 110 }); assert.equal(slots.scrollLeft, 0);
  game.resume(); send(document, 'pointermove', { clientX: 100 }); assert.equal(slots.scrollLeft, 0);
  send(button, 'pointerup', { clientX: 100 }); send(button, 'click');
  assert.equal(game.weapon.id, 'm4a1'); assert.deepEqual(actions, []);
});

// Catches a held finger surviving pause/resume when neither render nor movement runs in between.
test('mode changes cancel a held inventory tap even with no paused render or pointer movement', t => {
  const { ui, game, collect, slot, send, tap, actions } = fixture(t);
  collect({ kind: 'gun', weaponId: 'mp5', ammo: 7, reserve: 12 });
  const button = slot('gun:mp5'); send(button, 'pointerdown');
  game.pause(); ui.close(); game.resume(); ui.close();
  send(button, 'pointerup'); send(button, 'click');
  assert.equal(game.weapon.id, 'm4a1'); assert.deepEqual(actions, []);
  tap('gun:mp5'); assert.equal(game.weapon.id, 'mp5', 'A fresh tap works after resume');
});

// Catches retaining ghost equipment across death and inventing inventory on respawn.
test('death clears the inventory and the next round shows only the selected starting gun', t => {
  const { ui, game, collect, slots } = fixture(t);
  game.start('m4a1', { bots: 1 });
  collect({ kind: 'gun', weaponId: 'mp5', ammo: 7, reserve: 12 }); collect({ kind: 'knife' });
  game.player.protected = 0;
  assert.equal(game.damageActor('bot-0', game.player, 200, game.getActors()), true);
  ui.render(); assert.equal(slots.children.length, 0);
  game.start('awp', { bots: 0 }); ui.render();
  assert.deepEqual(slots.children.map(button => button.dataset.inventoryKey), ['gun:awp']);
  assert.equal(slots.children[0].querySelector('.inventory-number').textContent, '1');
});

// Catches optimistic selection before an authoritative snapshot reaches the real OnlineArena.
test('online inventory waits for the server snapshot before changing held and throw selections', t => {
  const dom = createInventoryDOM(t), game = createHeadlessGame(); t.after(() => cleanupGame(game));
  const manager = new RoomManager({ random: () => .5 }), room = manager.create('p1', 'Host', 'm4a1');
  manager.join('p2', room.code, 'Guest', 'm4a1'); manager.start('p1');
  const own = room.players.get('p2');
  for (const item of [{ kind: 'gun', weaponId: 'mp5', ammo: 7, reserve: 12 }, { kind: 'knife' }, { kind: 'grenade', grenadeType: 'smoke' }])
    assert.equal(pickupEquipment(own.equipment, item).ok, true);
  const packets = [], client = new RoomClient();
  client.id = 'p2'; client.connected = true; client.socket = { readyState: 1, send: text => packets.push(JSON.parse(text)) };
  const snapshot = () => { const state = manager.snapshot(room, false); state.selfEquipment = manager.equipmentSnapshot('p2'); client.room = state; return state; };
  const arena = new OnlineArena(game, client); arena.start(snapshot(), 'p2', {}); t.after(() => arena.stop());
  const ui = new EquipmentUI({ getView: () => ({ ...arena.getEquipmentView(), lifeId: game.player.lifeId, roundId: arena, alive: game.player.health > 0 }),
    onAction: action => arena.requestEquipment(action), onPicker() { assert.fail('inventory must not open a modal'); }, onToast() {},
    canSelectInventory: () => game.input.enabled && !arena.suspended });
  ui.render(); dom.tap('gun:mp5');
  assert.equal(game.weapon.id, 'm4a1'); assert.equal(dom.slot('gun:m4a1').querySelector('.inventory-status').textContent, 'HELD');
  assert.equal(dom.slot('gun:mp5').getAttribute('aria-pressed'), 'false');
  assert.equal(manager.equipmentAction('p2', packets.at(-1)).ok, true); arena.sync(snapshot()); ui.render();
  assert.equal(game.weapon.id, 'mp5'); assert.equal(game.weaponState.ammo, 7); assert.equal(dom.slot('gun:m4a1'), undefined);
  dom.tap('knife'); assert.equal(game.player.equipment.heldItem, 'gun');
  assert.equal(manager.equipmentAction('p2', packets.at(-1)).ok, true); arena.sync(snapshot()); ui.render();
  assert.equal(game.player.equipment.heldItem, 'knife');
  dom.tap('grenade:smoke'); assert.equal(game.player.equipment.selectedGrenade, 'frag');
  assert.equal(manager.equipmentAction('p2', packets.at(-1)).ok, true); arena.sync(snapshot()); ui.render();
  assert.equal(game.player.equipment.selectedGrenade, 'smoke'); assert.equal(own.equipment.grenades.smoke, 1);
  assert.equal(arena.suspended, false); assert.equal(game.input.enabled, true);
});

// Catches using newer runtime APIs that Android's minimum WebView does not provide.
test('inventory rendering and selection work without newer Object and DOM APIs', t => {
  const hasOwn = Object.hasOwn, clone = globalThis.structuredClone;
  Object.hasOwn = undefined; globalThis.structuredClone = undefined;
  t.after(() => { Object.hasOwn = hasOwn; globalThis.structuredClone = clone; });
  const { ui, game, collect, tap, slots } = fixture(t); assert.equal(slots.replaceChildren, undefined);
  collect({ kind: 'gun', weaponId: 'mp5', ammo: 7, reserve: 12 }); tap('gun:mp5'); ui.render();
  assert.equal(game.weapon.id, 'mp5'); assert.equal(game.weaponState.ammo, 7);
});

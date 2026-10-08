import test from 'node:test';
import { HidingUI } from '../src/hiding-ui.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { EquipmentUI } from '../src/equipment-ui.js';
import { pickupEquipment } from '../src/equipment.js';
import { createHeadlessGame, cleanupGame } from './helpers/game-fixture.js';
import { createInventoryDOM } from './helpers/inventory-dom-fixture.js';

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
function fixture(t) {
  const dom = createInventoryDOM(t), game = createHeadlessGame();
  game.start('m4a1', { bots: 0 }); t.after(() => cleanupGame(game));
  const actions = [], messages = [];
  const getView = runInNewContext(`(${main.match(/function equipmentView\(\) \{[\s\S]*?\n\}/)[0]})`, { game, multiplayer: null });
  const ui = new EquipmentUI({ getView, canSelectInventory: () => game.input.enabled,
    onAction(action) { actions.push(action); return game.requestEquipment(action); },
    onToast: message => messages.push(message), onPicker() {} });
  const collect = (type, count = 1) => {
    for (let n = 0; n < count; n++) assert.equal(pickupEquipment(game.player.equipment, { kind: 'supply', supplyType: type }).ok, true);
    ui.render();
  };
  return { ...dom, game, ui, actions, messages, collect, getView };
}

// Catches omitted pack stacks, split inventories, incorrect numbering or stale counts.
test('supplies append in the same inventory with names counts and contiguous numbers', t => {
  const { collect, game, slots, slot, getView } = fixture(t);
  pickupEquipment(game.player.equipment, { kind: 'knife' });
  pickupEquipment(game.player.equipment, { kind: 'grenade', grenadeType: 'flash' });
  collect('health', 3); collect('armour');
  assert.deepEqual(slots.children.map(b => b.dataset.inventoryKey), ['gun:m4a1','knife','grenade:flash','supply:health','supply:armour']);
  assert.deepEqual(slots.children.map(b => b.querySelector('.inventory-number').textContent), ['1','2','3','4','5']);
  assert.equal(slot('supply:health').querySelector('.inventory-name').textContent, 'Health Pack');
  assert.equal(slot('supply:health').querySelector('.inventory-count').textContent, 'x3');
  assert.equal(slot('supply:armour').querySelector('.inventory-name').textContent, 'Armour Pack');
  assert.equal(slot('supply:armour').querySelector('.inventory-count').textContent, 'x1');
  assert.equal(getView().health, 100); assert.equal(getView().armour, 0);
});

test('tap starts then explicitly cancels without consuming and progress follows simulation', t => {
  const { collect, game, ui, tap, slot, actions, document } = fixture(t);
  const $ = id => document.getElementById(id);
  game.player.health = 30; collect('health', 3); collect('armour');
  tap('supply:health');
  assert.deepEqual(actions.at(-1), { kind: 'use-supply', supplyType: 'health' });
  assert.equal(slot('supply:health').getAttribute('aria-pressed'), 'true');
  assert.equal($('supply-use-status').hidden, false);
  assert.match($('supply-use-label').textContent, /HEALING.*5\.0s/);
  game.update(2); ui.render();
  assert.match($('supply-use-label').textContent, /HEALING.*3\.0s/);
  assert.ok(Math.abs(parseFloat($('supply-use-progress').style.width) - 40) < 1e-6);
  tap('supply:health'); assert.deepEqual(actions.at(-1), { kind: 'cancel-supply' });
  assert.equal(game.player.equipment.supplies.health, 3); assert.equal($('supply-use-status').hidden, true);
  tap('supply:armour'); assert.match($('supply-use-label').textContent, /ADDING ARMOUR.*5\.0s/);
  game.update(5); ui.render(); assert.equal(slot('supply:armour'), undefined);
  assert.equal($('supply-use-status').hidden, true); assert.equal(game.player.armour, 50);
});

test('scroll is not use and old-life gestures are ignored', t => {
  const { collect, game, ui, slot, send, actions } = fixture(t); game.player.health = 30; collect('health');
  let button = slot('supply:health');
  send(button, 'pointerdown'); send(button, 'pointermove', { clientX: -50 }); send(button, 'pointerup'); send(button, 'click');
  assert.equal(actions.length, 0);
  send(button, 'pointerdown'); game.resetPlayer(); collect('health'); ui.render();
  send(button, 'pointerup'); send(button, 'click'); assert.equal(actions.length, 0);
  assert.equal(game.player.equipment.supplyUse, null);
});

test('full health explains rejection and changing guns cancels without spending', t => {
  const { collect, game, tap, messages, ui } = fixture(t); collect('health');
  tap('supply:health'); assert.match(messages.at(-1), /not needed/i);
  assert.equal(game.player.equipment.supplies.health, 1); assert.equal(game.player.equipment.supplyUse, null);
  game.player.health = 30; tap('supply:health');
  pickupEquipment(game.player.equipment, { kind:'gun', weaponId:'mp5', ammo:7, reserve:12 }); ui.render();
  tap('gun:mp5'); assert.equal(game.weapon.id, 'mp5'); assert.equal(game.player.equipment.supplyUse, null);
  assert.equal(game.player.equipment.supplies.health, 1);
});

test('real HUD cannot undo supply recovery death or throw locks and renders armour', t => {
  const { collect, game, ui, tap, document } = fixture(t), $ = id => document.getElementById(id);
  const onHud = runInNewContext(`(${main.match(/function onHud\(current\) \{[\s\S]*?\n\}/)[0]})`, {
    $, equipmentUI: ui, hidingUI: new HidingUI({ button: $('hide-button'), status: $('hiding-status') }), renderMatchHud() {}, renderProgression() {}, multiplayer:null, input:game.input, performance:{now:()=>0}, toastUntil:1,
  });
  pickupEquipment(game.player.equipment, { kind:'grenade', grenadeType:'frag' });
  game.player.armour = 35; game.player.health = 30; collect('health'); tap('supply:health'); onHud(game);
  assert.equal($('armour-count').textContent, '35'); assert.equal($('armour-bar').style.width, '35%');
  for (const id of ['fire-button','throw-button','reload-button']) assert.equal($(id).disabled, true, id);
  assert.equal($('zoom-button').disabled, false); assert.equal(game.input.enabled, true);
  tap('supply:health'); onHud(game);
  for (const id of ['fire-button','throw-button','reload-button']) assert.equal($(id).disabled, false, id);
  game.player.equipment.throwRemaining = .5; onHud(game); assert.equal($('throw-button').disabled, true);
  game.player.equipment.throwRemaining = 0; game.player.dead = 1; onHud(game);
  for (const id of ['fire-button','throw-button','reload-button']) assert.equal($(id).disabled, true, id);
  game.player.dead = 0; game.start('m4a1', { modeId:'zombies' });
  game.modeState.phase = 'recovery'; game.refreshMatchView(); onHud(game);
  assert.equal($('fire-button').disabled, true); assert.equal($('throw-button').disabled, true);
  assert.equal($('armour-count').textContent, '0'); assert.equal($('supply-use-status').hidden, true);
});

test('hidden supply users can press touch Fire to exit without firing or consuming extra supplies', t => {
  const { collect, game, ui, tap, document } = fixture(t), $ = id => document.getElementById(id);
  const onHud = runInNewContext(`(${main.match(/function onHud\(current\) \{[\s\S]*?\n\}/)[0]})`, {
    $, equipmentUI: ui, hidingUI: new HidingUI({ button: $('hide-button'), status: $('hiding-status') }), renderMatchHud() {}, renderProgression() {}, multiplayer:null, input:game.input, performance:{now:()=>0}, toastUntil:1,
  });
  const spot = game.world.definition.hideSpots[0];
  Object.assign(game.player, spot.entry, { health: 30, jump: 0 });
  assert.equal(game.requestHide({ kind: 'enter', spotId: spot.id }).ok, true);
  collect('health'); tap('supply:health'); onHud(game);
  assert.equal($('fire-button').disabled, false); assert.equal($('throw-button').disabled, false);
  assert.equal($('hide-button').textContent, 'Exit'); assert.equal($('hiding-status').textContent, 'Hiding');
  const ammo = game.weaponState.ammo; game.input.firePressed = true; game.update(.01);
  assert.equal(game.player.hiddenSpotId, null); assert.equal(game.weaponState.ammo, ammo); assert.equal(game.player.equipment.supplies.health, 1);
  assert.ok(game.player.equipment.supplyUse);
});

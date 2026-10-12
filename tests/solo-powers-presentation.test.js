import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createInventoryDOM } from './helpers/inventory-dom-fixture.js';
import { createHeadlessGame, cleanupGame } from './helpers/game-fixture.js';
import { pickupEquipment, equipmentDTO } from '../src/equipment.js';
import { EquipmentUI } from '../src/equipment-ui.js';
import { HidingUI } from '../src/hiding-ui.js';
import { renderClimbHint } from '../src/climb-presentation.js';

const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const powered={invincible:false,unlimitedAmmo:true,superSpeed:false,speedMultiplier:2};
function fixture(t) {
  const dom=createInventoryDOM(t),game=createHeadlessGame();t.after(()=>cleanupGame(game));
  game.start('m4a1',{bots:0},powered);
  const ui=new EquipmentUI({getView:()=>({...game.getEquipmentView(),roundId:game.modeState,lifeId:game.player.lifeId,alive:game.player.health>0}),
    onAction:action=>game.requestEquipment(action),onPicker(){},onToast(){},canSelectInventory:()=>true,
    isUnlimitedAmmo:()=>game.getSoloPowers().unlimitedAmmo});
  return {...dom,game,ui,$:id=>dom.document.getElementById(id)};
}

test('owned gun labels alone become infinity; keyed slots, quantities and scroll stay intact',t=>{
  const {game,ui,slots,$}=fixture(t),e=game.player.equipment;
  pickupEquipment(e,{kind:'gun',weaponId:'mp5',ammo:7,reserve:12});pickupEquipment(e,{kind:'knife'});
  pickupEquipment(e,{kind:'grenade',grenadeType:'smoke'});pickupEquipment(e,{kind:'supply',supplyType:'health'});
  const before=equipmentDTO(e);ui.render();slots.scrollLeft=91;
  const buttons=[...slots.children];ui.render();
  assert.deepEqual(buttons,slots.children);assert.equal(slots.scrollLeft,91);
  assert.deepEqual(slots.children.map(b=>b.querySelector('.inventory-count').textContent),['∞','∞','x1','x1','x1']);
  assert.deepEqual(slots.children.map(b=>b.querySelector('.inventory-number').textContent),['1','2','3','4','5']);
  assert.equal($('reload-button').disabled,true);assert.deepEqual(equipmentDTO(e),before);
  game.resetSoloPowers();ui.render();assert.equal($('reload-button').disabled,false);
  assert.deepEqual(slots.children.map(b=>b.querySelector('.inventory-count').textContent),['30 / 470','7 / 12','x1','x1','x1']);
  assert.equal(slots.scrollLeft,91);
});

test('real HUD shows infinity locally, restores numbers when off/online and tolerates old minimal fixtures',t=>{
  const {game,ui,$}=fixture(t);
  const context={$,equipmentUI:ui,renderClimbHint,hidingUI:new HidingUI({button:$('hide-button'),status:$('hiding-status')}),
    renderMatchHud(){},renderProgression(){},multiplayer:null,input:game.input,performance:{now:()=>0},toastUntil:1};
  const hud=runInNewContext(`(${main.match(/function onHud\(current\) \{[\s\S]*?\n\}/)[0]})`,context);
  hud(game);assert.equal($('ammo-count').textContent,'∞');assert.equal($('reserve-count').textContent,'∞');
  assert.equal($('reload-status').textContent,'');
  context.multiplayer={isActive:()=>true,client:{id:'local'},arena:game};hud(game);
  assert.equal($('ammo-count').textContent,'30');assert.equal($('reserve-count').textContent,'470');
  context.multiplayer=null;game.resetSoloPowers();hud(game);assert.equal($('ammo-count').textContent,'30');
  context.equipmentUI=null;game.getSoloPowers=undefined;hud(game);assert.equal($('ammo-count').textContent,'30');
});

test('carried-gun loadout counts also follow ammo toggles without changing the inventory',t=>{
  const {game,ui,$}=fixture(t);
  const weapon=$('fixture-weapon');weapon.dataset.weapon='m4a1';
  const before=equipmentDTO(game.player.equipment);
  ui.render();
  assert.equal($('carried-guns').children[0].textContent,'M4A1 · ∞ · ACTIVE');
  assert.equal(weapon.querySelector('.weapon-type').textContent,'CARRIED · ∞');
  game.resetSoloPowers();ui.render();
  assert.equal($('carried-guns').children[0].textContent,'M4A1 · 30 / 470 · ACTIVE');
  assert.equal(weapon.querySelector('.weapon-type').textContent,'CARRIED · 30 / 470');
  assert.deepEqual(equipmentDTO(game.player.equipment),before);
});

test('fatal shutdown resets powers even if modal cleanup itself throws',t=>{
  const {game}=fixture(t);
  const stop=runInNewContext(`(${main.match(/function stopAfterFatal\(\) \{[\s\S]*?\n\}/)[0]})`, {
    mode:'playing',confirmation:null,frameRequest:null,cancelAnimationFrame(){},input:game.input,game,multiplayer:null,audio:game.audio,
    invalidatePowerMenu(){throw Error('broken modal');},resetPowerSession(){game.resetSoloPowers();},
  });
  stop();assert.equal(game.getSoloPowers().unlimitedAmmo,false);assert.equal(game.active,false);
});

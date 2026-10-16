import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createInventoryDOM } from './helpers/inventory-dom-fixture.js';
import { createHeadlessGame, cleanupGame } from './helpers/game-fixture.js';
import { renderMatchHud } from '../src/match-ui.js';
import { MAPS, getMap } from '../src/maps.js';
import { SOLO_MODES, getSoloMode } from '../src/solo-modes.js';
import { getSkin } from '../src/skins.js';
import { getWeapon } from '../src/weapons.js';
import { getGunFinish } from '../src/cosmetics.js';
import { defaultSoloPowers } from '../src/solo-powers.js';
import { EquipmentUI } from '../src/equipment-ui.js';
import { HidingUI } from '../src/hiding-ui.js';
import { renderClimbHint } from '../src/climb-presentation.js';

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
// Execute the real controller bodies; canvas/GPU output is the only omitted sink.
function controller(name, context) {
  const source = main.match(new RegExp(`function ${name}\\([^\\n]*\\}\\n`))?.[0]
    || main.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))?.[0];
  assert.ok(source, `Controller exposes ${name}`);
  return runInNewContext(`(${source})`, context);
}
function fixture(t) {
  const dom = createInventoryDOM(t), $ = id => dom.document.getElementById(id);
  const panel = $('score-panel');
  dom.document.querySelector = selector => selector === '.score-panel' ? panel : $('score-target');
  dom.document.hasFocus = () => true; dom.document.hidden = false;
  dom.document.activeElement = { blur() {} };
  const create = dom.document.createElement;
  dom.document.createElement = tag => tag === 'canvas' ? { getContext: () => ({ clearRect() {}, fillRect() {}, fillText() {} }) } : create(tag);
  const game = createHeadlessGame(); t.after(() => cleanupGame(game));
  const selection = { mapId:'courtyard', modeId:'tdm', weaponId:'mp5', skinId:'ranger', finishId:'standard' };
  const modes = [], toasts = [];
  game.events.onHud = () => {}; game.events.onToast = message => toasts.push(message);
  const context = { $, document:dom.document, game, selection, settings:{bots:3}, mode:'home',
    runtimeErrors:{failed:false}, multiplayer:null, backgroundSuspended:false,
    pendingSoloPowers:{invincible:true, unlimitedAmmo:false, superSpeed:true, speedMultiplier:3}, defaultSoloPowers,
    audio:{unlock() {}}, setMode:mode => modes.push(mode), showHome:() => modes.push('home') };
  return { ...dom, $, panel, game, selection, context, modes, toasts };
}
const range = stats => ({ modeId:'private-practice', range:{ targetKills:0, earnedXP:0, shotsFired:0, shotsHit:0, accuracy:0, ...stats }, players:[], timeLeft:null });

test('Home Shooting Range button invokes its action without changing normal configuration', t => {
  const {document, $, send, selection} = fixture(t); let visits = 0;
  $('map-grid').querySelectorAll = () => [];
  const home = readFileSync(new URL('../src/home-ui.js', import.meta.url), 'utf8');
  const HomeUI = runInNewContext(`(${home.slice(home.indexOf('export class HomeUI')).replace('export class', 'class')})`, {
    $, document, MAPS, SOLO_MODES, getMap, getSoloMode, getSkin, getWeapon, getGunFinish,
    CharacterPreview:class { equip() {} }, drawMapPreview() {},
  });
  new HomeUI({ getSelection:() => selection, onSelection() { throw Error('Unexpected selection change'); },
    onRange:() => visits++, onSolo() {}, onOnline() {}, onArmory() {}, onSettings() {} });
  send($('home-range'), 'click'); assert.equal(visits, 1);
  assert.deepEqual(selection, {mapId:'courtyard', modeId:'tdm', weaponId:'mp5', skinId:'ranger', finishId:'standard'});
});

test('practice HUD bypasses public mode lookup and shows zero stats without a timer', t => {
  const {$,panel} = fixture(t);
  renderMatchHud(range(), 'local');
  assert.equal($('hud-mode').textContent, 'Shooting Range');
  assert.equal($('range-kills').textContent, '0'); assert.equal($('range-xp').textContent, '0');
  assert.equal($('range-accuracy').textContent, '0% (0/0)');
  assert.equal($('timer').hidden, true); assert.equal(panel.hidden, true); assert.equal($('range-stats').hidden, false);
});
test('practice HUD reports shot accuracy and immediate earned XP', t => {
  const {$} = fixture(t);
  renderMatchHud(range({targetKills:2,earnedXP:30,shotsFired:4,shotsHit:2,accuracy:50}), 'local');
  assert.equal($('range-accuracy').textContent, '50% (2/4)');
  assert.equal($('range-kills').textContent, '2'); assert.equal($('range-xp').textContent, '30');
});
test('normal and Zombies HUD restore score and timer when practice ends', t => {
  const {$,panel} = fixture(t);
  renderMatchHud(range(), 'local');
  renderMatchHud({modeId:'ffa',players:[{id:'local',kills:3}],timeLeft:62,teamScores:{red:0,blue:0}}, 'local');
  assert.equal(panel.hidden, false); assert.equal($('range-stats').hidden, true); assert.equal($('timer').hidden, false);
  assert.equal($('timer').textContent, '01:02'); assert.equal($('kills').textContent, '3');
  renderMatchHud(range(), 'local');
  renderMatchHud({modeId:'zombies',survival:{phase:'combat',wave:2,remaining:3,kills:7}}, 'local');
  assert.equal(panel.hidden, false); assert.equal($('timer').hidden, false); assert.equal($('timer').textContent, '7 KILLS');
});

test('focused visible Home deployment starts real practice, consumes powers and keeps normal selection', t => {
  const {context,game,selection,modes} = fixture(t), before = {...selection}; context.backgroundSuspended = true;
  controller('deployRange', context)();
  assert.equal(game.modeState.kind, 'range'); assert.equal(game.weapon.id, 'mp5'); assert.equal(game.getSoloPowers().speedMultiplier, 3);
  assert.deepEqual(selection,before); assert.deepEqual({...context.pendingSoloPowers},defaultSoloPowers());
  assert.equal(context.backgroundSuspended,false); assert.deepEqual(modes,['playing']);
});
test('completed normal round on Home allows a new practice visit',t=>{
  const {context,game,modes}=fixture(t);game.start('m4a1',{bots:0});game.match.ended=true;game.modeState.ended=true;game.pause();
  controller('deployRange',context)();assert.equal(game.modeState.kind,'range');assert.deepEqual(modes,['playing']);
});
for (const [name,alter] of [
  ['hidden',c=>c.document.hidden=true], ['unfocused',c=>c.document.hasFocus=()=>false],
  ['non-Home',c=>c.mode='armory'], ['fatal',c=>c.runtimeErrors.failed=true],
  ['online',c=>c.multiplayer={isConnected:()=>true}], ['busy',c=>c.multiplayer={isConnected:()=>false,busy:true}],
  ['live round',c=>c.game.start('m4a1',{bots:0})],
]) test(`${name} Home action cannot start practice or consume pending powers`,t=>{
  const {context,game,modes} = fixture(t); alter(context); const state = game.modeState;
  controller('deployRange',context)();
  assert.equal(game.modeState,state); assert.equal(context.pendingSoloPowers.superSpeed,true); assert.deepEqual(modes,[]);
});
test('failed private world attachment returns usable Home with error toast and no live practice',t=>{
  const {context,game,modes,toasts} = fixture(t);
  // Fail the allocation sink after the world has attached; startup rollback remains real.
  context.document.createElement = () => { throw Error('target canvas unavailable'); };
  controller('deployRange',context)();
  assert.equal(game.hasRound,false); assert.equal(game.rangeRuntime,null); assert.deepEqual(modes,['home']);
  assert.match(toasts[0],/target canvas unavailable/); assert.deepEqual({...context.pendingSoloPowers},defaultSoloPowers());
});
test('practice Armory presentation never resolves its private identity through public catalogues',t=>{
  const {context,game,$} = fixture(t); game.tryStartRange('mp5');
  Object.assign(context,{equipmentUI:{currentSelection:()=>null},getMap(){throw Error('Public map lookup');},getSoloMode(){throw Error('Public mode lookup');}});
  controller('renderArmorySession',context)();
  assert.equal($('armory-map').textContent,'SHOOTING RANGE'); assert.equal($('session-duration').textContent,'UNTIMED');
  assert.match($('armory-mode').textContent,/29 GUNS/); assert.equal($('bot-count-label').textContent,'NO ENEMIES');
  assert.match($('play-button').innerHTML,/RETURN TO PRACTICE/);
});
test('Armory after ending practice restores the saved public map and mode presentation',t=>{
  const {context,game,$}=fixture(t);game.tryStartRange('mp5');game.quit();
  Object.assign(context,{getMap,getSoloMode,equipmentUI:{currentSelection:()=>null}});
  controller('renderArmorySession',context)();
  assert.equal($('armory-map').textContent,'SUNLIT COURTYARD');assert.equal($('session-duration').textContent,'3 MIN');
  assert.equal($('bot-count-label').textContent,'3 BOTS');assert.match($('play-button').innerHTML,/DEPLOY/);
});
test('returning Home restores normal selected gun, class and preview after temporary practice equipment',t=>{
  const {context,game,selection} = fixture(t); game.tryStartRange('mp5'); game.requestEquipment({kind:'equip-gun',weaponId:'minigun',source:'armory'}); game.quit();
  Object.assign(context,{getWeapon,selected:getWeapon('minigun'),activeClass:'lmg',progression:{retry(){}},home:{render(){}},renderProgression(){},renderSelected(){context.previewed=context.selected.id;}});
  controller('showHome',context)();
  assert.equal(context.selected.id,'mp5'); assert.equal(context.activeClass,'smg'); assert.equal(context.previewed,'mp5');
  assert.equal(selection.modeId,'tdm'); assert.equal(selection.mapId,'courtyard');
});
test('practice teammate map clears stale large map before actor or public map reads',t=>{
  const {context,game,$} = fixture(t); game.tryStartRange('mp5'); $('teammate-map-screen').hidden=false;
  Object.assign(context,{mapSession:{},getMap(){throw Error('Public map');},teammateMapState(){throw Error('Actor lookup');}});
  controller('renderTeamMap',context)();
  assert.equal($('game-ui').dataset.teamMap,'false'); assert.equal($('teammate-map-button').hidden,true); assert.equal($('teammate-map-screen').hidden,true);
});
test('real ammo HUD keeps a normal magazine and infinity reserve without disabling reload',t=>{
  const {context,game,$} = fixture(t); game.tryStartRange('m4a1');
  const ui = new EquipmentUI({getView:()=>({...game.getEquipmentView(),roundId:game.modeState,lifeId:game.player.lifeId,alive:true}),
    onAction:action=>game.requestEquipment(action),onPicker(){},onToast(){},isUnlimitedAmmo:()=>game.getSoloPowers().unlimitedAmmo,
    isUnlimitedReserve:()=>game.modeState.kind==='range'});
  Object.assign(context,{equipmentUI:ui,renderMatchHud,renderClimbHint,hidingUI:new HidingUI({button:$('hide-button'),status:$('hiding-status')}),
    renderProgression(){},input:game.input,performance:{now:()=>0},toastUntil:1});
  const hud=controller('onHud',context);hud(game);
  assert.equal($('ammo-count').textContent,'30');assert.equal($('reserve-count').textContent,'∞');assert.equal($('reload-button').disabled,false);
  game.weaponState.ammo=29;game.input.reload=true;game.update(.01);hud(game);
  assert.match($('reload-status').textContent,/RELOADING/);
  game.setSoloPowers({invincible:false,unlimitedAmmo:true,superSpeed:false,speedMultiplier:2},game.modeState);hud(game);
  assert.equal($('ammo-count').textContent,'∞');assert.equal($('reload-button').disabled,true);assert.equal($('reload-status').textContent,'');
  context.multiplayer={isActive:()=>true,client:{id:'local'},arena:game};hud(game);
  assert.equal($('ammo-count').textContent,String(game.weaponState.ammo));assert.equal($('reserve-count').textContent,String(game.weaponState.reserve));
});
test('entering practice Loadout clears held FIRE and confirmation explains retained XP',t=>{
  const {context,game,$} = fixture(t);game.tryStartRange('mp5');game.input.fire=true;
  context.document.querySelector=()=>({textContent:''});
  Object.assign(context,{input:game.input,invalidatePowerMenu(){},resetPowerSession(){},equipmentUI:{close(){}},renderTeamMap(){},renderProgression(){},mapSession:null,updateUI:null});
  const setMode=controller('setMode',context);context.setMode=setMode;context.document.body={dataset:{}};
  setMode('armory');assert.equal(game.input.fire,false);assert.equal(game.active,false);assert.equal(game.input.enabled,false);
  Object.assign(context,{sessionToken:()=>game.modeState,showHome(){}});
  controller('requestHome',context)();
  assert.equal($('confirm-home-title').textContent,'END PRACTICE?');assert.match($('confirm-home-message').textContent,/keep earned XP/);
  assert.equal(context.document.activeElement,$('cancel-home'));
});
test('practice HUD tolerates older DOM fixtures without optional statistics nodes',t=>{
  const {document,$,elements} = fixture(t),original=document.getElementById;
  document.getElementById=id=>id.startsWith('range-')?null:original(id);
  renderMatchHud(range(),'local');assert.equal($('hud-mode').textContent,'Shooting Range');
  assert.equal(elements.has('range-stats'),false);
});

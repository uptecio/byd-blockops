import { runtimeErrors, setRuntimeStop } from './runtime-bootstrap.js';
import * as THREE from 'three';
import { WEAPONS, WEAPON_CLASSES, getWeapon } from './weapons.js';
import { createWeaponModel } from './world.js';
import { ArenaGame, disposeModel } from './game.js';
import { Input } from './input.js';
import { GameAudio } from './audio.js';
import { MultiplayerUI } from './multiplayer-ui.js';
import { HomeUI, validateSelection } from './home-ui.js';
import { getMap } from './maps.js';
import { getSoloMode } from './solo-modes.js';
import { createZombieRecords } from './zombie-records.js';
import { renderMatchHud, renderMatchResults } from './match-ui.js';
import { EquipmentUI } from './equipment-ui.js';
import { createProfileStore } from './profile-store.js';
import { createProgressionSession } from './progression-session.js';
import { createProgressionController } from './progression-controller.js';
import { createProgressionUI } from './progression-ui.js';
import { getGunFinish } from './cosmetics.js';
import { HidingUI } from './hiding-ui.js';
import { renderClimbHint } from './climb-presentation.js';

const $ = id => document.getElementById(id);
let mode = 'home', settingsOrigin = 'home', game, preview, home, multiplayer, equipmentUI, audio, input, toastUntil = 0, confirmation = null;
let backgroundSuspended = false, frameRequest = null;
let progressionUI;
const hidingUI = new HidingUI({ button: $('hide-button'), status: $('hiding-status') });
setRuntimeStop(stopAfterFatal);

function stopAfterFatal() {
  mode = 'fatal'; confirmation = null;
  // Each subsystem gets a shutdown attempt even when another is broken.
  for (const stop of [
    () => cancelAnimationFrame(frameRequest),
    () => input?.setEnabled(false),
    () => game?.pause(),
    () => multiplayer?.client.close(), // Also cancels not-yet-welcomed joins.
    () => multiplayer?.arena?.pause(),
    () => { if (audio) audio.enabled = false; },
  ]) { try { stop(); } catch { /* Preserve the original visible failure. */ } }
}

const storageKey = 'block-ops-v1';
let recordStorage;
try { recordStorage = window.localStorage; } catch { /* The storage getter itself can be denied. */ }
const zombieRecords = createZombieRecords(recordStorage);
const defaults = { sensitivity: 1, controlSize: 1, bots: 5, difficulty: 'normal', sound: true };
let saved = {};
try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch { /* Corrupt/unavailable storage uses defaults. */ }
const rawSettings = saved.settings || {};
const bounded = (value, fallback, min, max) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const settings = {
  sensitivity: bounded(rawSettings.sensitivity, 1, .4, 2),
  controlSize: bounded(rawSettings.controlSize, 1, .8, 1.3),
  bots: Math.round(bounded(rawSettings.bots, 5, 1, 8)),
  difficulty: ['easy', 'normal', 'hard'].includes(rawSettings.difficulty) ? rawSettings.difficulty : 'normal',
  sound: typeof rawSettings.sound === 'boolean' ? rawSettings.sound : true,
};
let selection = validateSelection(saved.selection, saved.weaponId);
const profileStore = createProfileStore({ getStorage: () => window.localStorage, legacySkinId: selection.skinId });
const progressionSession = createProgressionSession(profileStore);
Object.assign(selection, { skinId: profileStore.view().skinId, finishId: profileStore.view().finishId });
const progression = createProgressionController({ store: profileStore, session: progressionSession,
  onChange: view => { Object.assign(selection, { skinId: view.skinId, finishId: view.finishId }); renderProgression(); },
  onDelta: (delta, view) => progressionUI?.notify(delta, view),
});
let selected = getWeapon(selection.weaponId), activeClass = selected.classId;
audio = new GameAudio();
input = new Input(() => pauseGame());
const classNames = { assault: 'ASSAULT', smg: 'SMG', shotgun: 'SHOTGUN', sniper: 'SNIPER', marksman: 'MARKSMAN', lmg: 'LMG', sidearm: 'SIDEARM' };
const traits = { assault: 'Versatile. Reliable. Ready for anything.', smg: 'Fast hands. Close quarters. No hesitation.', shotgun: 'Get close. Make every shot count.', sniper: 'One sightline. One perfect shot.', marksman: 'Precision at your own pace.', lmg: 'Big magazines. Keep the pressure on.', sidearm: 'Travel light. Hit above your weight.' };
function persist() { try { localStorage.setItem(storageKey, JSON.stringify({ weaponId: selection.weaponId, selection, settings })); } catch { /* Play remains available without storage. */ } }
function renderProgression() {
  const connected = multiplayer?.isConnected();
  const own = connected ? multiplayer.room.players.find(player => player.id === multiplayer.client.id) : game?.player;
  progressionUI?.render(profileStore.view(), {
    live: connected ? multiplayer.room.phase === 'playing' : Boolean(game?.hasRound && !game.match.ended),
    modeId: connected ? multiplayer.room.modeId : game?.hasRound ? game.settings.modeId : selection.modeId,
    currentSkinId: own?.skinId || selection.skinId, currentFinishId: own?.finishId || selection.finishId,
  });
}
function setMode(next) {
  if (runtimeErrors.failed) return;
  // A remote start may create/enable an arena while native rendering is
  // suspended. Re-pause it synchronously and retain that state on foreground.
  if (next === 'playing' && (backgroundSuspended || document.hidden)) { backgroundSuspended = true; next = 'paused'; }
  confirmation = null; $('confirm-home-screen').hidden = true;
  mode = next; document.body.dataset.mode = next;
  equipmentUI?.close();
  // Remote starts, results and disconnects replace any locally open settings.
  $('settings-screen').hidden = true;
  $('home-screen').hidden = next !== 'home';
  $('armory').hidden = next !== 'armory';
  $('online-screen').hidden = next !== 'lobby';
  $('game-ui').hidden = !['playing', 'paused', 'results', 'confirm-home', 'grenade-picker'].includes(next);
  $('pause-screen').hidden = next !== 'paused';
  $('results-screen').hidden = next !== 'results';
  const online = multiplayer && multiplayer.isActive();
  document.querySelector('.pause-dialog h2').textContent = online ? 'MATCH STILL LIVE' : 'GAME PAUSED';
  document.querySelector('.pause-dialog .eyebrow').textContent = online ? 'CONTROLS PAUSED' : 'TAKE YOUR TIME';
  document.querySelector('.pause-dialog p').textContent = online ? 'Your controls are paused. The match continues and other players can still move and shoot.' : 'Your round is right where you left it.';
  $('quit-button').textContent = online ? 'Leave room & return Home' : 'End round & return Home';
  input.clear();
  if (next !== 'playing' && game) { if (online) multiplayer.pause(); else game.pause(); }
  renderProgression();
}
function showHome() { progression.retry(); setMode('home'); home.render(); renderProgression(); }
function sessionToken() { return multiplayer?.isConnected() ? multiplayer.arena || multiplayer.room.code : game?.modeState; }
function requestHome(after = showHome) {
  const connected = multiplayer?.isConnected(), liveSolo = game?.hasRound && !game.match.ended;
  if (!connected && multiplayer?.busy) multiplayer.client.close();
  if (!connected && !liveSolo) { input.clear(); after(); return; }
  const origin = mode, token = sessionToken();
  setMode('confirm-home');
  confirmation = { origin, token, after };
  $('confirm-home-title').textContent = connected ? 'LEAVE THIS ROOM?' : 'END THIS ROUND?';
  $('confirm-home-message').textContent = connected ? 'The shared match continues. Host ownership transfers when needed.' : 'Your current solo round will end. Your selections are saved.';
  $('confirm-home-screen').hidden = false;
  $('cancel-home').textContent = origin === 'playing' ? 'KEEP PLAYING' : 'GO BACK';
  $('cancel-home').focus({ preventScroll: true });
}
$('confirm-home').addEventListener('click', () => {
  const pending = confirmation;
  if (!pending || pending.token !== sessionToken()) return;
  confirmation = null;
  if (multiplayer?.isConnected()) multiplayer.leave(); else game.quit();
  input.clear(); pending.after();
});
$('cancel-home').addEventListener('click', () => {
  const pending = confirmation;
  if (!pending || pending.token !== sessionToken()) return;
  confirmation = null;
  if (pending.origin === 'playing') {
    if (multiplayer?.isConnected()) { if (multiplayer.room.phase !== 'playing') return; multiplayer.resume(); }
    else { if (!game.hasRound || game.match.ended) return; game.resume(); }
  }
  setMode(pending.origin);
});
for (const id of ['home-button', 'pause-home', 'armory-home', 'results-home', 'quit-button']) $(id).addEventListener('click', () => requestHome());
function selectConfiguration(next) {
  const apply = () => {
    const before = { skinId: selection.skinId, finishId: selection.finishId };
    const result = progression.equip({ skinId: next.skinId ?? selection.skinId, finishId: next.finishId ?? selection.finishId });
    if (!result.ok) { renderProgression(); return result; }
    const profile = profileStore.view();
    selection = { ...validateSelection(next), skinId: profile.skinId, finishId: profile.finishId };
    if (mode !== 'armory') selected = getWeapon(selection.weaponId);
    if (game) game.setPendingAppearance({ skinId: selection.skinId, finishId: selection.finishId });
    if (multiplayer?.isConnected()) {
      if (before.skinId !== selection.skinId) multiplayer.client.send({ type: 'skin', skinId: selection.skinId });
      if (before.finishId !== selection.finishId) multiplayer.client.send({ type: 'finish', finishId: selection.finishId });
    }
    persist(); home.render(); renderSelected(); renderProgression();
    return result;
  };
  if (game?.hasRound && !game.match.ended && !multiplayer?.isConnected() && (next.mapId !== selection.mapId || next.modeId !== selection.modeId)) requestHome(() => { apply(); showHome(); });
  else return apply();
}
function pauseGame() {
  if (mode === 'grenade-picker') { setMode('paused'); $('resume-button').focus({ preventScroll: true }); return; }
  if (mode === 'playing') { setMode('paused'); $('resume-button').focus({ preventScroll: true }); }
}
function suspendForBackground() { if (runtimeErrors.failed) return; backgroundSuspended = true; input.clear(); equipmentUI?.close(); if (mode === 'grenade-picker') setMode('paused'); else pauseGame(); }
window.pauseGame = suspendForBackground;
document.addEventListener('visibilitychange', () => { if (document.hidden) suspendForBackground(); else { progression.retry(); renderProgression(); } });
window.addEventListener('focus', () => { progression.retry(); renderProgression(); });
window.addEventListener('blur', suspendForBackground);

function silhouette(weapon) {
  const colour = '#' + weapon.colour.toString(16).padStart(6, '0');
  const pistol = weapon.classId === 'sidearm', bullpup = ['famas', 'p90', 'vector'].includes(weapon.id);
  const heavy = weapon.classId === 'lmg';
  const barrel = ['sniper', 'marksman', 'shotgun'].includes(weapon.classId) ? 200 : pistol ? 125 : 174;
  const scope = ['sniper', 'marksman'].includes(weapon.classId);
  return `<svg viewBox="0 0 240 80" aria-hidden="true"><g transform="rotate(-8 120 40)"><path d="M${pistol ? 65 : 48} 30H145V48H${pistol ? 65 : 48}Z" fill="#84929b"/><path d="M65 31H139V41H65Z" fill="${colour}"/><path d="M135 34H${barrel}V41H135Z" fill="#596a78"/><path d="M${barrel - 5} 32H${barrel + 10}V43H${barrel - 5}Z" fill="#7e8c95"/><path d="M${pistol ? 74 : 87} 43L${pistol ? 70 : 80} 64H${pistol ? 91 : 96}L${pistol ? 100 : 105} 44Z" fill="#495b69"/>${!pistol ? `<path d="M48 34H20L12 55H29L51 43Z" fill="${colour}"/><path d="M${bullpup ? 53 : 110} 45V${heavy ? 66 : 62}H${bullpup ? 70 : heavy ? 139 : 125}V45Z" fill="#607483"/>` : ''}${scope ? '<path d="M80 21H137V29H80Z" fill="#4b5c68"/><path d="M78 17H93V31H78ZM127 16H144V32H127Z" fill="#8ba0aa"/>' : '<path d="M91 26H116V31H91Z" fill="#5c7180"/>'}<path d="M61 30V26H68V30" fill="#a8bdc7"/></g></svg>`;
}
function renderTabs() {
  $('class-tabs').innerHTML = WEAPON_CLASSES.map(item => `<button class="class-tab ${item.id === activeClass ? 'active' : ''}" data-class="${item.id}" aria-pressed="${item.id === activeClass}">${classNames[item.id]}</button>`).join('');
  $('class-description').textContent = WEAPON_CLASSES.find(item => item.id === activeClass).label.toUpperCase();
  $('weapon-grid').innerHTML = WEAPONS.filter(weapon => weapon.classId === activeClass).map(weapon => `<button class="weapon-card ${weapon.id === selected.id ? 'selected' : ''}" data-weapon="${weapon.id}" aria-pressed="${weapon.id === selected.id}" aria-label="Equip ${weapon.name}">${silhouette(weapon)}<span class="weapon-name">${weapon.name}</span><span class="weapon-type">${weapon.automatic ? 'AUTOMATIC' : 'SEMI / SINGLE'} · ${weapon.magazine} ROUNDS</span><span class="selection-indicator">✓</span></button>`).join('');
}
function renderSelected() {
  $('selected-name').textContent = selected.name;
  $('selected-class').textContent = classNames[selected.classId];
  $('selected-description').textContent = traits[selected.classId];
  document.querySelector('.loadout-number').textContent = String(WEAPONS.indexOf(selected) + 1).padStart(2, '0');
  const power = Math.min(100, Math.round(selected.damage * Math.sqrt(selected.pellets)));
  const rate = Math.min(100, Math.round(.05 / selected.fireInterval * 100));
  const accuracy = Math.round(Math.max(10, 100 - selected.spread * 600));
  $('weapon-stats').innerHTML = [['POWER', power], ['FIRE RATE', rate], ['ACCURACY', accuracy]].map(([label, amount]) => `<div><div class="stat-label"><span>${label}</span><span>${amount}</span></div><div class="stat-track"><i style="width:${amount}%"></i></div></div>`).join('') + `<div class="gun-meta"><span><b>${selected.magazine}</b> MAG</span><span><b>${selected.magazine + selected.reserve}</b> TOTAL</span><span><b>${selected.reloadTime.toFixed(1)}s</b> RELOAD</span><span><b>${Math.round(60 / selected.fireInterval)}</b> RPM</span></div>`;
  renderTabs();
  if (preview) preview.equip(selected, { finishId: selection.finishId });
}
$('class-tabs').addEventListener('click', event => { const button = event.target.closest('[data-class]'); if (button) { activeClass = button.dataset.class; renderTabs(); } });
$('weapon-grid').addEventListener('click', event => {
  const button = event.target.closest('[data-weapon]'); if (!button) return;
  selected = getWeapon(button.dataset.weapon);
  if (equipmentView().roundId) equipmentUI.previewGun(selected.id);
  else { selection.weaponId = selected.id; multiplayer?.setLoadout(selected.id); persist(); }
  renderSelected(); equipmentUI?.render(); renderArmorySession();
});
function equipmentView() {
  const online = multiplayer?.isActive(), live = online ? multiplayer.room.phase === 'playing' : game?.hasRound && !game.match.ended;
  if (!live) return { owned: [], grenades: { frag: 0, smoke: 0, flash: 0 }, selectedGrenade: 'frag', alive: false, roundId: null };
  return { ...(online ? multiplayer.arena.getEquipmentView() : game.getEquipmentView()), health: game.player.health, armour: game.player.armour, lifeId: game.player.lifeId, roundId: online ? multiplayer.arena : game.modeState, alive: game.player.health > 0 && game.player.dead <= 0 };
}
function showArmory() {
  setMode('armory'); selected = getWeapon(equipmentView().activeGunId || selection.weaponId); activeClass = selected.classId; renderSelected(); equipmentUI?.render();
  renderArmorySession();
}
function renderArmorySession() {
  const mapId = multiplayer?.isConnected() ? multiplayer.room.mapId : selection.mapId;
  const modeId = multiplayer?.isConnected() ? multiplayer.room.modeId : selection.modeId;
  const zombies = modeId === 'zombies', modeInfo = getSoloMode(modeId);
  $('armory-map').textContent = getMap(mapId).name.toUpperCase();
  $('armory-mode').textContent = `${modeInfo.name.toUpperCase()} · ${multiplayer?.isConnected() ? 'ONLINE FRIENDS' : zombies ? 'SOLO ONLY' : 'SOLO VS BOTS'}`;
  $('session-target').textContent = zombies ? 'SURVIVE WAVES' : `${modeInfo.scoreLimit} ${modeId === 'ctf' ? 'CAPTURES' : modeId === 'tdm' ? 'TEAM KILLS' : 'ELIMINATIONS'}`;
  $('session-duration').textContent = zombies ? 'ENDLESS' : '3 MIN';
  $('session-duration-label').textContent = zombies ? 'WAVE SURVIVAL' : 'QUICK ROUNDS';
  $('bot-count-label').textContent = zombies ? 'WALKERS + RUNNERS' : `${settings.bots} BOT${settings.bots === 1 ? '' : 'S'}`;
  $('play-button').innerHTML = multiplayer && multiplayer.isConnected() ? (multiplayer.room.phase === 'playing' ? 'RETURN TO MATCH <span>↗</span>' : 'BACK TO ROOM <span>↗</span>') : game && game.hasRound && !game.match.ended ? 'RETURN TO MATCH <span>↗</span>' : 'DEPLOY <span>↗</span>';
  if (equipmentUI?.currentSelection()) $('play-button').innerHTML = 'EQUIP & RETURN <span>↗</span>';
}
function deploy(forceNew = false) {
  if (!game || runtimeErrors.failed) return;
  if (multiplayer && multiplayer.isConnected()) {
    if (equipmentUI.currentSelection()) equipmentUI.confirmGun(); else multiplayer.deploy();
    document.activeElement.blur(); return;
  }
  audio.unlock();
  if (forceNew || !game.hasRound || game.match.ended) {
    // Explicit foreground deployment authorizes a NEW solo round, not a
    // resumed/remote one. Background clicks retain the Resume requirement.
    if (!document.hidden && document.hasFocus()) backgroundSuspended = false;
    const started = game.tryStart(selection.weaponId, { ...settings, ...selection });
    if (!started.ok) { showHome(); game.events.onToast(`Could not start this map: ${started.reason}`); return; }
  }
  else { const result = equipmentUI.confirmGun(); if (result && !result.ok) return; game.resume(); }
  setMode('playing'); game.events.onHud(game); document.activeElement.blur();
}
$('play-button').addEventListener('click', () => deploy());
$('again-button').addEventListener('click', () => { if (multiplayer && multiplayer.isConnected()) multiplayer.open(); else deploy(true); });
$('pause-button').addEventListener('click', pauseGame);
$('resume-button').addEventListener('click', () => {
  if (document.hidden) { suspendForBackground(); return; }
  backgroundSuspended = false;
  audio.unlock(); if (multiplayer && multiplayer.isActive()) multiplayer.resume(); else game.resume(); setMode('playing'); document.activeElement.blur();
});
for (const id of ['loadout-button', 'pause-loadout', 'results-loadout']) $(id).addEventListener('click', showArmory);
function updateSettings() {
  audio.enabled = settings.sound;
  $('game-ui').style.setProperty('--control-scale', settings.controlSize);
  $('bot-count-label').textContent = `${settings.bots} BOT${settings.bots === 1 ? '' : 'S'}`;
  if (game) game.settings.sensitivity = settings.sensitivity;
  $('sensitivity-value').textContent = settings.sensitivity.toFixed(1) + '×';
  $('control-size-value').textContent = Math.round(settings.controlSize * 100) + '%';
  $('bots-value').textContent = settings.bots;
  $('sensitivity').value = settings.sensitivity; $('control-size').value = settings.controlSize;
  $('bots').value = settings.bots; $('difficulty').value = settings.difficulty; $('sound').checked = settings.sound;
}
function openSettings() { settingsOrigin = mode; pauseGame(); $('settings-screen').hidden = false; updateSettings(); }
function closeSettings() { $('settings-screen').hidden = true; if (settingsOrigin === 'armory') showArmory(); }
document.querySelectorAll('.settings-open').forEach(button => button.addEventListener('click', openSettings));
$('close-settings').addEventListener('click', closeSettings); $('settings-done').addEventListener('click', closeSettings);
for (const [id, key] of [['sensitivity', 'sensitivity'], ['control-size', 'controlSize'], ['bots', 'bots']]) $(id).addEventListener('input', () => { settings[key] = Number($(id).value); updateSettings(); persist(); });
$('difficulty').addEventListener('change', () => { settings.difficulty = $('difficulty').value; persist(); });
$('sound').addEventListener('change', () => { settings.sound = $('sound').checked; updateSettings(); persist(); if (settings.sound) audio.unlock(); });

class WeaponPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene(); this.scene.add(new THREE.HemisphereLight('#e1f7ff', '#32445b', 3));
    const light = new THREE.DirectionalLight('#fff7d1', 3.5); light.position.set(-2, 5, 3); this.scene.add(light);
    this.camera = new THREE.PerspectiveCamera(34, 1, .01, 20); this.camera.position.set(0, .18, 1.65); this.camera.lookAt(0, 0, 0);
    this.pivot = new THREE.Group(); this.scene.add(this.pivot);
    this.equip(selected, { finishId: selection.finishId });
  }
  equip(weapon, { finishId = 'standard' } = {}) {
    disposeModel(this.model); this.model = createWeaponModel(THREE, weapon, { finishId });
    this.canvas.setAttribute('aria-label', `${weapon.name} · ${getGunFinish(finishId).name} finish`);
    const bounds = new THREE.Box3().setFromObject(this.model), centre = bounds.getCenter(new THREE.Vector3());
    this.model.position.sub(centre); this.pivot.add(this.model);
    const size = bounds.getSize(new THREE.Vector3());
    this.pivot.scale.setScalar(1 / Math.max(size.x, size.z, .55));
  }
  render(time) {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (w !== this.width || h !== this.height) { this.width = w; this.height = h; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
    this.pivot.rotation.set(-.13, -1.15 + Math.sin(time * .35) * .13, -.14);
    this.renderer.render(this.scene, this.camera);
  }
}
function onHud(current) {
  equipmentUI?.render();
  renderProgression();
  const recovery = current.getMatchView()?.survival?.phase === 'recovery';
  $('fire-button').disabled = $('fire-button').disabled || recovery;
  $('throw-button').disabled = $('throw-button').disabled || recovery;
  const hiding = (multiplayer?.isActive() ? multiplayer.arena : current).getHidingView?.();
  hidingUI.render(hiding);
  renderClimbHint($('climb-hint'), current.getClimbView());
  // Raw attacks are also exit controls; runtime resource/supply gates still decide whether they fire.
  if ((hiding?.hidden || hiding?.pending) && current.player.health > 0 && current.player.dead <= 0) {
    $('fire-button').disabled = false; $('throw-button').disabled = false;
  }
  renderMatchHud(current.getMatchView(), multiplayer?.isActive() ? multiplayer.client.id : 'local');
  $('health-count').textContent = Math.ceil(current.player.health);
  $('health-bar').style.width = `${current.player.health}%`;
  $('health-bar').style.background = current.player.health < 30 ? '#ff7665' : '#46ec88';
  $('armour-count').textContent = Math.ceil(current.player.armour || 0);
  $('armour-bar').style.width = `${current.player.armour || 0}%`;
  $('hud-weapon').textContent = current.weapon.name;
  $('ammo-count').textContent = current.weaponState.ammo;
  $('reserve-count').textContent = current.weaponState.reserve;
  $('reload-status').textContent = recovery ? 'GET READY · ATTACKS PAUSED' : current.weaponState.reloadRemaining > 0 ? `RELOADING ${current.weaponState.reloadRemaining.toFixed(1)}s` : current.weaponState.ammo === 0 ? 'TAP RELOAD' : '';
  $('hit-marker').style.opacity = current.hitFlash > 0 ? 1 : 0;
  $('damage-flash').style.opacity = Math.min(1, current.damageFlash * 4);
  $('scope-overlay').hidden = !(input.zoom && current.heldItem === 'gun' && current.weapon.classId === 'sniper');
  $('zoom-button').classList.toggle('active', input.zoom);
  $('respawn-banner').hidden = current.player.dead <= 0;
  $('respawn-count').textContent = Math.ceil(current.player.dead);
  if (performance.now() > toastUntil) $('toast').textContent = '';
}
function showFatal(error) { runtimeErrors.report(error); }
renderSelected(); updateSettings();
try {
  game = new ArenaGame($('arena'), input, audio, {
    onHud,
    onEnd: () => { renderMatchResults(game.getMatchView(), 'local', { best:zombieRecords.best(game.settings.mapId) }); progressionUI?.renderResults(progressionSession.summary(), profileStore.view()); setMode('results'); },
    onProgression: event => progression.solo(event),
    onSurvivalRecord: ({ mapId,waves,kills }) => zombieRecords.record(mapId,{ waves,kills }),
    onToast: message => { $('toast').textContent = message; toastUntil = performance.now() + 1900; },
    onFatal: showFatal,
  });
  multiplayer = new MultiplayerUI({ getGame: () => game, getSettings: () => settings, getSelected: () => selected, getSelection: () => selection, onSkin: skinId => selectConfiguration({ ...selection, skinId }), onConfiguration: next => { selection = { ...validateSelection({ ...selection, ...next }), finishId: selection.finishId }; persist(); home.render(); renderProgression(); }, onRoomSettings: () => { if (mode === 'armory') renderArmorySession(); }, onRemoteStart: () => { if (backgroundSuspended || document.hidden) setMode('paused'); }, onHome: requestHome, onMode: setMode, onLoadout: showArmory, onToast: message => { $('toast').textContent = message; toastUntil = performance.now() + 1900; },
    onProgressionRoom: (room, client) => { progression.room(room, client); renderProgression(); },
    onProgressionStop: () => progression.stop(),
    onResults: () => progressionUI?.renderResults(progressionSession.summary(), profileStore.view()),
  });
  multiplayer.client.onHideResult = result => multiplayer.arena?.receiveHideResult(result);
  equipmentUI = new EquipmentUI({ getView: equipmentView,
    canSelectInventory: () => mode === 'playing' && input.enabled && !backgroundSuspended && !document.hidden,
    onAction: action => multiplayer?.isActive() ? action.kind === 'equip-gun' && mode === 'armory'
      ? multiplayer.deploy({ equipWeaponId: action.weaponId, source: action.source }) : multiplayer.arena.requestEquipment(action) : game.requestEquipment(action),
    onPicker: open => { input.clear(); setMode(open ? 'grenade-picker' : 'paused'); },
    onToast: message => { $('toast').textContent = message; toastUntil = performance.now() + 1900; } });
  game.events.onEquipmentPicker = () => equipmentUI.openPicker();
  $('grenade-picker-resume').addEventListener('click', () => {
    if (document.hidden) { suspendForBackground(); return; } backgroundSuspended = false;
    audio.unlock(); if (multiplayer?.isActive()) multiplayer.resume(); else game.resume(); setMode('playing');
  });
  $('armory-cancel').addEventListener('click', () => { equipmentUI.close(); if (equipmentView().roundId) setMode('paused'); else if (multiplayer?.isConnected()) multiplayer.open(); else showHome(); });
  home = new HomeUI({ getSelection: () => selection, onSelection: selectConfiguration, onSolo: () => deploy(), onOnline: () => multiplayer.open(), onArmory: showArmory, onSettings: openSettings });
  progressionUI = createProgressionUI({ document, onEquip: patch => selectConfiguration({ ...selection, ...patch }) });
  renderProgression();
  preview = new WeaponPreview($('weapon-preview'));
  let previous = performance.now();
  function frame(now) {
    if (runtimeErrors.failed) return;
    const dt = Math.min(.05, (now - previous) / 1000); previous = now;
    if (!document.hidden) {
      if (multiplayer && multiplayer.isActive()) multiplayer.update(dt);
      else if (mode === 'playing') game.update(dt);
      if (mode === 'armory' && $('settings-screen').hidden) preview.render(now / 1000);
      if (mode === 'armory' || mode === 'grenade-picker') {
        equipmentUI.render();
        const pending = equipmentUI.currentSelection();
        if (pending && selected.id !== pending.weaponId) { selected = getWeapon(pending.weaponId); renderSelected(); }
        renderArmorySession();
      }
      if (mode === 'home' && $('settings-screen').hidden) home.renderPreview(now / 1000);
    }
    if (now > toastUntil) $('toast').textContent = '';
    if (!runtimeErrors.failed) frameRequest = requestAnimationFrame(frame);
  }
  frameRequest = requestAnimationFrame(frame);
} catch (error) { console.error(error); runtimeErrors.report(error, 'Initialisation error'); }

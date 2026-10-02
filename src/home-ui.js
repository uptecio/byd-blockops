import { MAPS, DEFAULT_MAP_ID, getMap } from './maps.js';
import { SKINS, DEFAULT_SKIN_ID, getSkin } from './skins.js';
import { MODES, getMode } from './modes.js';
import { getWeapon } from './weapons.js';
import { CharacterPreview } from './character-preview.js';
import { drawMapPreview } from './map-preview.js';

const $ = id => document.getElementById(id);
export function validateSelection(raw = {}, legacyWeaponId) {
  return {
    mapId: MAPS.some(item => item.id === raw?.mapId) ? raw.mapId : DEFAULT_MAP_ID,
    modeId: MODES.some(item => item.id === raw?.modeId) ? raw.modeId : 'ffa',
    skinId: SKINS.some(item => item.id === raw?.skinId) ? raw.skinId : DEFAULT_SKIN_ID,
    weaponId: getWeapon(raw?.weaponId || legacyWeaponId).id,
  };
}
export class HomeUI {
  constructor({ getSelection, onSelection, onSolo, onOnline, onArmory, onSettings }) {
    this.getSelection = getSelection;
    this.preview = new CharacterPreview($('character-preview'));
    $('map-grid').innerHTML = MAPS.map(map => `<button class="map-card" data-map="${map.id}" aria-pressed="false"><canvas aria-label="${map.name} map layout"></canvas><span>${map.name}</span></button>`).join('');
    $('map-grid').querySelectorAll('canvas').forEach(canvas => drawMapPreview(canvas, canvas.closest('button').dataset.map));
    $('mode-grid').innerHTML = MODES.map(item => `<button class="mode-card" data-mode-id="${item.id}" aria-pressed="false"><strong>${item.name}</strong><small>${item.scoreLimit} ${item.id === 'ctf' ? 'CAPTURES' : item.id === 'tdm' ? 'TEAM KILLS' : 'ELIMINATIONS'} · 3 MIN</small></button>`).join('');
    $('skin-grid').innerHTML = SKINS.map(skin => `<button class="skin-card" data-skin="${skin.id}" aria-pressed="false"><span class="skin-swatch" style="--skin-colour:${skin.palette.body};--skin-trim:${skin.palette.trim}"></span><span>${skin.name}</span></button>`).join('');
    for (const [id, attribute, key] of [['map-grid', 'data-map', 'mapId'], ['mode-grid', 'data-mode-id', 'modeId'], ['skin-grid', 'data-skin', 'skinId']]) {
      $(id).addEventListener('click', event => { const button = event.target.closest(`[${attribute}]`); if (button) onSelection({ ...getSelection(), [key]: button.getAttribute(attribute) }); });
    }
    for (const [id, action] of [['home-solo', onSolo], ['home-online', onOnline], ['home-armory', onArmory], ['home-settings', onSettings]]) $(id).addEventListener('click', action);
    this.render();
  }
  render() {
    const selection = this.getSelection(), skin = getSkin(selection.skinId), weapon = getWeapon(selection.weaponId);
    for (const [attribute, key] of [['data-map', 'mapId'], ['data-mode-id', 'modeId'], ['data-skin', 'skinId']]) document.querySelectorAll(`[${attribute}]`).forEach(button => {
      const selected = button.getAttribute(attribute) === selection[key]; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
    });
    $('home-skin-name').textContent = skin.name;
    $('home-weapon-name').textContent = weapon.name;
    $('home-selection').textContent = `${getMap(selection.mapId).name} · ${getMode(selection.modeId).name}`;
    $('home-team').textContent = selection.modeId === 'ffa' ? 'ALL SKINS UNLOCKED' : 'SOLO TEAM / RED';
    const teamId = selection.modeId === 'ffa' ? null : 'red';
    const equipmentKey = `${selection.skinId}:${selection.weaponId}:${teamId}`;
    if (equipmentKey !== this.equipmentKey) { this.preview.equip({ ...selection, teamId }); this.equipmentKey = equipmentKey; }
  }
  renderPreview(time) { this.preview.render(time); }
}

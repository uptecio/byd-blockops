import { getWeapon } from './weapons.js';

const $ = id => document.getElementById(id);
const types = { frag: 'Explosive', smoke: 'Smoke', flash: 'Flash' };

export class EquipmentUI {
  constructor({ getView, onAction, onPicker, onToast }) {
    Object.assign(this, { getView, onAction, onPicker, onToast });
    this.pendingSelection = null; this.tab = 'armory';
    $('equipment-tabs').addEventListener('click', event => {
      const button = event.target.closest('[data-equipment-tab]'); if (!button) return;
      this.tab = button.dataset.equipmentTab; this.render();
    });
    $('carried-guns').addEventListener('click', event => {
      const button = event.target.closest('[data-carried-weapon]'); if (!button) return;
      this.previewGun(button.dataset.carriedWeapon, 'carried'); this.render();
    });
    $('grenade-options').addEventListener('click', event => {
      const button = event.target.closest('[data-grenade-type]'); if (button) this.selectType(button.dataset.grenadeType);
    });
    $('grenade-picker-close').addEventListener('click', () => { this.close(); this.onPicker(false); });
  }
  previewGun(weaponId, source = 'armory') {
    const view = this.getView();
    this.pendingSelection = { weaponId, source: source === 'carried' ? 'inventory' : source, lifeId: view.lifeId, roundId: view.roundId };
  }
  currentSelection(view = this.getView()) {
    const pending = this.pendingSelection;
    if (pending && (pending.lifeId !== view.lifeId || pending.roundId !== view.roundId || view.alive === false)) this.pendingSelection = null;
    return this.pendingSelection;
  }
  confirmGun() {
    const pending = this.currentSelection(); if (!pending) return null;
    const result = this.onAction({ kind: 'equip-gun', weaponId: pending.weaponId, source: pending.source });
    if (result?.ok) this.pendingSelection = null;
    else this.onToast(result?.reason || 'Unable to change equipment');
    this.render(); return result;
  }
  openPicker() {
    this.onPicker(true); $('grenade-picker').hidden = false; this.render();
    const view = this.getView();
    const index = Object.keys(types).indexOf(view.selectedGrenade);
    const options = [...$('grenade-options').children], selected = options[Math.max(0, index)];
    const target = selected && !selected.disabled ? selected : options.find(button => !button.disabled) || $('grenade-picker-resume');
    target.focus({ preventScroll: true });
  }
  selectType(grenadeType) {
    const result = this.onAction({ kind: 'select-grenade', grenadeType });
    if (!result?.ok) this.onToast(result?.reason || 'Unable to select grenade');
    this.render(); return result;
  }
  close() { this.pendingSelection = null; $('grenade-picker').hidden = true; }
  render() {
    const view = this.getView(), pending = this.currentSelection(view), owned = view.owned || [];
    const alive = view.alive !== false, knife = view.heldItem === 'knife';
    $('knife-button').disabled = !alive || !view.knife;
    $('knife-button').setAttribute('aria-pressed', knife);
    $('knife-button').textContent = knife ? 'GUN · Q' : 'KNIFE · Q';
    $('fire-button').querySelector('small').textContent = knife ? 'SLASH' : 'FIRE';
    $('fire-button').setAttribute('aria-label', knife ? 'Slash with knife' : 'Fire weapon');
    $('zoom-button').disabled = $('reload-button').disabled = knife || !alive;
    const counts = view.grenades || { frag: 0, smoke: 0, flash: 0 }, total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    $('grenade-type-button').textContent = `${types[view.selectedGrenade] || 'Explosive'} · ${total}/3`;
    $('grenade-type-button').dataset.full = String(total === 3);
    $('throw-button').textContent = `THROW · ${counts[view.selectedGrenade] || 0}`;
    $('throw-button').disabled = !alive || !counts[view.selectedGrenade] || view.throwRemaining > 0;
    $('fire-button').disabled = !alive || view.attackLockRemaining > 0;
    const grenadeSignature = JSON.stringify([counts, view.selectedGrenade, alive]);
    if (grenadeSignature !== this.grenadeSignature) {
      this.grenadeSignature = grenadeSignature;
      $('grenade-options').textContent = '';
      $('grenade-options').append(...Object.entries(types).map(([id, label]) => {
        const button = document.createElement('button'); button.className = 'secondary'; button.dataset.grenadeType = id;
        button.textContent = `${label} · ${counts[id]}`; button.disabled = !alive || !counts[id]; button.setAttribute('aria-pressed', id === view.selectedGrenade); return button;
      }));
    }
    $('equipment-tabs').hidden = !view.roundId;
    $('carried-guns').hidden = this.tab !== 'carried' || !view.roundId;
    $('armory-guns').hidden = this.tab === 'carried' && !!view.roundId;
    document.querySelectorAll('[data-equipment-tab]').forEach(button => button.setAttribute('aria-pressed', button.dataset.equipmentTab === this.tab));
    const carriedSignature = JSON.stringify([owned, view.activeGunId, pending?.weaponId, alive]);
    if (carriedSignature !== this.carriedSignature) {
      this.carriedSignature = carriedSignature;
      $('carried-guns').textContent = '';
      $('carried-guns').append(...owned.map(gun => {
        const button = document.createElement('button'); button.className = 'carried-gun secondary'; button.dataset.carriedWeapon = gun.weaponId;
        button.textContent = `${getWeapon(gun.weaponId).name} · ${gun.ammo} / ${gun.reserve}${gun.weaponId === view.activeGunId ? ' · ACTIVE' : ''}`;
        button.disabled = !alive; button.setAttribute('aria-pressed', pending?.weaponId === gun.weaponId); return button;
      }));
    }
    const removed = pending?.weaponId === view.startingGunId && view.startingGunRemoved && !owned.some(gun => gun.weaponId === pending.weaponId);
    $('equipment-selection-status').textContent = removed ? 'Find this gun as loot' : pending ? `Selected ${getWeapon(pending.weaponId).name} · confirm to equip` : view.roundId ? 'Choose a gun to equip, or return unchanged.' : 'Choose your starting gun for the next round.';
    document.querySelectorAll('[data-weapon]').forEach(button => {
      const unavailable = button.dataset.weapon === view.startingGunId && view.startingGunRemoved && !owned.some(gun => gun.weaponId === button.dataset.weapon);
      const carried = owned.find(gun => gun.weaponId === button.dataset.weapon);
      button.setAttribute('aria-disabled', unavailable); button.title = unavailable ? 'Find this gun as loot' : carried ? 'Owned · ammunition preserved' : 'Armory · fresh supply';
      if (unavailable) button.querySelector('.weapon-type').textContent = 'Find this gun as loot';
      else if (carried) button.querySelector('.weapon-type').textContent = `CARRIED · ${carried.ammo} / ${carried.reserve}`;
      else {
        const gun = getWeapon(button.dataset.weapon);
        button.querySelector('.weapon-type').textContent = `${gun.automatic ? 'AUTOMATIC' : 'SEMI / SINGLE'} · ${gun.magazine} ROUNDS`;
      }
    });
  }
}

import { getWeapon } from './weapons.js';
import { SUPPLY_TYPES, SUPPLY_NAMES, SUPPLY_BALANCE } from './supplies.js';

const $ = id => document.getElementById(id);
const types = { frag: 'Explosive', smoke: 'Smoke', flash: 'Flash' };

export class EquipmentUI {
  constructor({ getView, onAction, onPicker, onToast, canSelectInventory = () => false, isUnlimitedAmmo = () => false }) {
    Object.assign(this, { getView, onAction, onPicker, onToast, canSelectInventory, isUnlimitedAmmo });
    this.pendingSelection = null; this.tab = 'armory';
    this.inventoryEntries = new Map(); this.inventoryGesture = null;
    const inventory = $('inventory-slots');
    if (inventory) {
      inventory.addEventListener('pointerdown', event => {
        const button = event.target.closest('[data-inventory-key]'); if (!button) return;
        const entry = this.inventoryEntries.get(button.dataset.inventoryKey); if (!entry) return;
        this.inventoryGesture = { button, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
          scrollLeft: inventory.scrollLeft, lifeId: entry.lifeId, roundId: entry.roundId,
          allowed: this.canSelectInventory() && !button.disabled, moved: false, cancelled: false, ended: false };
      });
      const trackGesture = event => {
        const gesture = this.inventoryGesture;
        if (!gesture || event.pointerId !== gesture.pointerId || gesture.cancelled || gesture.ended) return;
        const view = this.getView();
        if (!gesture.allowed || !this.canSelectInventory() || !view.roundId || view.alive === false
          || gesture.lifeId !== view.lifeId || gesture.roundId !== view.roundId) { gesture.cancelled = true; return; }
        const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
        if (dx * dx + dy * dy > 64) gesture.moved = true;
        if (gesture.moved && Math.abs(dx) > 8) inventory.scrollLeft = Math.max(0, gesture.scrollLeft - dx);
        if (inventory.scrollLeft !== gesture.scrollLeft) gesture.moved = true;
      };
      document.addEventListener('pointermove', trackGesture);
      document.addEventListener('pointerup', event => {
        trackGesture(event);
        if (this.inventoryGesture?.pointerId === event.pointerId) this.inventoryGesture.ended = true;
      });
      document.addEventListener('pointercancel', () => { if (this.inventoryGesture) this.inventoryGesture.cancelled = true; });
      inventory.addEventListener('scroll', () => {
        if (this.inventoryGesture && inventory.scrollLeft !== this.inventoryGesture.scrollLeft) this.inventoryGesture.moved = true;
      });
      inventory.addEventListener('click', event => {
        const button = event.target.closest('[data-inventory-key]'); if (!button) return;
        const gesture = event.detail === 0 ? null : this.inventoryGesture; this.inventoryGesture = null;
        this.selectInventory(button, gesture);
      });
    }
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
  close() {
    this.pendingSelection = null; $('grenade-picker').hidden = true;
    if (this.inventoryGesture) this.inventoryGesture.cancelled = true;
  }
  selectInventory(button, gesture) {
    const view = this.getView(), entry = this.inventoryEntries.get(button.dataset.inventoryKey);
    if (!entry || entry.button !== button || button.disabled || !this.canSelectInventory() || !view.roundId || view.alive === false
      || entry.lifeId !== view.lifeId || entry.roundId !== view.roundId) return;
    if (gesture && (gesture.button !== button || !gesture.allowed || gesture.moved || gesture.cancelled
      || gesture.lifeId !== view.lifeId || gesture.roundId !== view.roundId)) return;
    let action;
    if (entry.kind === 'gun' && (view.owned || []).some(gun => gun.weaponId === entry.id))
      action = { kind: 'equip-gun', weaponId: entry.id, source: 'inventory' };
    else if (entry.kind === 'knife' && view.knife) action = { kind: 'held-item', heldItem: 'knife' };
    else if (entry.kind === 'grenade' && view.grenades?.[entry.id] > 0) action = { kind: 'select-grenade', grenadeType: entry.id };
    else if (entry.kind === 'supply' && view.supplies?.[entry.id] > 0)
      action = view.supplyUse?.type === entry.id ? { kind: 'cancel-supply' } : { kind: 'use-supply', supplyType: entry.id };
    if (!action) return;
    const result = this.onAction(action);
    if (!result?.ok) this.onToast(result?.reason || 'Unable to change equipment');
    this.render(); return result;
  }
  renderInventory(view) {
    const inventory = $('inventory-slots'); if (!inventory) return;
    const items = (view.owned || []).map(gun => ({ key: `gun:${gun.weaponId}`, kind: 'gun', id: gun.weaponId,
      name: getWeapon(gun.weaponId).name, count: this.isUnlimitedAmmo() ? '∞' : `${gun.ammo} / ${gun.reserve}`, held: view.heldItem === 'gun' && view.activeGunId === gun.weaponId }));
    if (view.knife) items.push({ key: 'knife', kind: 'knife', name: 'Knife', count: 'x1', held: view.heldItem === 'knife' });
    for (const id of Object.keys(types)) if (view.grenades?.[id] > 0)
      items.push({ key: `grenade:${id}`, kind: 'grenade', id, name: types[id], count: `x${view.grenades[id]}`, throwSelected: view.selectedGrenade === id });
    for (const id of SUPPLY_TYPES) if (view.supplies?.[id] > 0)
      items.push({ key: `supply:${id}`, kind: 'supply', id, name: SUPPLY_NAMES[id], count: `x${view.supplies[id]}`, using: view.supplyUse?.type === id });
    const keys = new Set(items.map(item => item.key)), scrollLeft = inventory.scrollLeft;
    for (const [key, entry] of this.inventoryEntries) if (!keys.has(key)) {
      inventory.removeChild(entry.button); this.inventoryEntries.delete(key);
    }
    const disabled = !this.canSelectInventory() || !view.roundId || view.alive === false;
    const gesture = this.inventoryGesture;
    if (gesture && (disabled || gesture.lifeId !== view.lifeId || gesture.roundId !== view.roundId)) gesture.cancelled = true;
    items.forEach((item, index) => {
      let entry = this.inventoryEntries.get(item.key);
      if (!entry) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'inventory-slot';
        button.dataset.inventoryKey = item.key; button.dataset.inventoryKind = item.kind;
        if (item.kind === 'gun') button.dataset.weaponId = item.id;
        if (item.kind === 'grenade') button.dataset.grenadeType = item.id;
        if (item.kind === 'supply') button.dataset.supplyType = item.id;
        const labels = {};
        for (const name of ['number', 'name', 'count', 'status']) {
          const label = document.createElement('span'); label.className = `inventory-${name}`; labels[name] = label; button.append(label);
        }
        entry = { button, labels }; this.inventoryEntries.set(item.key, entry);
      }
      Object.assign(entry, { kind: item.kind, id: item.id, lifeId: view.lifeId, roundId: view.roundId });
      const { button, labels } = entry, status = item.using ? 'TAP TO CANCEL' : item.held ? 'HELD' : item.throwSelected ? 'THROW' : '';
      for (const [name, text] of Object.entries({ number: String(index + 1), name: item.name, count: item.count, status }))
        if (labels[name].textContent !== text) labels[name].textContent = text;
      labels.status.hidden = !status; button.disabled = disabled;
      button.dataset.held = String(!!item.held); button.dataset.throwSelected = String(!!item.throwSelected);
      button.setAttribute('aria-pressed', !!(item.held || item.throwSelected || item.using));
      button.setAttribute('aria-label', `${index + 1}. ${item.name}, ${item.count}${status ? `, ${status}` : ''}`);
      if (inventory.children[index] !== button) inventory.insertBefore(button, inventory.children[index] || null);
    });
    if (inventory.scrollLeft !== scrollLeft) inventory.scrollLeft = scrollLeft;
  }
  render() {
    const view = this.getView(), pending = this.currentSelection(view), owned = view.owned || [];
    this.renderInventory(view);
    const alive = view.alive !== false, knife = view.heldItem === 'knife', use = alive && view.roundId ? view.supplyUse : null;
    $('supply-use-status').hidden = !use;
    $('supply-use-label').textContent = use ? `${use.type === 'health' ? 'HEALING' : 'ADDING ARMOUR'} · ${use.remaining.toFixed(1)}s · TAP PACK TO CANCEL` : '';
    const progress = use ? Math.max(0, Math.min(100, (1 - use.remaining / SUPPLY_BALANCE.useSeconds) * 100)) : 0;
    $('supply-use-progress').style.width = `${progress}%`;
    $('supply-use-progress').setAttribute('aria-valuenow', Math.round(progress));
    $('knife-button').disabled = !alive || !view.knife;
    $('knife-button').setAttribute('aria-pressed', knife);
    $('knife-button').textContent = knife ? 'GUN · Q' : 'KNIFE · Q';
    $('fire-button').querySelector('small').textContent = knife ? 'SLASH' : 'FIRE';
    $('fire-button').setAttribute('aria-label', knife ? 'Slash with knife' : 'Fire weapon');
    $('zoom-button').disabled = knife || !alive;
    $('reload-button').disabled = knife || !alive || !!use || this.isUnlimitedAmmo();
    const counts = view.grenades || { frag: 0, smoke: 0, flash: 0 }, total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    $('grenade-type-button').textContent = `${types[view.selectedGrenade] || 'Explosive'} · ${total}/3`;
    $('grenade-type-button').dataset.full = String(total === 3);
    $('throw-button').textContent = `THROW · ${counts[view.selectedGrenade] || 0}`;
    $('throw-button').disabled = !alive || !!use || !counts[view.selectedGrenade] || view.throwRemaining > 0;
    $('fire-button').disabled = !alive || !!use || view.attackLockRemaining > 0;
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
    const unlimitedAmmo = this.isUnlimitedAmmo();
    const carriedSignature = JSON.stringify([owned, view.activeGunId, pending?.weaponId, alive, unlimitedAmmo]);
    if (carriedSignature !== this.carriedSignature) {
      this.carriedSignature = carriedSignature;
      $('carried-guns').textContent = '';
      $('carried-guns').append(...owned.map(gun => {
        const button = document.createElement('button'); button.className = 'carried-gun secondary'; button.dataset.carriedWeapon = gun.weaponId;
        button.textContent = `${getWeapon(gun.weaponId).name} · ${unlimitedAmmo ? '∞' : `${gun.ammo} / ${gun.reserve}`}${gun.weaponId === view.activeGunId ? ' · ACTIVE' : ''}`;
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
      else if (carried) button.querySelector('.weapon-type').textContent = `CARRIED · ${unlimitedAmmo ? '∞' : `${carried.ammo} / ${carried.reserve}`}`;
      else {
        const gun = getWeapon(button.dataset.weapon);
        button.querySelector('.weapon-type').textContent = `${gun.automatic ? 'AUTOMATIC' : 'SEMI / SINGLE'} · ${gun.magazine} ROUNDS`;
      }
    });
  }
}

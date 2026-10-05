export const SUPPLY_TYPES = Object.freeze(['health', 'armour']);
export const SUPPLY_BALANCE = Object.freeze({ capacity: 3, useSeconds: 5, armourGain: 50 });
export const SUPPLY_NAMES = Object.freeze({ health: 'Health Pack', armour: 'Armour Pack' });

const denied = reason => ({ ok: false, reason });
const validPool = value => Number.isFinite(value) && value >= 0 && value <= 100;
const validVitals = v => v && validPool(v.health) && validPool(v.armour);
const owns = (e, type) => Number.isInteger(e?.supplies?.[type])
  && e.supplies[type] > 0 && e.supplies[type] <= SUPPLY_BALANCE.capacity;

export function createSupplyState() {
  return { supplies: { health: 0, armour: 0 }, supplyUse: null };
}

export function isUsingSupply(e) {
  return e?.supplyUse != null;
}

export function startSupplyUse(e, vitals, supplyType, { active, alive } = {}) {
  if (!active || !alive || !validVitals(vitals) || vitals.health <= 0) return denied('Cannot use supplies now');
  if (!SUPPLY_TYPES.includes(supplyType) || !owns(e, supplyType)) return denied('Supply not owned');
  if (vitals[supplyType] >= 100) return denied(`${SUPPLY_NAMES[supplyType]} not needed`);
  const gun = e.owned?.get(e.activeGunId);
  if (!gun) return denied('No active equipment');
  if (gun.reloadRemaining > 0 || e.attackLockRemaining > 0 || e.meleeRemaining > 0) return denied('Finish current action first');
  if (e.supplyUse?.type === supplyType) return denied('Already using this supply');
  // A new object lets each runtime distinguish a mid-step start from an existing use.
  e.supplyUse = { type: supplyType, remaining: SUPPLY_BALANCE.useSeconds };
  return { ok: true };
}

export function cancelSupplyUse(e) {
  const changed = isUsingSupply(e);
  e.supplyUse = null;
  return { ok: true, changed };
}

export function advanceSupplyUse(e, vitals, dt, { active, alive } = {}) {
  const use = e.supplyUse;
  if (!use) return { status: 'idle', supplyType: null };
  const result = status => ({ status, supplyType: use.type });
  const cancel = () => { cancelSupplyUse(e); return result('cancelled'); };
  if (!active || !alive || !validVitals(vitals) || vitals.health <= 0 || !owns(e, use.type)) return cancel();
  if (!Number.isFinite(dt) || dt <= 0) return result('pending');
  use.remaining -= dt;
  // Covers accumulated binary rounding only (100 × .05), never a perceptible early use.
  if (use.remaining > 1e-10) return result('pending');
  if (vitals[use.type] >= 100) return cancel();
  if (use.type === 'health') vitals.health = 100;
  else vitals.armour = Math.min(100, vitals.armour + SUPPLY_BALANCE.armourGain);
  e.supplies[use.type] -= 1;
  e.supplyUse = null;
  return result('completed');
}

export function chooseBotSupply(actor) {
  if (!actor?.alive || actor.health <= 0 || actor.flashRemaining > 0 || isUsingSupply(actor.equipment)) return null;
  if (actor.health <= 50 && owns(actor.equipment, 'health')) return 'health';
  if (actor.armour <= 50 && owns(actor.equipment, 'armour')) return 'armour';
  return null;
}

import { getWeapon, TOTAL_AMMO } from './weapons.js';

const fields = ['invincible', 'unlimitedAmmo', 'superSpeed', 'speedMultiplier'];

export function defaultSoloPowers() {
  return { invincible:false, unlimitedAmmo:false, superSpeed:false, speedMultiplier:2 };
}

export function normalizeSoloPowers(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Reflect.ownKeys(value).length !== fields.length
      || !fields.every(key => Object.prototype.hasOwnProperty.call(value, key))) return null;
    const { invincible, unlimitedAmmo, superSpeed, speedMultiplier } = value;
    if ([invincible, unlimitedAmmo, superSpeed].some(flag => typeof flag !== 'boolean')
      || !Number.isFinite(speedMultiplier) || speedMultiplier < 2 || speedMultiplier > 5) return null;
    return { invincible, unlimitedAmmo, superSpeed, speedMultiplier:Math.round(speedMultiplier * 10) / 10 };
  } catch { return null; }
}

// Existing valid weapon state only. Power/solo checks belong to the arena;
// neither shared weapon definitions nor the finite equipment schema change.
export function replenishPoweredMagazine(state) {
  const { magazine } = getWeapon(state.weaponId);
  state.ammo = magazine;
  state.reserve = Math.min(state.reserve, TOTAL_AMMO - magazine);
  state.reloadRemaining = 0;
}

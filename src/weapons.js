// Fictional arena balance: spread/recoil are radians, timers are seconds,
// damage is per pellet, and zoom is the aim magnification multiplier.
export const WEAPON_CLASSES = [
  { id: 'assault', label: 'Assault Rifles', description: 'Flexible mid-range rifles with steady automatic fire.' },
  { id: 'smg', label: 'SMGs', description: 'Fast close-range weapons with light damage and lively handling.' },
  { id: 'shotgun', label: 'Shotguns', description: 'Heavy pellet bursts for tight courtyard fights.' },
  { id: 'sniper', label: 'Sniper Rifles', description: 'Precise long-range shots with slow follow-up fire.' },
  { id: 'marksman', label: 'Marksman Rifles', description: 'Accurate semi-automatic rifles rewarding measured aim.' },
  { id: 'lmg', label: 'LMGs', description: 'Large magazines and sustained fire with longer reloads.' },
  { id: 'sidearm', label: 'Sidearms', description: 'Compact semi-automatic weapons with distinct stopping power.' },
];

export const TOTAL_AMMO = 500;

function weapon(id, name, classId, damage, magazine, fireInterval, reloadTime, spread, pellets, range, automatic, colour, recoil, zoom) {
  const reserve = TOTAL_AMMO - magazine;
  return Object.freeze({ id, name, classId, damage, magazine, reserve, fireInterval, reloadTime, spread, pellets, range, automatic, colour, recoil, zoom });
}

export const WEAPONS = [
  weapon('ak47', 'AK-47', 'assault', 29, 30, 0.12, 2.3, 0.021, 1, 65, true, 0xd98a53, 0.033, 1.45),
  weapon('m4a1', 'M4A1', 'assault', 24, 30, 0.095, 2.0, 0.014, 1, 65, true, 0x83cadc, 0.021, 1.45),
  weapon('scar', 'SCAR-H', 'assault', 35, 20, 0.15, 2.4, 0.016, 1, 75, true, 0xe6c882, 0.038, 1.6),
  weapon('famas', 'FAMAS', 'assault', 21, 25, 0.075, 2.2, 0.024, 1, 55, true, 0xafd8b4, 0.024, 1.4),
  weapon('mp5', 'MP5', 'smg', 20, 30, 0.075, 1.7, 0.025, 1, 42, true, 0x74c6c0, 0.018, 1.3),
  weapon('mp7', 'MP7', 'smg', 18, 40, 0.065, 1.8, 0.029, 1, 38, true, 0x9cbded, 0.016, 1.25),
  weapon('p90', 'P90', 'smg', 17, 50, 0.07, 2.3, 0.027, 1, 40, true, 0xe7bf69, 0.017, 1.3),
  weapon('vector', 'Vector', 'smg', 19, 25, 0.05, 1.9, 0.032, 1, 32, true, 0xe49dc4, 0.021, 1.25),
  weapon('m870', 'M870', 'shotgun', 13, 6, 0.9, 2.7, 0.09, 8, 28, false, 0xc38360, 0.062, 1.2),
  weapon('spas12', 'SPAS-12', 'shotgun', 11, 8, 0.65, 2.9, 0.095, 8, 27, false, 0x849baa, 0.058, 1.2),
  weapon('aa12', 'AA-12', 'shotgun', 9, 12, 0.3, 3.2, 0.115, 7, 24, true, 0xb7d598, 0.047, 1.15),
  weapon('doublebarrel', 'Double Barrel', 'shotgun', 14, 2, 0.24, 1.9, 0.125, 9, 25, false, 0xe9a179, 0.081, 1.15),
  weapon('awp', 'AWP', 'sniper', 100, 5, 1.4, 3.0, 0.002, 1, 140, false, 0x97c789, 0.083, 3.2),
  weapon('scout', 'Scout', 'sniper', 75, 10, 0.95, 2.3, 0.003, 1, 115, false, 0x88cddc, 0.052, 2.8),
  weapon('barrett', 'Barrett .50', 'sniper', 110, 5, 1.65, 3.6, 0.003, 1, 150, false, 0xd0c08c, 0.102, 3.4),
  weapon('l96', 'L96', 'sniper', 95, 6, 1.25, 2.8, 0.0015, 1, 135, false, 0xb0afd9, 0.072, 3.1),
  weapon('sks', 'SKS', 'marksman', 43, 10, 0.3, 2.1, 0.008, 1, 85, false, 0xd89f6e, 0.035, 2.0),
  weapon('mk14', 'MK14', 'marksman', 40, 20, 0.24, 2.5, 0.011, 1, 85, false, 0x84b8a7, 0.04, 2.0),
  weapon('svd', 'SVD', 'marksman', 55, 10, 0.42, 2.6, 0.006, 1, 100, false, 0xce967b, 0.045, 2.4),
  weapon('fal', 'FAL', 'marksman', 37, 20, 0.21, 2.3, 0.014, 1, 75, false, 0xc4d596, 0.037, 1.8),
  weapon('m249', 'M249', 'lmg', 23, 80, 0.085, 4.8, 0.033, 1, 65, true, 0xa4bb87, 0.029, 1.4),
  weapon('pkm', 'PKM', 'lmg', 31, 60, 0.12, 4.4, 0.037, 1, 75, true, 0xd1a16d, 0.042, 1.5),
  weapon('rpk', 'RPK', 'lmg', 27, 45, 0.115, 3.1, 0.026, 1, 70, true, 0xbb8666, 0.033, 1.5),
  weapon('mg42', 'MG42', 'lmg', 20, 100, 0.055, 5.3, 0.046, 1, 60, true, 0x9baaba, 0.039, 1.35),
  weapon('g17', 'G17', 'sidearm', 23, 17, 0.19, 1.3, 0.02, 1, 40, false, 0x87bce7, 0.023, 1.3),
  weapon('m1911', 'M1911', 'sidearm', 34, 8, 0.26, 1.5, 0.018, 1, 45, false, 0xd6b393, 0.034, 1.35),
  weapon('deagle', 'Desert Eagle', 'sidearm', 55, 7, 0.4, 1.8, 0.023, 1, 55, false, 0xe9c879, 0.063, 1.4),
  weapon('revolver', 'Revolver', 'sidearm', 60, 6, 0.48, 2.4, 0.012, 1, 60, false, 0xc0cbd4, 0.057, 1.5),
  weapon('minigun', 'Minigun', 'lmg', 12, 200, 1 / 30, 5.5, 0.065, 1, 55, true, 0xa9b9c3, 0.016, 1.2),
];

const weaponsById = new Map(WEAPONS.map(item => [item.id, item]));

export function getWeapon(id) {
  return weaponsById.get(id) || weaponsById.get('m4a1');
}

export function createWeaponState(id) {
  const selected = getWeapon(id);
  return { weaponId: selected.id, ammo: selected.magazine, reserve: selected.reserve, cooldown: 0, reloadRemaining: 0 };
}

export function tickWeapon(state, dt) {
  if (!Number.isFinite(dt) || dt <= 0) return;
  state.cooldown = Math.max(0, state.cooldown - dt);
  // Only a transition from an active reload can transfer ammunition. An
  // oversized frame or a later idle tick therefore cannot reload twice.
  if (state.reloadRemaining > 0) {
    state.reloadRemaining = Math.max(0, state.reloadRemaining - dt);
    if (state.reloadRemaining === 0) {
      const selected = getWeapon(state.weaponId);
      const transfer = Math.min(selected.magazine - state.ammo, state.reserve);
      state.ammo += transfer;
      state.reserve -= transfer;
    }
  }
}

export function tryFire(state) {
  if (state.reloadRemaining > 0 || state.cooldown > 0 || state.ammo <= 0) return false;
  state.ammo -= 1;
  state.cooldown = getWeapon(state.weaponId).fireInterval;
  return true;
}

export function startReload(state) {
  const selected = getWeapon(state.weaponId);
  if (state.reloadRemaining > 0 || state.ammo >= selected.magazine || state.reserve <= 0) return false;
  state.reloadRemaining = selected.reloadTime;
  return true;
}

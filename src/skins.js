// Bundled, texture-free cosmetics. Combat properties belong to the runtime.
import { EXTRA_SKINS } from './cosmetics.js';
function skin(id, name, description, colours, headgear, accessory) {
  const [body, trim, face, visor, boots] = colours;
  return Object.freeze({ id, name, description,
    palette: Object.freeze({ body, trim, face, visor, boots }), headgear, accessory });
}

export const DEFAULT_SKIN_ID = 'ranger';
export const SKINS = Object.freeze([
  skin('ranger', 'Ranger', 'Olive field armour, a patrol helmet and utility pouches.',
    ['#648452', '#cad4a1', '#e3b58d', '#152c34', '#304135'], 'patrol-helmet', 'utility-pouches'),
  skin('desert-ops', 'Desert Ops', 'Sand gear with a wrapped headscarf and water flask.',
    ['#c9a46c', '#f3dcaa', '#b98161', '#533e30', '#765b3d'], 'headscarf', 'water-flask'),
  skin('arctic-scout', 'Arctic Scout', 'White winter gear, a fur-lined hood and bedroll.',
    ['#e4edf1', '#87bace', '#edc6a5', '#275775', '#4f667d'], 'winter-hood', 'bedroll'),
  skin('jungle-scout', 'Jungle Scout', 'Deep green fatigues, a wide field hat and radio.',
    ['#356c49', '#8fb266', '#ad7659', '#223c29', '#263d2b'], 'field-hat', 'radio'),
  skin('neon-runner', 'Neon Runner', 'Violet street gear, bright headphones and light strips.',
    ['#7d4daf', '#f5a342', '#cc9374', '#69e9ed', '#372d56'], 'headphones', 'light-strips'),
  skin('shadow-ninja', 'Shadow Ninja', 'Dark wraps, a tied hood and a compact waist sash.',
    ['#303445', '#949bb6', '#b58268', '#e7d5a3', '#1b2230'], 'tied-hood', 'waist-sash'),
  skin('robo-unit', 'Robo Unit', 'Steel plating, a sensor antenna and a power pack.',
    ['#7c94a6', '#f1ce62', '#afc1cc', '#67e5b3', '#405260'], 'sensor-antenna', 'power-pack'),
  skin('space-guard', 'Space Guard', 'Orange pressure armour, a sealed helmet and air tanks.',
    ['#d98045', '#eee8d4', '#ddd7ca', '#6ed3ec', '#514a48'], 'sealed-helmet', 'air-tanks'),
  ...EXTRA_SKINS,
]);

const skinsById = new Map(SKINS.map(item => [item.id, item]));
export function getSkin(id) {
  const selected = skinsById.get(id);
  if (!selected) throw new RangeError(`Unknown skin: ${String(id)}`);
  return selected;
}

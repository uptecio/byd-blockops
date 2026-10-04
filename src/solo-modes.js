import { MODES } from './modes.js';

// Presentation-only catalog. The shared server protocol remains three modes.
export const SOLO_MODES = Object.freeze([...MODES,
  Object.freeze({ id:'zombies', name:'Zombie Survival', soloOnly:true }),
]);
export function getSoloMode(id) {
  const mode = SOLO_MODES.find(mode => mode.id === id);
  if (!mode) throw new RangeError('Unknown solo mode');
  return mode;
}
export function onlineSelection(selection) {
  return { ...selection, modeId:selection.modeId === 'zombies' ? 'ffa' : selection.modeId };
}

// Flat, texture-free appearances reuse the existing avatar parts and gun meshes.
import { REWARDS } from './progression.js';
const rewardName = id => REWARDS.find(r=>r.id===id).name;
function skin(id,colours,headgear,accessory) {
  const [body,trim,face,visor,boots]=colours.split('/');
  return Object.freeze({id,name:rewardName(id),description:'An earned cosmetic look. No combat advantages.',
    palette:Object.freeze({body,trim,face,visor,boots}),headgear,accessory});
}
export const EXTRA_SKINS=Object.freeze([
  skin('crimson-ninja','#8f2038/#dfad45/#d9aa7d/#ffda63/#211b27','tied-hood','utility-pouches'),
  skin('midnight-ops','#172638/#536681/#bd8f70/#60bfd8/#111923','patrol-helmet','radio'),
  skin('frost-unit','#dbeaf0/#5fa7c0/#bc9078/#8ef3ff/#526778','sensor-antenna','bedroll'),
  skin('solar-guard','#db8b2b/#f5df8a/#a16c46/#56dcf0/#483d31','sealed-helmet','power-pack'),
  skin('golden-ninja','#c99b34/#24202d/#d3a27e/#fff1ad/#1a1923','tied-hood','light-strips'),
  skin('urban-ranger','#63717c/#a6b2b8/#bc8c68/#8bd0bc/#303943','field-hat','utility-pouches'),
  skin('lava-unit','#943326/#ef8740/#563b32/#ffe17a/#2a2329','sensor-antenna','air-tanks'),
  skin('void-guard','#38284f/#9379b6/#55526e/#b59dff/#1b1928','sealed-helmet','light-strips'),
]);
function finish(id,colours) {
  const [body,steel,light]=colours.split('/');
  return Object.freeze({id,name:rewardName(id),palette:Object.freeze({body,steel,light})});
}
export const GUN_FINISHES=Object.freeze([
  Object.freeze({id:'standard',name:'Standard',palette:null}),
  finish('crimson-red','#ae2943/#4e2631/#e6a077'),
  finish('ice-blue','#74c8ed/#36546a/#e7f7ff'),
  finish('forest-camo','#557447/#6d644b/#c9bb82'),
  finish('violet','#9256cc/#493757/#dac0fa'),
  finish('orange','#eb8431/#604a38/#ffd797'),
  finish('arctic-white','#e5edf0/#788e9e/#ffffff'),
  finish('stealth-black','#222831/#353e49/#687481'),
  finish('gold','#d5ab43/#70582f/#fff0ad'),
]);
export function getGunFinish(id) {
  const finish=GUN_FINISHES.find(item=>item.id===id);
  if (!finish) throw new RangeError(`Unknown gun finish: ${String(id)}`);
  return finish;
}

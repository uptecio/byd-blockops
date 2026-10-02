import { getSkin } from './skins.js';
import { getWeapon } from './weapons.js';
import { createWeaponModel } from './world.js';

export const AVATAR_HITBOX = Object.freeze({ halfWidth: .32, height: 1.84 });

// All geometry/materials belong to one model so disposeModel can release them.
export function createAvatarModel(THREE, { skinId, teamId = null, weaponId = 'm4a1' }) {
  const skin = getSkin(skinId);
  if (teamId !== null && teamId !== 'red' && teamId !== 'blue') throw new RangeError(`Unknown team: ${String(teamId)}`);
  const weapon = getWeapon(weaponId);
  const model = new THREE.Group();
  model.name = skin.name;
  model.userData = { skinId: skin.id, teamId, weaponId: weapon.id };
  Object.defineProperty(model.userData, 'hitbox', { value: AVATAR_HITBOX, enumerable: true });
  const geometry = new THREE.BoxGeometry(1, 1, 1), materials = new Map();
  const box = (group, name, x, y, z, w, h, d, colour, unlit = false) => {
    const key = `${colour}:${unlit}`;
    if (!materials.has(key)) materials.set(key, unlit
      ? new THREE.MeshBasicMaterial({ color: colour })
      : new THREE.MeshLambertMaterial({ color: colour }));
    const mesh = new THREE.Mesh(geometry, materials.get(key));
    mesh.name = name; mesh.position.set(x, y, z); mesh.scale.set(w, h, d);
    group.add(mesh);
    return mesh;
  };
  const { body, trim, face, visor, boots } = skin.palette;
  for (const [side, x] of [['left', -.16], ['right', .16]]) {
    box(model, `${side}-foot`, x, .09, .055, .25, .18, .4, boots);
    box(model, `${side}-leg`, x, .45, 0, .22, .54, .25, body);
    box(model, `${side}-knee`, x, .46, .14, .18, .14, .045, trim);
  }
  box(model, 'hips', 0, .75, 0, .52, .14, .3, boots);
  box(model, 'body', 0, 1.07, 0, .58, .56, .32, body);
  box(model, 'vest', 0, 1.08, .17, .43, .4, .09, trim);
  box(model, 'neck', 0, 1.38, 0, .18, .12, .2, face);
  box(model, 'head', 0, 1.56, 0, .42, .42, .42, face);
  box(model, 'face', 0, 1.59, .228, .32, .075, .025, visor);
  for (const [side, x] of [['left', -.34], ['right', .34]]) {
    box(model, `${side}-arm`, x, 1.15, .02, .2, .4, .26, body);
    box(model, `${side}-hand`, x, .97, .19, .18, .17, .3, face);
  }

  const headgear = new THREE.Group(); headgear.name = 'headgear'; model.add(headgear);
  const hat = (name, x, y, z, w, h, d, colour = body) => box(headgear, name, x, y, z, w, h, d, colour);
  switch (skin.headgear) {
    case 'patrol-helmet':
      hat('helmet', 0, 1.77, -.01, .48, .14, .48);
      hat('helmet-brim', 0, 1.72, .24, .49, .055, .16, trim);
      break;
    case 'headscarf':
      hat('scarf-top', 0, 1.78, 0, .46, .12, .46, trim);
      hat('scarf-wrap', 0, 1.49, .23, .45, .15, .075, trim);
      hat('scarf-tail', -.18, 1.48, -.24, .12, .42, .07);
      break;
    case 'winter-hood':
      hat('hood-top', 0, 1.77, -.025, .5, .14, .48);
      for (const x of [-.23, .23]) hat('hood-edge', x, 1.59, .04, .1, .35, .44, trim);
      hat('hood-back', 0, 1.58, -.225, .48, .38, .07);
      break;
    case 'field-hat':
      hat('hat-crown', 0, 1.78, -.02, .38, .12, .38);
      hat('hat-brim', 0, 1.71, 0, .65, .035, .6, trim);
      break;
    case 'headphones':
      hat('headphone-band', 0, 1.8, -.02, .48, .07, .13, visor);
      for (const x of [-.24, .24]) hat('earpiece', x, 1.62, 0, .1, .21, .18, trim);
      break;
    case 'tied-hood':
      hat('hood-cap', 0, 1.78, -.01, .45, .12, .44);
      hat('mask', 0, 1.47, .222, .42, .15, .045);
      hat('headband', 0, 1.68, .227, .44, .045, .04, trim);
      hat('headband-knot', .1, 1.67, -.24, .16, .09, .08, trim);
      hat('headband-tail', .15, 1.5, -.24, .07, .3, .04, trim);
      break;
    case 'sensor-antenna':
      hat('sensor-cap', 0, 1.76, 0, .46, .1, .43, trim);
      hat('antenna', -.13, 1.855, -.08, .035, .12, .035, boots);
      hat('sensor-light', -.13, 1.93, -.08, .075, .04, .075, visor);
      hat('ear-sensor', .24, 1.6, 0, .08, .12, .14, trim);
      break;
    case 'sealed-helmet':
      hat('helmet-top', 0, 1.77, -.02, .51, .14, .51, trim);
      for (const x of [-.235, .235]) hat('helmet-side', x, 1.59, 0, .07, .33, .48, trim);
      hat('helmet-chin', 0, 1.405, .04, .48, .075, .44, trim);
      hat('helmet-glass', 0, 1.58, .25, .39, .23, .04, visor);
      break;
  }

  const accessory = new THREE.Group(); accessory.name = 'accessory'; model.add(accessory);
  const extra = (name, x, y, z, w, h, d, colour = trim) => box(accessory, name, x, y, z, w, h, d, colour);
  switch (skin.accessory) {
    case 'utility-pouches':
      for (const x of [-.19, .19]) extra('pouch', x, .87, .21, .13, .17, .13);
      break;
    case 'water-flask':
      extra('flask', -.31, .83, -.03, .14, .22, .15);
      extra('flask-cap', -.31, .955, -.03, .08, .035, .08, boots);
      break;
    case 'bedroll':
      extra('bedroll', 0, 1.02, -.25, .49, .19, .18);
      for (const x of [-.15, .15]) extra('bedroll-strap', x, 1.02, -.345, .045, .2, .02, boots);
      break;
    case 'radio':
      extra('radio', -.2, 1, -.24, .15, .24, .15, boots);
      extra('radio-antenna', -.2, 1.23, -.24, .025, .23, .025, trim);
      break;
    case 'light-strips':
      for (const x of [-.245, .245]) extra('light-strip', x, 1.07, .178, .035, .4, .025, visor);
      extra('runner-belt', 0, .79, .175, .53, .045, .04, visor);
      break;
    case 'waist-sash':
      extra('sash', 0, .83, 0, .55, .08, .35);
      extra('sash-knot', -.23, .83, .21, .13, .12, .09);
      extra('sash-tail', -.23, .66, .21, .09, .24, .035);
      break;
    case 'power-pack':
      extra('power-pack', 0, 1.04, -.25, .3, .3, .16, boots);
      extra('power-light', 0, 1.04, -.34, .17, .07, .025, visor);
      for (const x of [-.18, .18]) extra('chest-rivet', x, 1.05, .222, .045, .045, .025, boots);
      break;
    case 'air-tanks':
      for (const x of [-.12, .12]) extra('air-tank', x, 1.02, -.27, .15, .4, .16);
      extra('air-valve', 0, .91, -.28, .11, .075, .18, boots);
      break;
  }

  if (teamId !== null) {
    // Four bordered, unlit badges stay readable against every cosmetic palette.
    const colour = teamId === 'red' ? '#ff4141' : '#3185ff';
    for (const z of [.247, -.389]) {
      box(model, 'team-border', 0, 1.25, z, .3, .22, .03, '#18212c', true);
      box(model, 'team-outline', 0, 1.25, z + Math.sign(z) * .018, .27, .19, .012, '#ffffff', true);
      box(model, 'team-marker', 0, 1.25, z + Math.sign(z) * .028, .235, .155, .012, colour, true);
    }
    for (const x of [-.453, .453]) {
      box(model, 'team-border', x, 1.25, .02, .025, .22, .29, '#18212c', true);
      box(model, 'team-outline', x + Math.sign(x) * .019, 1.25, .02, .012, .19, .26, '#ffffff', true);
      box(model, 'team-marker', x + Math.sign(x) * .029, 1.25, .02, .012, .155, .225, colour, true);
    }
  }

  // createWeaponModel points along -Z for the first-person camera. Turn its
  // attachment once so the avatar and its selected weapon both face +Z.
  const attachment = new THREE.Group(); attachment.name = 'weapon';
  attachment.userData.weaponId = weapon.id;
  attachment.position.set(.28, 1.04, .43); attachment.rotation.y = Math.PI;
  attachment.add(createWeaponModel(THREE, weapon)); model.add(attachment);
  return model;
}

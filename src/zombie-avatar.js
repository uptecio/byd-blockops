import { AVATAR_HITBOX } from './avatar-hitbox.js';

// Original, unarmed box characters. Resources are private to this model.
export function createZombieModel(THREE, kind) {
  if (kind !== 'walker' && kind !== 'runner') throw new RangeError('Unknown zombie kind');
  const model = new THREE.Group();
  model.name = kind === 'runner' ? 'Zombie Runner' : 'Zombie Walker';
  model.userData = { kind, hitbox: AVATAR_HITBOX };
  const geometry = new THREE.BoxGeometry(1, 1, 1), materials = new Map();
  const box = (parent, name, x, y, z, w, h, d, color, unlit = false) => {
    const key = `${color}:${unlit}`;
    if (!materials.has(key)) materials.set(key, unlit ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshLambertMaterial({ color }));
    const mesh = new THREE.Mesh(geometry, materials.get(key));
    mesh.name = name; mesh.position.set(x,y,z); mesh.scale.set(w,h,d); parent.add(mesh);
    return mesh;
  };
  const skin = kind === 'runner' ? '#96b858' : '#7daf65';
  const shirt = kind === 'runner' ? '#a95635' : '#395756';
  const pants = '#303947', dark = '#1c2927';
  box(model,'torso',0,1.04,0,.55,.6,.32,shirt);
  box(model,'torn-shirt',-.12,.8,.17,.15,.13,.02,skin);
  box(model,'head',0,1.58,0,.48,.48,.48,skin);
  for (const [side,x] of [['left',-.12],['right',.12]]) {
    box(model,`${side}-eye`,x,1.65,.247,.065,.065,.025,dark,true);
  }
  box(model,'mouth',0,1.48,.247,.13,.035,.025,dark);
  for (const [side,sign] of [['left',-1],['right',1]]) {
    const leg = new THREE.Group(); leg.name = `${side}-leg`; leg.position.set(sign*.145,.73,0); model.add(leg);
    box(leg,`${side}-trouser`,0,-.28,0,.24,.56,.27,pants);
    box(leg,`${side}-boot`,0,-.64,.025,.26,.18,.32,dark);
    const arm = new THREE.Group(); arm.name = `${side}-arm`; arm.position.set(sign*.36,1.3,0); model.add(arm);
    box(arm,`${side}-sleeve`,0,-.12,0,.2,.24,.24,shirt);
    box(arm,`${side}-forearm`,0,-.37,0,.19,.26,.22,skin);
    arm.rotation.x = -1.25;
  }
  box(model,'health-bar',0,2.04,0,.65,.06,.035,'#9dde66',true);
  return model;
}

export function animateZombieModel(model, { time, moving, slashing }) {
  const stride = moving ? Math.sin(time * (model.userData.kind === 'runner' ? 12 : 7)) * .38 : 0;
  model.getObjectByName('left-leg').rotation.x = stride;
  model.getObjectByName('right-leg').rotation.x = -stride;
  model.getObjectByName('left-arm').rotation.x = slashing ? -1.9 : -1.25 + stride*.2;
  model.getObjectByName('right-arm').rotation.x = slashing ? -1.9 : -1.25 - stride*.2;
}

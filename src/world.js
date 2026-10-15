import { DEFAULT_MAP_ID, getMap } from './maps.js';
import { getGunFinish } from './cosmetics.js';
import { createSpatialWorld } from './spatial.js';

// Procedural, texture-free meshes keep the complete arena available offline.
function blocks(THREE, group) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const materials = new Map();
  const material = colour => {
    if (!materials.has(colour)) materials.set(colour, new THREE.MeshLambertMaterial({ color: colour }));
    return materials.get(colour);
  };
  const box = (x, y, z, w, h, d, colour) => {
    const mesh = new THREE.Mesh(geometry, material(colour));
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    group.add(mesh);
    return mesh;
  };
  return { box, geometry, materials };
}

export function createWorld(THREE, scene, mapId = DEFAULT_MAP_ID) {
  // Validate before attaching anything, so an unsupported map cannot leak a world.
  return createWorldFromDefinition(THREE, scene, getMap(mapId));
}

export function createWorldFromDefinition(THREE, scene, definition) {
  const spatial = createSpatialWorld(definition);
  if (!Array.isArray(definition.blocks) || definition.blocks.some(block => !block
    || ![block.x, block.y, block.z, block.w, block.h, block.d].every(Number.isFinite)
    || block.w <= 0 || block.h <= 0 || block.d <= 0)) throw new RangeError('Invalid world blocks');
  const arena = new THREE.Group();
  arena.name = definition.name;
  const botGroup = new THREE.Group();
  botGroup.name = 'Bots';
  let builder, disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    arena.removeFromParent(); botGroup.removeFromParent();
    const resources = new Set(builder ? [builder.geometry, ...builder.materials.values()] : []);
    const groups = [];
    for (const root of [arena, botGroup]) root.traverse(object => {
      if (object.geometry) resources.add(object.geometry);
      for (const material of object.material ? [].concat(object.material) : []) resources.add(material);
      if (object.isGroup) groups.push(object);
    });
    for (const resource of resources) resource.dispose();
    for (const group of groups.reverse()) group.clear();
  };
  try {
    builder = blocks(THREE, arena);
    for (const block of definition.blocks) {
      builder.box(block.x, block.y, block.z, block.w, block.h, block.d, block.colour);
    }
    scene.add(arena, botGroup);
    return {
      mapId: definition.id, definition, spatial,
      solids: spatial.solids, spawns: definition.spawns, playerSpawn: definition.playerSpawn, botGroup,
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

export function createBotModel(THREE, colour = '#ef896c') {
  const group = new THREE.Group();
  group.name = 'Block Ranger';
  const { box } = blocks(THREE, group);
  const dark = '#2c4252';
  const cream = '#fff0ce';
  for (const x of [-0.17, 0.17]) {
    box(x, 0.1, 0.04, 0.24, 0.2, 0.38, dark);
    box(x, 0.42, 0, 0.23, 0.5, 0.25, '#536b73');
  }
  box(0, 1.01, 0, 0.62, 0.72, 0.37, colour);
  box(0, 1.08, 0.22, 0.4, 0.44, 0.12, cream);
  box(0, 0.72, 0.02, 0.65, 0.13, 0.4, dark);
  box(0, 1.55, 0, 0.5, 0.46, 0.45, cream);
  box(0, 1.76, -0.015, 0.58, 0.16, 0.52, colour);
  box(0, 1.57, 0.24, 0.4, 0.19, 0.08, dark);
  box(-0.09, 1.62, 0.287, 0.12, 0.04, 0.018, '#8ed5e3');
  for (const x of [-0.42, 0.42]) {
    box(x, 1.12, 0.1, 0.2, 0.42, 0.24, colour);
    box(x, 0.95, 0.25, 0.2, 0.2, 0.42, cream);
  }
  box(0.2, 1.05, 0.51, 0.23, 0.2, 0.57, dark);
  box(0.2, 1.07, 0.9, 0.1, 0.1, 0.3, '#20323d');
  box(0.2, 0.9, 0.45, 0.13, 0.23, 0.16, '#516675');
  return group;
}

export function createWeaponModel(THREE, weapon, { finishId = 'standard' } = {}) {
  const palette = getGunFinish(finishId).palette;
  const group = new THREE.Group();
  group.name = weapon.name || weapon.id || 'Weapon';
  const { box } = blocks(THREE, group);
  const id = String(weapon.id || '').toLowerCase();
  const classId = String(weapon.classId || '').toLowerCase();
  const colour = palette?.body ?? (weapon.colour || '#ddad62');
  const steel = palette?.steel ?? '#334554';
  const black = '#21313e';
  const light = palette?.light ?? '#758792';
  if (id === 'minigun') {
    // A fixed six-barrel cluster keeps the heavy silhouette cheap in every view.
    box(0, 0, -0.13, 0.24, 0.22, 0.34, steel);
    box(0, 0.07, -0.13, 0.245, 0.085, 0.28, colour);
    box(0, -0.17, 0, 0.1, 0.2, 0.12, black);
    box(0, -0.025, 0.16, 0.13, 0.13, 0.2, colour);
    box(0, -0.04, 0.26, 0.17, 0.19, 0.04, black);
    box(0.115, -0.14, -0.12, 0.24, 0.24, 0.2, colour);
    box(0.115, -0.14, -0.225, 0.245, 0.19, 0.025, light);
    for (const z of [-0.23, -0.04]) box(0, 0.16, z, 0.04, 0.1, 0.04, steel);
    box(0, 0.225, -0.135, 0.06, 0.04, 0.23, black);
    for (const z of [-0.32, -0.65]) box(0, 0.015, z, 0.25, 0.22, 0.045, light);
    for (const [x, y] of [[-0.055, 0.09], [0.055, 0.09], [-0.09, 0.015], [0.09, 0.015], [-0.055, -0.06], [0.055, -0.06]]) {
      box(x, y, -0.535, 0.045, 0.045, 0.46, black);
    }
    return group;
  }
  const sidearm = /sidearm|pistol|handgun/.test(classId);
  const sniper = /sniper/.test(classId);
  const marksman = /marksman|dmr/.test(classId);
  const shotgun = /shotgun/.test(classId);
  const lmg = /lmg|machine/.test(classId);
  const smg = /smg|submachine/.test(classId);
  const bullpup = /famas|p90/.test(id);
  const hash = [...id].reduce((sum, c) => sum + c.charCodeAt(0), 0);
  const length = sidearm ? 0.34 : sniper ? 0.76 : marksman ? 0.66 : shotgun ? 0.63 : smg ? 0.43 : 0.55;
  const bodyLength = sidearm ? 0.22 : bullpup ? 0.39 : 0.3;
  box(0, 0, -0.13, 0.12, sidearm ? 0.1 : 0.14, bodyLength, steel);
  box(0, 0.015, -0.13, 0.125, 0.06, bodyLength * 0.82, colour);
  box(0, -0.12, sidearm ? -0.04 : 0, 0.085, 0.19, 0.11, black).rotation.x = -0.16;
  box(0, 0.035, -length * 0.63, sidearm ? 0.065 : 0.075, 0.075, length * 0.66, black);
  box(0, 0.035, -length + 0.005, 0.095, 0.095, 0.055, light);
  if (!sidearm) {
    box(0, -0.025, 0.16, 0.11, 0.12, 0.21, colour);
    box(0, -0.055, 0.26, 0.13, 0.19, 0.04, black);
    box(0, -0.01, -0.34, 0.13, 0.12, Math.max(0.11, length - 0.35), colour);
    const magazineZ = bullpup ? 0.07 : -0.16;
    const magazine = box(0, -0.17, magazineZ, lmg ? 0.2 : 0.09, lmg ? 0.2 : smg ? 0.2 : 0.24, lmg ? 0.18 : 0.12, black);
    magazine.rotation.x = /ak|sks|rpk/.test(id) ? -0.24 : 0.07;
    for (const z of [-0.25, -0.32, -0.39]) {
      if (z > -length + 0.08) box(0, 0.066, z, 0.135, 0.025, 0.025, light);
    }
  }
  if (sniper || marksman) {
    box(0, 0.12, -0.12, 0.045, 0.1, 0.18, black);
    box(0, 0.2, -0.16, 0.1, 0.1, sniper ? 0.3 : 0.23, black);
    box(0, 0.2, -0.32, 0.13, 0.13, 0.045, light);
    box(0, 0.2, -0.345, 0.085, 0.085, 0.008, '#75c4d7');
  } else if (!sidearm) {
    box(0, 0.13, -0.09, 0.065, 0.09, 0.045, black);
    box(0, 0.12, -Math.min(length - 0.08, 0.41), 0.025, 0.065, 0.03, black);
  }
  if (shotgun) {
    box(0, -0.04, -0.45, 0.065, 0.065, 0.32, steel);
    box(0, -0.01, -0.4, 0.16, 0.15, 0.19, colour);
    if (/double/.test(id)) box(0.07, 0.035, -0.43, 0.065, 0.065, 0.4, black);
  }
  if (lmg) {
    box(-0.08, 0.17, -0.2, 0.04, 0.08, 0.22, light);
    box(0.08, -0.14, -0.54, 0.025, 0.25, 0.025, black).rotation.z = 0.2;
    box(-0.08, -0.14, -0.54, 0.025, 0.25, 0.025, black).rotation.z = -0.2;
  }
  if (/revolver/.test(id)) box(0, -0.015, -0.14, 0.16, 0.14, 0.13, light);
  if (/vector/.test(id)) box(0, -0.13, -0.17, 0.14, 0.24, 0.2, colour);
  if (/p90/.test(id)) box(0, 0.1, -0.17, 0.13, 0.06, 0.34, '#c9d1cb');
  if (/barrett/.test(id)) box(0, 0.035, -length, 0.19, 0.1, 0.085, steel);
  // A small per-gun accent preserves differences within each class.
  box(0.066, 0.006, -0.13 + (hash % 4) * 0.015, 0.012, 0.045, 0.055, colour);
  return group;
}

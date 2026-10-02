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

export function createWorld(THREE, scene) {
  const arena = new THREE.Group();
  arena.name = 'Sunlit Courtyard';
  scene.add(arena);
  const botGroup = new THREE.Group();
  botGroup.name = 'Bots';
  scene.add(botGroup);
  const { box, geometry, materials } = blocks(THREE, arena);
  const solids = [];
  const palette = {
    sand: '#e8cf9d', paving: '#f3dfb8', seam: '#dcc59d', blue: '#4ba9c4',
    blueDark: '#2789a8', coral: '#ec8a6b', coralDark: '#d46d56', cream: '#fff2d1',
    leaf: '#6db44c', leafLight: '#94cc61', wood: '#ba8854', dark: '#304451',
  };
  const solidBox = (x, z, w, d, height, colour) => {
    solids.push({ x, z, w, d, height });
    return box(x, height / 2, z, w, height, d, colour);
  };
  const shadow = (x, z, w, d) => box(x + 0.28, 0.008, z + 0.35, w, 0.012, d, '#d0ba91');

  box(0, -0.15, 0, 160, 0.3, 160, palette.sand);
  box(0, -0.035, 0, 44, 0.07, 44, palette.paving);
  // Wide paving panels, rather than hundreds of individually rendered tiles.
  for (let position = -20; position <= 20; position += 4) {
    box(position, 0.004, 0, 0.025, 0.007, 44, palette.seam);
    box(0, 0.005, position, 44, 0.007, 0.025, palette.seam);
  }
  // Pale lane inlays lead the eye toward the first enemies.
  for (const z of [-15, -11, -7, -3, 1, 5, 9, 13, 17]) {
    box(0, 0.012, z, 0.12, 0.012, 1.35, '#fff5da');
  }

  for (const x of [-23, 23]) {
    solidBox(x, 0, 2, 48, 3.2, palette.cream);
    box(x, 3.24, 0, 2.12, 0.22, 48, palette.blueDark);
  }
  for (const z of [-23, 23]) {
    solidBox(0, z, 44, 2, 3.2, palette.cream);
    box(0, 3.24, z, 44, 0.22, 2.12, palette.coral);
  }

  const building = (x, z, colour, trim, height, width = 8, depth = 8) => {
    shadow(x, z, width + 1, depth + 1);
    solidBox(x, z, width, depth, height, colour);
    box(x, 0.18, z, width + 0.18, 0.36, depth + 0.18, palette.cream);
    box(x, height + 0.12, z, width + 0.4, 0.24, depth + 0.4, palette.cream);
    box(x, height + 0.37, z, width - 0.4, 0.26, depth - 0.4, trim);
    // Windows on both inward-facing elevations have thick cream block frames.
    const faceZ = z + (z > 0 ? -1 : 1) * (depth / 2 + 0.025);
    const faceX = x + (x > 0 ? -1 : 1) * (width / 2 + 0.025);
    for (const offset of [-2.2, 2.2]) {
      box(x + offset, 3.6, faceZ, 1.8, 1.8, 0.12, palette.cream);
      box(x + offset, 3.6, faceZ + (z > 0 ? -0.08 : 0.08), 1.45, 1.4, 0.12, palette.dark);
      box(faceX, 3.6, z + offset, 0.12, 1.8, 1.8, palette.cream);
      box(faceX + (x > 0 ? -0.08 : 0.08), 3.6, z + offset, 0.12, 1.4, 1.45, palette.dark);
    }
    box(x, 1.2, faceZ, 1.4, 2.4, 0.14, trim);
    box(x, 2.55, faceZ + (z > 0 ? -0.5 : 0.5), 3.2, 0.2, 1.2, palette.cream);
    // Offset rooftop tower provides an interesting skyline.
    box(x + 1.5, height + 1, z + 1, 2.5, 1.4, 2.5, colour);
    box(x + 1.5, height + 1.75, z + 1, 2.7, 0.16, 2.7, palette.cream);
  };
  building(-15, -14, palette.blue, palette.blueDark, 6.2);
  building(15, -14, palette.coral, palette.coralDark, 7);
  building(-15, 14, palette.coral, palette.coralDark, 5.2);
  building(15, 14, palette.blue, palette.blueDark, 5.8);

  const wall = (x, z, w, d, h, colour) => {
    shadow(x, z, w + 0.5, d + 0.5);
    solidBox(x, z, w, d, h, colour);
    box(x, h + 0.08, z, w + 0.18, 0.16, d + 0.18, palette.cream);
  };
  wall(-8, 0, 2.2, 6.2, 2.8, palette.blue);
  wall(8, -1, 2.2, 6.2, 2.8, palette.coral);
  wall(-6, 7, 4, 1.1, 1.1, palette.coral);
  wall(6, 7, 4, 1.1, 1.1, palette.blue);
  wall(-5, -7, 3, 1.2, 1.15, palette.cream);
  wall(5, -7, 3, 1.2, 1.15, palette.cream);

  const crate = (x, z, size = 1.7, stacked = false) => {
    const height = size * (stacked ? 2 : 1);
    shadow(x, z, size + 0.4, size + 0.4);
    solidBox(x, z, size, size, height, palette.wood);
    for (const side of [-1, 1]) {
      box(x + side * size * 0.36, height / 2, z, 0.13, height, size + 0.02, '#d7ab72');
      box(x, height / 2, z + side * size * 0.36, size + 0.02, height, 0.13, '#d7ab72');
    }
    box(x, height * 0.5, z, size + 0.04, 0.13, size + 0.04, '#92643f');
    box(x, height + 0.035, z, size + 0.03, 0.07, size + 0.03, '#deb37d');
  };
  crate(-16, 3, 1.8, true);
  crate(16, -3, 1.8, true);
  crate(-11, -6, 1.4);
  crate(11, 6, 1.4);
  crate(-4, -14, 1.5);
  crate(4, -14, 1.5);

  const tree = (x, z, height = 3.4) => {
    shadow(x, z, 3.5, 3.2);
    solidBox(x, z, 1.3, 1.3, 0.45, palette.cream);
    solids.push({ x, z, w: 0.5, d: 0.5, height });
    box(x, height / 2, z, 0.5, height, 0.5, '#94704b');
    // Canopies occupy air only; trunk and planter provide solid cover below.
    box(x, height + 0.3, z, 2.7, 2.1, 2.7, palette.leaf);
    box(x - 0.6, height + 1.2, z - 0.35, 1.8, 1.25, 1.8, palette.leafLight);
    box(x + 0.95, height + 0.25, z + 0.4, 1.05, 1.45, 1.7, '#58a34d');
  };
  tree(-19, 0, 3.4);
  tree(19, 0, 4);
  tree(-8, 17, 3);
  tree(8, 17, 3.4);
  tree(-8, -18, 3.5);
  tree(8, -18, 3);

  // Bright small ornaments make the courtyard feel inhabited without textures.
  for (const x of [-20, 20]) {
    box(x, 0.3, 7, 1.1, 0.6, 2.4, palette.cream);
    box(x, 0.63, 7, 0.9, 0.12, 2.2, palette.leaf);
    for (const z of [6.3, 7, 7.7]) box(x, 0.79, z, 0.25, 0.25, 0.25, palette.coral);
  }
  // Matching low planter footprints ensure every visible obstacle is collidable.
  solids.push({ x: -20, z: 7, w: 1.1, d: 2.4, height: 0.6 });
  solids.push({ x: 20, z: 7, w: 1.1, d: 2.4, height: 0.6 });

  const playerSpawn = { x: 0, z: 15 };
  const spawns = [
    { x: 0, z: -7 }, { x: -2, z: -2 }, { x: 3, z: 2 },
    { x: 0, z: -17 }, { x: 12, z: 4 }, { x: -12, z: 4 },
    { x: 12, z: -5 }, { x: -12, z: -4 }, { x: 0, z: 8 },
  ];
  return {
    solids, spawns, playerSpawn, botGroup,
    dispose() {
      scene.remove(arena, botGroup);
      geometry.dispose();
      for (const material of materials.values()) material.dispose();
      const disposedGeometry = new Set();
      const disposedMaterial = new Set();
      botGroup.traverse(object => {
        if (object.geometry && !disposedGeometry.has(object.geometry)) {
          disposedGeometry.add(object.geometry);
          object.geometry.dispose();
        }
        for (const material of object.material ? [].concat(object.material) : []) {
          if (!disposedMaterial.has(material)) { disposedMaterial.add(material); material.dispose(); }
        }
      });
    },
  };
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

export function createWeaponModel(THREE, weapon) {
  const group = new THREE.Group();
  group.name = weapon.name || weapon.id || 'Weapon';
  const { box } = blocks(THREE, group);
  const id = String(weapon.id || '').toLowerCase();
  const classId = String(weapon.classId || '').toLowerCase();
  const colour = weapon.colour || '#ddad62';
  const steel = '#334554';
  const black = '#21313e';
  const light = '#758792';
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

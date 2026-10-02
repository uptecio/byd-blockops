// Shared, texture-free arena records are consumed by rendering and simulation.
export const DEFAULT_MAP_ID = 'courtyard';

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function builder(id, name, description, environment) {
  const blocks = [], solids = [];
  const box = (x, y, z, w, h, d, colour) => blocks.push({ x, y, z, w, h, d, colour });
  const solid = (x, z, w, d, height, colour) => {
    solids.push({ x, z, w, d, height });
    box(x, height / 2, z, w, height, d, colour);
  };
  const finish = (options = {}) => {
    const teamSpawns = {
      red: [-8, -4, 0, 4, 8].map(x => ({ x, z: 19 })),
      blue: [-8, -4, 0, 4, 8].map(x => ({ x, z: -19 })),
    };
    return freeze({
      id, name, description, environment, bounds: { min: -22, max: 22 }, blocks, solids,
      playerSpawn: { x: 0, z: 19 }, spawns: [...teamSpawns.red.filter(point => point.x !== 0), ...teamSpawns.blue],
      teamSpawns, bases: { red: { x: 0, z: 18 }, blue: { x: 0, z: -18 } }, ...options,
    });
  };
  return { box, solid, finish };
}

function courtyard() {
  const map = builder('courtyard', 'Sunlit Courtyard', 'Colourful buildings, trees and crates around a central lane.',
    { sky: '#8acfed', fog: '#b5dcde', ground: '#e8cf9d', accent: '#4ba9c4' });
  const { box, solid: solidBox } = map;
  const palette = {
    sand: '#e8cf9d', paving: '#f3dfb8', seam: '#dcc59d', blue: '#4ba9c4',
    blueDark: '#2789a8', coral: '#ec8a6b', coralDark: '#d46d56', cream: '#fff2d1',
    leaf: '#6db44c', leafLight: '#94cc61', wood: '#ba8854', dark: '#304451',
  };
  const shadow = (x, z, w, d) => box(x + 0.28, 0.008, z + 0.35, w, 0.012, d, '#d0ba91');
  box(0, -0.15, 0, 160, 0.3, 160, palette.sand);
  box(0, -0.035, 0, 44, 0.07, 44, palette.paving);
  for (let position = -20; position <= 20; position += 4) {
    box(position, 0.004, 0, 0.025, 0.007, 44, palette.seam);
    box(0, 0.005, position, 44, 0.007, 0.025, palette.seam);
  }
  for (const z of [-15, -11, -7, -3, 1, 5, 9, 13, 17]) box(0, 0.012, z, 0.12, 0.012, 1.35, '#fff5da');
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
  crate(-16, 3, 1.8, true); crate(16, -3, 1.8, true);
  crate(-11, -6, 1.4); crate(11, 6, 1.4);
  crate(-4, -14, 1.5); crate(4, -14, 1.5);
  const tree = (x, z, height = 3.4) => {
    shadow(x, z, 3.5, 3.2);
    solidBox(x, z, 1.3, 1.3, 0.45, palette.cream);
    solidBox(x, z, 0.5, 0.5, height, '#94704b');
    box(x, height + 0.3, z, 2.7, 2.1, 2.7, palette.leaf);
    box(x - 0.6, height + 1.2, z - 0.35, 1.8, 1.25, 1.8, palette.leafLight);
    box(x + 0.95, height + 0.25, z + 0.4, 1.05, 1.45, 1.7, '#58a34d');
  };
  tree(-19, 0, 3.4); tree(19, 0, 4);
  tree(-8, 17, 3); tree(8, 17, 3.4);
  tree(-8, -18, 3.5); tree(8, -18, 3);
  for (const x of [-20, 20]) {
    solidBox(x, 7, 1.1, 2.4, 0.6, palette.cream);
    box(x, 0.63, 7, 0.9, 0.12, 2.2, palette.leaf);
    for (const z of [6.3, 7, 7.7]) box(x, 0.79, z, 0.25, 0.25, 0.25, palette.coral);
  }
  return map.finish({
    playerSpawn: { x: 0, z: 15 },
    teamSpawns: {
      red: [-6, -3, 0, 3, 6].map(x => ({ x, z: 19 })),
      blue: [-6, -3, 0, 3, 6].map(x => ({ x, z: -19 })),
    },
    spawns: [
      { x: 0, z: -7 }, { x: -2, z: -2 }, { x: 3, z: 2 },
      { x: 0, z: -17 }, { x: 12, z: 4 }, { x: -12, z: 4 },
      { x: 12, z: -5 }, { x: -12, z: -4 }, { x: 0, z: 8 },
    ],
  });
}

function arena(id, name, description, environment, wallColour) {
  const map = builder(id, name, description, environment);
  map.box(0, -0.15, 0, 160, 0.3, 160, environment.ground);
  map.box(0, -0.035, 0, 44, 0.07, 44, environment.ground);
  for (const x of [-23, 23]) map.solid(x, 0, 2, 48, 3.2, wallColour);
  for (const z of [-23, 23]) map.solid(0, z, 44, 2, 3.2, wallColour);
  return map;
}

function dustTown() {
  const map = arena('dust-town', 'Dust Town', 'Offset sandstone streets meet a sheltered market square.',
    { sky: '#e8c391', fog: '#e8c391', ground: '#d9b57c', accent: '#bf6251' }, '#e2bd85');
  const { box, solid } = map;
  for (const [x, z, w, d] of [[-13, -11, 8, 7], [12, -7, 8, 8], [-12, 9, 9, 7], [13, 12, 8, 6]]) {
    solid(x, z, w, d, 5, '#c9975d');
    box(x, 5.2, z, w + 0.3, 0.4, d + 0.3, '#f1d5a0');
    box(x, 3.5, z - d / 2 - 0.04, 2, 1.2, 0.08, '#704d38');
    box(x - 1.5, 6, z + 1, 2, 1.2, 2, '#d5a86b');
  }
  for (const [x, z, colour] of [[-5, -2, '#bf6251'], [5, 3, '#689e91']]) {
    solid(x, z, 2.4, 3, 1.2, '#a97446');
    // Supports have collision; awnings sit safely above head height.
    for (const dz of [-1.5, 1.5]) solid(x, z + dz, 0.3, 0.3, 3.2, '#765138');
    box(x, 3.3, z, 3.8, 0.2, 4, colour);
    for (const offset of [-1, 0, 1]) box(x + offset, 3.42, z, 0.35, 0.04, 4, '#f6ddb3');
  }
  for (const [x, z] of [[-3, 11], [3, -11], [-17, 0], [17, 2]]) {
    solid(x, z, 1.8, 1.8, 1.6, '#a97446');
    box(x, 1.65, z, 1.85, 0.1, 1.85, '#e3c191');
  }
  box(0, 0.01, 0, 6, 0.02, 8, '#e8cc9a');
  return map.finish();
}

function neonCity() {
  const map = arena('neon-city', 'Neon City', 'Bright signs mark cross streets and alternating side passages.',
    { sky: '#22283f', fog: '#22283f', ground: '#394157', accent: '#49e0db' }, '#535b75');
  const { box, solid } = map;
  box(0, 0.006, 0, 8, 0.012, 44, '#252d42');
  box(0, 0.007, 0, 44, 0.012, 8, '#252d42');
  for (const [x, z, height, colour] of [[-11, -11, 8, '#4fdcda'], [11, -11, 10, '#e86dbe'], [-11, 11, 10, '#e86dbe'], [11, 11, 8, '#4fdcda']]) {
    solid(x, z, 10, 10, height, '#30394e');
    box(x, height + 0.1, z, 10.2, 0.2, 10.2, colour);
    const signX = x + (x < 0 ? 5.1 : -5.1);
    box(signX, 4.5, z, 0.2, 1.5, 5, colour);
    for (const y of [2.5, 6]) for (const dz of [-3, 0, 3]) box(signX, y, z + dz, 0.15, 0.7, 1.4, '#85b1e5');
  }
  for (const [x, z] of [[-18, -1], [18, 1]]) {
    solid(x, z, 3, 5, 3, '#4c5570');
    box(x, 3.15, z, 3.2, 0.3, 5.2, '#ddbc5c');
  }
  for (const [x, z] of [[-2, 8], [2, -8]]) {
    solid(x, z, 1.4, 3, 1.3, '#657189');
    box(x, 1.36, z, 1.4, 0.12, 3, '#49e0db');
  }
  for (const z of [-18, -10, -2, 6, 14]) box(0, 0.02, z, 0.15, 0.02, 2, '#d7ca88');
  return map.finish();
}

function snowBase() {
  const map = arena('snow-base', 'Snow Base', 'A central research shelter has two broad snowy flanking routes.',
    { sky: '#cadfe9', fog: '#cadfe9', ground: '#eff5f6', accent: '#5db9dc' }, '#a8d8e9');
  const { box, solid } = map;
  solid(0, 0, 11, 8, 4.2, '#8bafc2');
  box(0, 4.35, 0, 11.5, 0.3, 8.5, '#ffffff');
  for (const z of [-4.05, 4.05]) box(0, 2.7, z, 8, 1.2, 0.1, '#345d75');
  box(0, 5.7, 0, 0.4, 2.4, 0.4, '#657e8e');
  box(0, 6.9, 0, 3.5, 0.6, 0.7, '#d7e8ed');
  for (const [x, z] of [[-15, -10], [15, -10], [-15, 10], [15, 10]]) {
    solid(x, z, 4, 5, 2.4, '#8ed1e6');
    box(x, 2.55, z, 4.2, 0.3, 5.2, '#e5f4f8');
    box(x + 0.5, 3.2, z, 2, 1, 3, '#a9dfed');
  }
  for (const x of [-15, 15]) {
    solid(x, 0, 4, 4, 3.4, '#d0dee2');
    box(x, 3.5, 0, 4.3, 0.2, 4.3, '#ffffff');
    box(x, 2.5, -2.05, 2.5, 0.8, 0.1, '#5db9dc');
  }
  for (const z of [-11, 11]) solid(0, z, 3, 1.5, 1, '#bed4df');
  for (const x of [-8, 8]) box(x, 0.01, 0, 2, 0.02, 30, '#d8eaf0');
  return map.finish();
}

function jungleRuins() {
  const map = arena('jungle-ruins', 'Jungle Ruins', 'Broken stone walls wind through dense blocky vegetation.',
    { sky: '#b5d5af', fog: '#b5d5af', ground: '#7e9761', accent: '#c2b485' }, '#718568');
  const { box, solid } = map;
  for (const [x, z, w, d, h] of [[-7, -10, 11, 1.5, 3], [8, -5, 1.5, 11, 3.5], [-8, 4, 1.5, 11, 2.8], [7, 10, 11, 1.5, 3], [1, 0, 5, 1.5, 1.1]]) {
    solid(x, z, w, d, h, '#8f9878');
    box(x, h + 0.12, z, w, 0.24, d, '#b1b491');
    box(x - w / 4, h + 0.6, z, Math.min(1.5, w), 0.8, Math.min(1.5, d), '#7c8769');
  }
  for (const [x, z] of [[-16, -12], [16, -12], [-16, 12], [16, 12], [-17, 0], [17, 0]]) {
    solid(x, z, 2.5, 2.5, 4, '#667858');
    box(x, 4.2, z, 3, 0.4, 3, '#a5ac83');
    box(x, 5, z, 4, 1.5, 4, '#47763e');
    box(x + 0.5, 6, z - 0.5, 2.5, 1, 2.5, '#6b9b4d');
  }
  for (const [x, z] of [[-2, 12], [2, -12], [-14, 6], [14, -6]]) {
    solid(x, z, 2.2, 2.2, 1.5, '#a2a384');
    box(x, 1.65, z, 2.2, 0.3, 2.2, '#4e7840');
  }
  box(0, 0.008, 0, 3, 0.016, 32, '#a9aa7c');
  return map.finish();
}

function harbor() {
  const map = arena('harbor', 'Harbor', 'Cargo lanes open onto a diagonal yard beside water and cranes.',
    { sky: '#a3cede', fog: '#a3cede', ground: '#a0afb5', accent: '#edb756' }, '#647f8c');
  const { box, solid } = map;
  // Water scenery starts beyond the enclosing walls.
  box(45, -0.06, 0, 42, 0.12, 100, '#418fac');
  for (const [x, z, w, d, colour] of [[-12, -11, 5, 10, '#c96551'], [-5, -11, 5, 10, '#648ba2'], [12, 11, 5, 10, '#c96551'], [5, 11, 5, 10, '#648ba2'], [-13, 5, 8, 4, '#d1a750'], [13, -5, 8, 4, '#d1a750']]) {
    solid(x, z, w, d, 3.4, colour);
    for (let offset = -d / 2 + 0.5; offset < d / 2; offset += 1) box(x + w / 2 - 0.04, 1.7, z + offset, 0.08, 3.2, 0.1, '#e5c99e');
    box(x, 3.5, z, w, 0.2, d, '#d0d8d8');
  }
  for (const [x, z] of [[-18, 13], [18, -13]]) {
    solid(x, z, 2, 2, 9, '#d7b659');
    box(x, 9.2, z, 9, 0.6, 1.2, '#e5c971');
    box(x + (x > 0 ? -3 : 3), 7, z, 0.2, 4, 0.2, '#465b69');
  }
  for (const [x, z] of [[-4, 4], [4, -4]]) solid(x, z, 2, 2, 1.4, '#997b55');
  for (const z of [-15, -9, -3, 3, 9, 15]) box(-z * 0.5, 0.01, z, 2.5, 0.02, 0.15, '#e9d590');
  return map.finish();
}

function desertFort() {
  const map = arena('desert-fort', 'Desert Fort', 'Two fortified courtyards connect through three clear routes.',
    { sky: '#efd0a0', fog: '#efd0a0', ground: '#dcb482', accent: '#ae624b' }, '#b77f58');
  const { box, solid } = map;
  // Two wall sections leave a central gate and broad left/right passages.
  for (const x of [-9, 9]) {
    solid(x, 0, 10, 2.2, 4.5, '#be885d');
    for (const offset of [-4, -2, 0, 2, 4]) box(x + offset, 4.9, 0, 1, 0.8, 2.2, '#ecc89a');
  }
  for (const [x, z] of [[-17, -12], [17, -12], [-17, 12], [17, 12]]) {
    solid(x, z, 5, 5, 6.2, '#bc8055');
    box(x, 6.4, z, 5.4, 0.4, 5.4, '#edd0a2');
    for (const dx of [-2, 2]) for (const dz of [-2, 2]) box(x + dx, 7.1, z + dz, 1, 1, 1, '#bc8055');
    box(x, 3.8, z + (z < 0 ? 2.55 : -2.55), 1, 1.5, 0.1, '#76523d');
  }
  for (const z of [-10, 10]) {
    for (const x of [-7, 7]) solid(x, z, 5, 1.5, 1.4, '#d1a276');
    solid(0, z, 2.5, 2.5, 1.2, '#ae624b');
  }
  box(0, 0.01, 0, 5, 0.02, 34, '#e8c79a');
  for (const x of [-18, 18]) box(x, 0.01, 0, 3, 0.02, 15, '#e8c79a');
  return map.finish();
}

function spaceStation() {
  const map = arena('space-station', 'Space Station', 'Connected metallic chambers surround a glowing reactor.',
    { sky: '#202d41', fog: '#202d41', ground: '#53616f', accent: '#6de3cc' }, '#8a98a6');
  const { box, solid } = map;
  // Broken chamber partitions have doors on both axes and room around the ends.
  for (const z of [-8, 8]) for (const x of [-11, 11]) {
    solid(x, z, 12, 1.5, 3.8, '#768898');
    box(x, 3.9, z, 12, 0.2, 1.5, '#6de3cc');
  }
  for (const x of [-8, 8]) for (const z of [-13, 13]) {
    solid(x, z, 1.5, 5, 3.8, '#768898');
    box(x, 3.9, z, 1.5, 0.2, 5, '#8bb7ef');
  }
  solid(0, 0, 5, 5, 4.8, '#36465b');
  box(0, 5, 0, 5.4, 0.4, 5.4, '#aab8c3');
  box(0, 6.3, 0, 3.2, 2.2, 3.2, '#6de3cc');
  box(0, 7.6, 0, 4.5, 0.4, 4.5, '#aab8c3');
  for (const [x, z] of [[-16, 0], [16, 0], [0, -13], [0, 13]]) {
    solid(x, z, 2.4, 3, 1.6, '#354b63');
    box(x, 1.7, z, 2.4, 0.2, 3, '#8bb7ef');
  }
  for (const x of [-4, 4]) box(x, 0.01, 0, 0.12, 0.02, 35, '#6de3cc');
  for (const z of [-4, 4]) box(0, 0.01, z, 35, 0.02, 0.12, '#6de3cc');
  return map.finish();
}

export const MAPS = freeze([courtyard(), dustTown(), neonCity(), snowBase(), jungleRuins(), harbor(), desertFort(), spaceStation()]);

export function getMap(id) {
  const map = MAPS.find(map => map.id === id);
  if (!map) throw new RangeError(`Unknown map: ${String(id)}`);
  return map;
}

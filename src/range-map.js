// Private practice geometry: deliberately never registered in the public MAPS catalogue.
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export const RANGE_TARGETS = freeze([
  ['close', 'CLOSE', -9, 16], ['medium', 'MEDIUM', 0, 4], ['far', 'FAR', 9, -16],
].flatMap(([lane, label, x, z]) => [
  { id: `${lane}-dummy`, kind: 'dummy', x: x - 1.3, y: 0, z, label },
  { id: `${lane}-bullseye`, kind: 'bullseye', x: x + 1.3, y: 0, z, label },
]));

const solids = [
  { id: 'range:left-wall', x: -30.5, z: 0, w: 1, d: 62, height: 4 },
  { id: 'range:right-wall', x: 30.5, z: 0, w: 1, d: 62, height: 4 },
  { id: 'range:rear-wall', x: 0, z: 30.5, w: 60, d: 1, height: 4 },
  { id: 'range:backstop', x: 0, z: -30.5, w: 60, d: 1, height: 4 },
].map(solid => ({ ...solid, minY: 0, maxY: solid.height }));

export const RANGE_MAP = freeze({
  id: 'shooting-range', name: 'Shooting Range', description: 'Practise with close, medium and far targets.',
  environment: { sky: '#8acfed', fog: '#b5dcde', ground: '#d4c6a5', accent: '#4ba9c4' },
  bounds: { min: -30, max: 30 }, playerSpawn: { x: -9, z: 24 }, spawns: [], hideSpots: [],
  traversal: { roofs: [], shelters: [], links: [], patrolPoints: [], stairs: [], ladders: [] },
  solids,
  blocks: [
    { x: 0, y: -.15, z: 0, w: 62, h: .3, d: 62, colour: '#d4c6a5' },
    ...solids.map(solid => ({ x: solid.x, y: solid.height / 2, z: solid.z,
      w: solid.w, h: solid.height, d: solid.d, colour: '#697982', solidId: solid.id })),
  ],
});

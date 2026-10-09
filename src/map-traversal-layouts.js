import { addRoom, addHideSpot, SIDES } from './map-traversal.js';

// Explicit small annexes retain the existing arena lanes and team-side access.
// Each row: center X/Z, staircase attachment side, walk-in doorway side.
const layouts = {
  courtyard: { rooms: [[19, -7, 'W', 'S'], [-15, 6.5, 'E', 'W']], colour: '#4ba9c4', trim: '#fff2d1', steps: '#ba8854', hides: ['storage locker', 'blocky shrub'] },
  'dust-town': { rooms: [[19, -8, 'N', 'S'], [12, 6, 'E', 'W']], colour: '#c9975d', trim: '#f1d5a0', steps: '#a97446', hides: ['supply cabinet', 'covered storage nook'] },
  'neon-city': { rooms: [[-19, -8.5, 'N', 'S'], [19, 8.5, 'S', 'N']], colour: '#30394e', trim: '#49e0db', steps: '#657189', hides: ['utility locker', 'service recess'] },
  'snow-base': { rooms: [[-8.5, -8, 'N', 'E'], [8.5, 8, 'S', 'E']], colour: '#8bafc2', trim: '#ffffff', steps: '#a9dfed', hides: ['equipment locker', 'snow supply nook'] },
  'jungle-ruins': { rooms: [[-16, -7.25, 'E', 'W'], [16, 7.25, 'W', 'E']], colour: '#8f9878', trim: '#b1b491', steps: '#7c8769', hides: ['dense blocky bush', 'dense blocky bush'] },
  harbor: { rooms: [[-17.5, -11, 'N', 'W'], [17.5, 11, 'S', 'E']], colour: '#c96551', trim: '#d0d8d8', steps: '#997b55', hides: ['cargo locker', 'storage recess'] },
  'desert-fort': { rooms: [[-15, -6.5, 'E', 'W'], [15, 6.5, 'W', 'E']], colour: '#bc8055', trim: '#edd0a2', steps: '#d1a276', hides: ['supply cupboard', 'screened alcove'] },
  'space-station': { rooms: [[-16, -12, 'N', 'E'], [16, 12, 'S', 'E']], colour: '#768898', trim: '#6de3cc', steps: '#354b63', hides: ['maintenance locker', 'equipment recess'] },
};

export function addTraversalLayout(builder, mapId) {
  const layout = layouts[mapId];
  if (!layout) throw new Error(`Missing traversal layout ${mapId}`);
  if (mapId === 'courtyard') builder.removeSolid('courtyard:low-wall:south-west');
  layout.rooms.forEach(([x, z, side, doorSide], index) => {
    const id = `${mapId}:annex:${index + 1}`, roofY = 2.2;
    addRoom(builder, { id, x, z, w: 4, d: 4, roofY, floorY: 0, doorSide, colour: layout.colour, trim: layout.trim });
    builder.traversal.patrolPoints.push({ x, y: 0, z });
    const facing = SIDES[doorSide], v = { x: -facing.z, z: facing.x };
    const occupant = { x: x - facing.x * 1.08 + v.x * .78, y: 0, z: z - facing.z * 1.08 + v.z * .78 };
    const ahead = amount => ({ x: occupant.x + facing.x * amount, y: 0, z: occupant.z + facing.z * amount });
    const kind = layout.hides[index], bush = /bush|shrub/.test(kind);
    addHideSpot(builder, { id: `${id}:hide`, kind, facing: doorSide, occupant, entry: ahead(1.3), exit: ahead(1.3), recovery: ahead(1.6),
      view: { ...ahead(.35), y: 1.65 }, proxy: { min: { x: occupant.x - .62, y: 0, z: occupant.z - .62 }, max: { x: occupant.x + .62, y: 2, z: occupant.z + .62 } } },
    { colour: bush ? '#47763e' : layout.steps, trim: bush ? '#6b9b4d' : layout.trim });
  });
}

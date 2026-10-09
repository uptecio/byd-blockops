import { createSpatialWorld, canOccupyBody, supportBelow, segmentClear, sweepBodyClear } from './spatial.js';
import { auditRoofApproaches } from './roof-access-validation.js';

export const SIDES = Object.freeze({ N: { x: 0, z: -1 }, S: { x: 0, z: 1 }, E: { x: 1, z: 0 }, W: { x: -1, z: 0 } });
const point = (x, y, z) => ({ x, y, z });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export function addRoom(builder, { id, x, z, w, d, floorY = 0, roofY, doorSide, colour, trim }) {
  const thickness = .18, ceiling = roofY - thickness, doorway = 1.8;
  for (const side of ['N', 'S', 'E', 'W']) {
    const horizontal = side === 'N' || side === 'S', u = SIDES[side];
    const length = horizontal ? w : d, offset = (horizontal ? d : w) / 2 - thickness / 2;
    const cx = x + u.x * offset, cz = z + u.z * offset;
    const wall = (suffix, along, span, low, high) => builder.prism({ id: `${id}:${side}:${suffix}`,
      x: cx + (horizontal ? along : 0), z: cz + (horizontal ? 0 : along),
      w: horizontal ? span : thickness, d: horizontal ? thickness : span, minY: low, maxY: high }, colour);
    if (side === doorSide) {
      const wing = (length - doorway) / 2;
      wall('left', -(doorway + wing) / 2, wing, floorY, ceiling);
      wall('right', (doorway + wing) / 2, wing, floorY, ceiling);
      wall('lintel', 0, doorway, floorY + 1.9, ceiling);
    } else wall('wall', 0, length, floorY, ceiling);
  }
  builder.prism({ id: `${id}:roof`, x, z, w, d, minY: ceiling, maxY: roofY }, trim);
  if (floorY > 0) builder.prism({ id: `${id}:floor`, x, z, w, d, minY: 0, maxY: floorY }, colour);
  builder.traversal.shelters.push({ id, point: point(x, floorY, z) });
}

export function addStepRoute(builder, { id, points, width = 1.6, depth = 1.4, colour }) {
  const solids = [];
  for (let i = 1; i < points.length - 1; i++) {
    const here = points[i], alongX = Math.abs(here.x - points[i - 1].x) > Math.abs(here.z - points[i - 1].z);
    const solidId = `${id}:step:${i}`;
    builder.prism({ id: solidId, x: here.x, z: here.z, w: alongX ? depth : width,
      d: alongX ? width : depth, minY: 0, maxY: here.y }, colour);
    solids.push(solidId);
  }
  for (let i = 1; i < points.length; i++) builder.traversal.links.push({
    id: `${id}:link:${i}`, from: points[i - 1], to: points[i], kind: 'jump', width, depth, routeId: id,
  });
  return { entryLinkId: `${id}:link:${points.length - 1}`, solidIds: solids };
}

export function addHideSpot(builder, spot, { colour, trim }) {
  const u = SIDES[spot.facing], v = { x: -u.z, z: u.x }, c = spot.occupant;
  const shellIds = [];
  const wall = (name, dx, dz, w, d, minY, maxY, paint = colour) => {
    const id = `${spot.id}:${name}`; shellIds.push(id);
    builder.prism({ id, hideSpotId: spot.id, x: c.x + dx, z: c.z + dz, w, d, minY: c.y + minY, maxY: c.y + maxY }, paint);
  };
  for (const sign of [-1, 1]) wall(`side:${sign}`, v.x * .59 * sign, v.z * .59 * sign,
    v.x ? .1 : 1.24, v.z ? .1 : 1.24, 0, 1.92);
  wall('back', -u.x * .59, -u.z * .59, u.x ? .1 : 1.24, u.z ? .1 : 1.24, 0, 1.92);
  wall('top', 0, 0, 1.24, 1.24, 1.92, 2, trim);
  builder.hideSpots.push({ ...spot, shellIds });
}

export function validateTraversal(map) {
  const errors = [];
  let world;
  try { world = createSpatialWorld(map); } catch (error) { return { ok: false, errors: [error.message] }; }
  const traversal = map.traversal;
  if (!traversal || !Array.isArray(map.hideSpots)) return { ok: false, errors: ['Missing traversal metadata'] };
  if (traversal.roofs.length < 2 || !traversal.shelters.length || map.hideSpots.length < 2) errors.push('Incomplete map traversal content');
  const supported = p => canOccupyBody(p, .42, 1.84, world) && Math.abs((supportBelow(p, .42, world)?.y ?? -100) - p.y) < 1e-8;
  for (const ladder of world.ladders) {
    for (const end of [ladder.bottom,ladder.top]) if (!supported(end.point) || supportBelow(end.point,.42,world)?.id!==end.supportId) errors.push(`Unsupported ladder endpoint ${ladder.id}`);
    for (let i=1;i<ladder.path.length;i++) {
      if (!sweepBodyClear(ladder.path[i-1],ladder.path[i],.42,1.84,world)) errors.push(`Blocked ladder body path ${ladder.id}`);
    }
  }
  for (const stair of world.stairs) for (const tread of stair.treads) {
    if (!supported(tread.point) || supportBelow(tread.point,.42,world)?.id!==tread.supportId) errors.push(`Unsupported stair tread ${stair.id}`);
  }
  const ids = new Set();
  for (const object of [...traversal.roofs, ...traversal.shelters, ...traversal.links, ...map.hideSpots]) {
    if (!object.id || ids.has(object.id)) errors.push(`Duplicate metadata ID ${object.id}`);
    ids.add(object.id);
  }
  for (const link of traversal.links) {
    if (!supported(link.from) || !supported(link.to)) errors.push(`Unsupported link ${link.id}`);
    if (!['walk', 'jump', 'drop', 'stair', 'ladder'].includes(link.kind) || link.width < 1.6 || link.depth < (link.kind==='stair'?.35:1.2)
      || !Number.isFinite(link.width) || !Number.isFinite(link.depth)) errors.push(`Narrow/invalid route ${link.id}`);
    if (link.kind==='ladder' && !world.ladders.some(l=>l.id===link.ladderId && l.routeId===link.routeId
      && distance(l.bottom.point,link.from)<1e-8 && distance(l.top.point,link.to)<1e-8)) errors.push(`Missing ladder access ${link.id}`);
    if (link.kind==='stair' && !world.stairs.some(s=>s.routeId===link.routeId && s.links.some(l=>l.fromSupportId===link.fromSupportId && l.toSupportId===link.toSupportId))) errors.push(`Missing stair access ${link.id}`);
    const rise = link.to.y - link.from.y;
    if (link.kind === 'jump' && (rise <= 0 || rise > .55 + 1e-8)) errors.push(`Impossible riser ${link.id}`);
    const supportId = supportBelow(link.to, .42, world)?.id;
    const landing = world.solids.find(s => s.id === supportId);
    if (landing) {
      const alongX = Math.abs(link.to.x - link.from.x) > Math.abs(link.to.z - link.from.z);
      if ((alongX ? landing.d : landing.w) < 1.6 || (alongX ? landing.w : landing.d) < (link.kind==='stair'?.35:1.2)) errors.push(`Narrow physical landing ${link.id}`);
    }
  }
  for (const roof of traversal.roofs) {
    if (!supported(roof.point)) errors.push(`Unsupported roof ${roof.id}`);
    if (roof.singleEntrance) {
      const entrances = traversal.links.filter(link => link.to.y === roof.point.y && distance(link.to, roof.point) < .05 && link.kind !== 'drop');
      if (entrances.length !== 1 || entrances[0].id !== roof.entryLinkId) errors.push(`Multiple roof entrances ${roof.id}`);
      if (!world.solids.some(s => s.id === roof.supportId)) errors.push(`Missing roof support ${roof.id}`);
    }
  }
  for (const shelter of traversal.shelters) if (!supported(shelter.point)) errors.push(`Blocked shelter ${shelter.id}`);
  for (const spot of map.hideSpots) {
    for (const name of ['entry', 'exit', 'recovery', 'occupant']) if (!supported(spot[name])) errors.push(`Blocked ${name}: ${spot.id}`);
    if (!spot.view || !Number.isFinite(spot.view.y) || Math.abs(spot.view.y - spot.occupant.y - 1.65) > .1
      || !segmentClear(spot.view, { ...spot.entry, y: spot.entry.y + 1.65 }, world)) errors.push(`Blocked view ${spot.id}`);
    if (distance(spot.entry, spot.occupant) > 1.5 || distance(spot.exit, spot.recovery) > 1
      || spot.entry.y !== spot.occupant.y || spot.exit.y !== spot.occupant.y || spot.recovery.y !== spot.exit.y) errors.push(`Invalid anchors ${spot.id}`);
    if (!spot.shellIds.length || spot.shellIds.some(id => !world.solids.some(s => s.id === id && s.hideSpotId === spot.id))) errors.push(`Invalid shell ${spot.id}`);
    if (['x', 'y', 'z'].some(axis => !Number.isFinite(spot.proxy?.min?.[axis]) || !Number.isFinite(spot.proxy?.max?.[axis])
      || spot.proxy.min[axis] >= spot.proxy.max[axis])) errors.push(`Invalid damage proxy ${spot.id}`);
    for (const [a, b] of [[spot.entry, spot.occupant], [spot.exit, spot.recovery]]) {
      for (let n = 0; n <= 8; n++) if (!canOccupyBody({ x: a.x + (b.x - a.x) * n / 8,
        y: a.y + (b.y - a.y) * n / 8, z: a.z + (b.z - a.z) * n / 8 }, .42, 1.84, world)) errors.push(`Blocked anchor passage ${spot.id}`);
    }
  }
  if (!errors.length) errors.push(...auditRoofApproaches(map).errors);
  return { ok: errors.length === 0, errors };
}

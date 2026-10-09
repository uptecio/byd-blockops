import { hasLineOfSight } from './collision.js';
import { createSpatialWorld, canOccupyBody, supportBelow } from './spatial.js';
import { ladderLength, projectLadder, sampleLadder } from './access-schema.js';

const STEP = .5, MAX_FIELDS = 32, EPS = 1e-7;
const point = p => ({ x: p.x, y: p.y ?? 0, z: p.z });
const finite = p => p && [p.x, p.y ?? 0, p.z].every(Number.isFinite);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const key = p => `${Math.round(p.x * 1e6)}:${Math.round(p.y * 1e6)}:${Math.round(p.z * 1e6)}`;

export function navigationIntent(body, waypoint, speed, world) {
  if (!waypoint || !finite(body) || !finite(waypoint) || !Number.isFinite(speed) || speed < 0) return { vx: 0, vz: 0, jump: false, climb:0 };
  if (waypoint.kind==='ladder') {
    const ladder=world.ladders?.find(l=>l.id===waypoint.ladderId);
    if (!ladder || !Number.isFinite(waypoint.ladderDistance)) return {vx:0,vz:0,jump:false,climb:0};
    const at=projectLadder(ladder,body).distance,delta=waypoint.ladderDistance-at;
    // Climbing is not throttled by zero horizontal distance or ground gun speed.
    const magnitude=Math.abs(delta)<1e-7?0:Math.max(.101,Math.min(1,Math.abs(delta)*60/2.4));
    return {vx:0,vz:0,jump:false,climb:Math.sign(delta)*magnitude};
  }
  const dx = waypoint.x - body.x, dz = waypoint.z - body.z, length = Math.hypot(dx, dz);
  const support = supportBelow(body, .4, world);
  return { vx: length > EPS ? dx / length * speed : 0, vz: length > EPS ? dz / length * speed : 0,
    jump: !!body.grounded && !!support && Math.abs(support.y - body.y) < EPS
      && waypoint.kind === 'jump' && waypoint.y > body.y + EPS && length <= 1.8, climb:0 };
}

export function createNavigation(map, { radius = .42, height = 1.84 } = {}) {
  const world = createSpatialWorld(map), { min, max } = world.bounds;
  if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(height) || height <= 0 || radius * 2 >= max - min)
    throw new Error('Navigation requires a positive body fitting within map bounds.');
  const origin = min + Math.ceil(radius / STEP) * STEP;
  const size = Math.floor((max - Math.ceil(radius / STEP) * STEP - origin) / STEP) + 1;
  const nodes = [], byKey = new Map(), buckets = new Map(), fields = new Map(), transitions = [],ladderNodes=new Map(),ladderEdges=new Map();
  const bucketKey = p => `${Math.floor((p.x - origin) / STEP)}:${Math.round(p.y * 1e6)}:${Math.floor((p.z - origin) / STEP)}`;
  const supported = (p, r = radius) => canOccupyBody(p, r, height, world) && Math.abs((supportBelow(p, r, world)?.y ?? -100) - p.y) < EPS;
  function clear(a, b, r = radius) {
    if (Math.abs(a.y - b.y) > EPS || !supported(a, r) || !supported(b, r)) return false;
    const dx = b.x - a.x, dz = b.z - a.z, square = dx * dx + dz * dz;
    if (!square) return true;
    for (const s of world.solids) {
      if (s.maxY <= a.y + EPS || s.minY >= a.y + height - EPS) continue;
      const minX = s.x - s.w / 2, maxX = s.x + s.w / 2, minZ = s.z - s.d / 2, maxZ = s.z + s.d / 2;
      if (Math.max(a.x, b.x) < minX - r || Math.min(a.x, b.x) > maxX + r || Math.max(a.z, b.z) < minZ - r || Math.min(a.z, b.z) > maxZ + r) continue;
      if (!hasLineOfSight({ x: a.x, z: a.z }, { x: b.x, z: b.z }, [s])) return false;
      for (const x of [minX, maxX]) for (const z of [minZ, maxZ]) {
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / square));
        if ((x - a.x - t * dx) ** 2 + (z - a.z - t * dz) ** 2 < r * r - 1e-10) return false;
      }
    }
    const samples = Math.ceil(Math.sqrt(square) / .1);
    for (let i = 1; i < samples; i++) if (!supported({ x: a.x + dx * i / samples, y: a.y, z: a.z + dz * i / samples }, r)) return false;
    return true;
  }
  function add(p) {
    if (!supported(p)) return -1;
    const k = key(p); if (byKey.has(k)) return byKey.get(k);
    if (nodes.length >= 40000) throw new Error('Navigation surface budget exceeded');
    const id = nodes.length; nodes.push({ point: { ...p }, edges: [], reverse: [] }); byKey.set(k, id);
    const bucket = bucketKey(p); if (!buckets.has(bucket)) buckets.set(bucket, []); buckets.get(bucket).push(id);
    return id;
  }
  function edge(from, to, kind = 'walk', linkId = null) {
    if (from < 0 || to < 0 || from === to || nodes[from].edges.some(e => e.to === to)) return;
    nodes[from].edges.push({ to, kind, linkId }); nodes[to].reverse.push(from);
  }
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) add({ x: origin + x * STEP, y: 0, z: origin + z * STEP });
  for (const solid of world.solids) {
    const x0 = Math.max(0, Math.ceil((solid.x - solid.w / 2 - origin) / STEP));
    const x1 = Math.min(size - 1, Math.floor((solid.x + solid.w / 2 - origin) / STEP));
    const z0 = Math.max(0, Math.ceil((solid.z - solid.d / 2 - origin) / STEP));
    const z1 = Math.min(size - 1, Math.floor((solid.z + solid.d / 2 - origin) / STEP));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) add({ x: origin + x * STEP, y: solid.maxY, z: origin + z * STEP });
  }
  // Cardinal edges retain the original no-corner-cutting behavior.
  for (let i = 0; i < nodes.length; i++) for (const [dx, dz] of [[STEP, 0], [0, STEP]]) {
    const a = nodes[i].point, b = { x: a.x + dx, y: a.y, z: a.z + dz }, next = byKey.get(key(b));
    if (next !== undefined && clear(a, b)) { edge(i, next); edge(next, i); }
  }
  function nearby(p) {
    const x = Math.floor((p.x - origin) / STEP), z = Math.floor((p.z - origin) / STEP), y = Math.round(p.y * 1e6), result = [];
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) result.push(...(buckets.get(`${x + dx}:${y}:${z + dz}`) ?? []));
    return result;
  }
  const endpoint = p => {
    const id = add(p); if (id < 0) throw new Error('Unsupported navigation route endpoint');
    for (const other of nearby(p)) if (other !== id && distance(p, nodes[other].point) <= .8 && clear(p, nodes[other].point)) { edge(id, other); edge(other, id); }
    return id;
  };
  for (const link of map.traversal?.links ?? []) {
    const from = endpoint(link.from), to = endpoint(link.to);
    const reverseKind=link.kind==='jump'?'drop':link.kind==='drop'?'jump':link.kind;
    edge(from, to, link.kind, link.id);
    edge(to, from, reverseKind, `${link.id}:reverse`);
    transitions.push({ from, to, kind: link.kind, linkId: link.id },
      { from: to, to: from, kind: reverseKind, linkId: `${link.id}:reverse` });
    if (link.kind==='ladder') {
      const ladder=world.ladders.find(l=>l.id===link.ladderId);
      if (!ladder) throw new Error('Missing navigation ladder');
      ladderNodes.set(ladder.id,{ladder,bottom:from,top:to});
      ladderEdges.set(link.id,{ladderId:ladder.id,ladderDistance:ladderLength(ladder)});
      ladderEdges.set(`${link.id}:reverse`,{ladderId:ladder.id,ladderDistance:0});
    }
  }
  function surface(p, r = radius) {
    if (!finite(p)) return null;
    const a = point(p), below = supportBelow(a, r, world);
    if (!below) return null;
    const projected = { ...a, y: below.y };
    return supported(projected, r) ? projected : null;
  }
  function cellFor(p) {
    const projected = surface(p); if (!projected) return -1;
    let best = -1, bestDistance = Infinity;
    for (const id of nearby(projected)) {
      const d = distance(projected, nodes[id].point);
      if (d < bestDistance && d <= .8 && clear(projected, nodes[id].point)) { best = id; bestDistance = d; }
    }
    return best;
  }
  function fieldFor(goal) {
    if (fields.has(goal)) { const field = fields.get(goal); fields.delete(goal); fields.set(goal, field); return field; }
    const field = new Int32Array(nodes.length).fill(-1), queue = new Int32Array(nodes.length);
    let head = 0, tail = 1; queue[0] = goal; field[goal] = 0;
    while (head < tail) {
      const i = queue[head++];
      for (const previous of nodes[i].reverse) if (field[previous] < 0) { field[previous] = field[i] + 1; queue[tail++] = previous; }
    }
    if (fields.size === MAX_FIELDS) fields.delete(fields.keys().next().value);
    fields.set(goal, field); return field;
  }
  const waypoint = (p, kind = 'walk', linkId = null) => ({ ...p, kind, linkId,...(kind==='ladder'?ladderEdges.get(linkId):{}) });
  const climbWaypoint=(ladder,at)=>({...sampleLadder(ladder,at),kind:'ladder',linkId:null,ladderId:ladder.id,ladderDistance:at});
  const attached=p=>p?.ladderId?ladderNodes.get(p.ladderId):null;
  function cellsFor(p) {
    if (p?.ladderId) { const entry=attached(p); return entry?[entry.bottom,entry.top]:[]; }
    const cell=cellFor(p); return cell<0?[]:[cell];
  }
  function goalLanding(from,goal) {
    const entry=attached(goal); if (!entry) return null;
    const at=projectLadder(entry.ladder,goal).distance,length=ladderLength(entry.ladder);
    let best=null,score=Infinity;
    for (const [cell,d] of [[entry.bottom,at],[entry.top,length-at]]) {
      const field=fieldFor(cell);
      for (const start of cellsFor(from)) if (field[start]>=0 && field[start]+d/STEP<score) {
        best=nodes[cell].point; score=field[start]+d/STEP;
      }
    }
    return best;
  }
  const api = {
    nextWaypoint(from, goal) {
      if (!finite(from) || !finite(goal)) return null;
      if ((from.ladderId && !attached(from)) || (goal.ladderId && !attached(goal))) return null;
      if (from.ladderId && from.ladderId===goal.ladderId) return climbWaypoint(attached(from).ladder,projectLadder(attached(from).ladder,goal).distance);
      if (goal.ladderId) {
        const landing=goalLanding(from,goal); if (!landing) return null;
        if (!from.ladderId && from.grounded!==false && Math.hypot(from.x-landing.x,from.y-landing.y,from.z-landing.z)<.06)
          return climbWaypoint(attached(goal).ladder,projectLadder(attached(goal).ladder,goal).distance);
        return api.nextWaypoint(from,landing);
      }
      const end = cellFor(goal);
      if (end < 0) return null;
      const field = fieldFor(end);
      if (from.ladderId) {
        const entry=attached(from),at=projectLadder(entry.ladder,from).distance,length=ladderLength(entry.ladder);
        let best=null,score=Infinity,travel=Infinity;
        // Follow the graph's downhill field. Adding physical distance to its
        // unweighted edge count would repeatedly choose the near entry again.
        for (const [cell,d] of [[entry.bottom,0],[entry.top,length]]) if (field[cell]>=0
          && (field[cell]<score || (field[cell]===score && Math.abs(d-at)<travel))) {
          best=d; score=field[cell]; travel=Math.abs(d-at);
        }
        return best===null?null:climbWaypoint(entry.ladder,best);
      }
      // A route transition must finish at its landing, not be snapped back to
      // the last ground cell while its feet are in the air.
      for (const transition of transitions) {
        if (field[transition.to] < 0 || field[transition.to] >= field[transition.from]) continue;
        const a = nodes[transition.from].point, b = nodes[transition.to].point;
        if (transition.kind==='ladder') continue;
        if (transition.kind==='stair') {
          if (from.grounded===false || Math.hypot(from.x-b.x,from.y-b.y,from.z-b.z)<.04) continue;
        } else if (from.grounded !== false && (transition.kind !== 'drop' || Math.abs(from.y - a.y) > EPS)) continue;
        const dx = b.x - a.x, dz = b.z - a.z, square = dx * dx + dz * dz;
        if (square<EPS*EPS) continue;
        const t = ((from.x - a.x) * dx + (from.z - a.z) * dz) / square;
        const sideways = Math.hypot(from.x - a.x - t * dx, from.z - a.z - t * dz);
        if (t >= -.01 && t <= 1.01 && sideways < .25 && from.y >= Math.min(a.y, b.y) - EPS && from.y <= Math.max(a.y, b.y) + .72)
          return waypoint(b, transition.kind, transition.linkId);
      }
      const start = cellFor(from);
      if (start < 0) return null;
      const a = surface(from), b = surface(goal);
      if (field[start] < 0) return null;
      if (start === end && clear(a, b)) return waypoint(b);
      const snapped = nodes[start].point;
      for (const e of nodes[start].edges) if (field[e.to] === field[start] - 1) {
        const target = nodes[e.to].point;
        if (e.kind === 'walk') { if (clear(a, target)) return waypoint(target); }
        else if (distance(a, snapped) < .06) return waypoint(target, e.kind, e.linkId);
      }
      if (distance(a, snapped) > EPS) return waypoint(snapped);
      return null;
    },
    reachable(from, goal) { return cellsFor(from).some(a=>cellsFor(goal).some(b=>fieldFor(b)[a]>=0)); },
    nextApproachWaypoint(from, goal, goalRadius) {
      if (!Number.isFinite(goalRadius) || goalRadius <= 0 || goalRadius > radius) return null;
      if (goal?.ladderId || from?.ladderId) return api.nextWaypoint(from,goal);
      const p = surface(goal, goalRadius); if (!p) return null;
      if (cellFor(p) >= 0) return api.nextWaypoint(from, p);
      const candidates = nearby(p).map(id => nodes[id].point).filter(q => distance(p, q) <= .75 && clear(p, q, goalRadius)).sort((a, b) => distance(a, p) - distance(b, p));
      for (const q of candidates) if (api.reachable(from, q)) return api.nextWaypoint(from, q);
      return null;
    },
    patrolPoint(actorId, position, sequence = 0) {
      const points = map.traversal?.patrolPoints ?? [];
      if (!points.length) return null;
      const seed = Array.from(String(actorId)).reduce((sum, c) => sum + c.charCodeAt(0), Math.trunc(sequence));
      for (let i = 0; i < points.length; i++) {
        const p = points[((seed + i) % points.length + points.length) % points.length];
        if (distance(position, p) > .25 && api.reachable(position, p)) return point(p);
      }
      return null;
    },
    clearCache() { fields.clear(); },
    stats() { return {nodes:nodes.length,cachedFields:fields.size}; },
  };
  return api;
}

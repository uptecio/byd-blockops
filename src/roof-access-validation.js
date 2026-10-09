import { createSpatialWorld } from './spatial.js';
import { MOVEMENT } from './movement-constants.js';

const EPS=1e-7;
const footprint=(s,r=0)=>({minX:s.x-s.w/2-r,maxX:s.x+s.w/2+r,minZ:s.z-s.d/2-r,maxZ:s.z+s.d/2+r});
const within=(p,r)=>p.x>=r.minX-EPS && p.x<=r.maxX+EPS && p.z>=r.minZ-EPS && p.z<=r.maxZ+EPS;
const interior=(p,r)=>p.x>r.minX+EPS && p.x<r.maxX-EPS && p.z>r.minZ+EPS && p.z<r.maxZ-EPS;
const corners=r=>[{x:r.minX,z:r.minZ},{x:r.minX,z:r.maxZ},{x:r.maxX,z:r.minZ},{x:r.maxX,z:r.maxZ}];
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
function closest(a,b) {
  const axis=(lo,hi,lo2,hi2)=>hi<lo2?[hi,lo2]:hi2<lo?[lo,hi2]:[(Math.max(lo,lo2)+Math.min(hi,hi2))/2,(Math.max(lo,lo2)+Math.min(hi,hi2))/2];
  const x=axis(a.minX,a.maxX,b.minX,b.maxX),z=axis(a.minZ,a.maxZ,b.minZ,b.maxZ);
  return [{x:x[0],z:z[0]},{x:x[1],z:z[1]}];
}

function visible(a,b,blocks) {
  for (const r of blocks) {
    let enter=0,leave=1,miss=false;
    for (const [axis,low,high] of [['x',r.minX+EPS,r.maxX-EPS],['z',r.minZ+EPS,r.maxZ-EPS]]) {
      const delta=b[axis]-a[axis];
      if (Math.abs(delta)<1e-12) { if (a[axis]<low || a[axis]>high) {miss=true;break;} }
      else {
        const u=(low-a[axis])/delta,v=(high-a[axis])/delta;
        enter=Math.max(enter,Math.min(u,v)); leave=Math.min(leave,Math.max(u,v));
        if (enter>leave) {miss=true;break;}
      }
    }
    if (!miss && enter<=leave) return false;
  }
  return true;
}

// Shortest paths around axis-aligned rectangle unions turn only at union
// vertices. Endpoints range over whole launch/landing rectangles, not samples.
function detourExceeds(from,to,blocks,budget) {
  const pair=closest(from,to);
  if (distance(...pair)>budget+EPS) return true;
  if (!blocks.length || visible(...pair,blocks)) return false;
  let vertices=blocks.flatMap(corners);
  for (let i=0;i<blocks.length;i++) for (let j=i+1;j<blocks.length;j++) {
    const a=blocks[i],b=blocks[j];
    for (const x of [a.minX,a.maxX]) for (const z of [b.minZ,b.maxZ]) {
      const p={x,z}; if (within(p,a) && within(p,b)) vertices.push(p);
    }
    for (const x of [b.minX,b.maxX]) for (const z of [a.minZ,a.maxZ]) {
      const p={x,z}; if (within(p,a) && within(p,b)) vertices.push(p);
    }
  }
  vertices=vertices.filter(p=>!blocks.some(r=>interior(p,r)));
  // A bounded authoring audit must fail conservatively, never certify by
  // truncating the visibility graph when geometry is excessively complex.
  if (vertices.length>512) return false;
  const points=[],keys=new Set();
  const add=p=>{
    const key=`${p.x}:${p.z}`;
    if (!keys.has(key) && !blocks.some(r=>interior(p,r))) {keys.add(key);points.push(p);}
  };
  for (const p of [...vertices,...corners(from),...corners(to),...pair]) add(p);
  const seeds=[...points];
  for (const region of [from,to]) for (const p of seeds) {
    for (const x of [region.minX,region.maxX]) add({x,z:Math.max(region.minZ,Math.min(region.maxZ,p.z))});
    for (const z of [region.minZ,region.maxZ]) add({z,x:Math.max(region.minX,Math.min(region.maxX,p.x))});
  }
  if (points.length>2048) return false;
  const costs=points.map(p=>within(p,from)?0:Infinity),done=new Set();
  for (;;) {
    let best=-1,cost=Infinity;
    for (let i=0;i<points.length;i++) if (!done.has(i) && costs[i]<cost) {best=i;cost=costs[i];}
    if (best<0 || cost>budget+EPS) return true;
    if (within(points[best],to)) return false;
    done.add(best);
    for (let i=0;i<points.length;i++) {
      const next=cost+distance(points[best],points[i]);
      if (!done.has(i) && next<costs[i] && next<=budget+EPS && visible(points[best],points[i],blocks)) costs[i]=next;
    }
  }
}

export function auditRoofApproaches(map,{radius=.42,height=1.84,maxSpeed=6}={}) {
  if (![radius,height,maxSpeed].every(Number.isFinite) || radius<=0 || height<=0 || maxSpeed<=0)
    return {ok:false,errors:['Invalid roof audit body/speed'],byRoof:[]};
  let world;
  try {world=createSpatialWorld(map);} catch(error) {return {ok:false,errors:[error.message],byRoof:[]};}
  const roofs=map.traversal?.roofs ?? [],guards=new Set(roofs.flatMap(r=>r.guardSolidIds ?? []));
  const allRouteSolids=new Set(roofs.flatMap(r=>r.routeSolidIds ?? []).filter(id=>!guards.has(id)));
  const fixed=world.solids.filter(s=>!allRouteSolids.has(s.id));
  const nodes=[{id:'ground',rect:{minX:world.bounds.min,maxX:world.bounds.max,minZ:world.bounds.min,maxZ:world.bounds.max},low:0,high:0}];
  for (const s of world.solids) {
    const box=footprint(s);
    if (box.maxX<=world.bounds.min || box.minX>=world.bounds.max || box.maxZ<=world.bounds.min || box.minZ>=world.bounds.max) continue;
    // Only immutable/fixed occluders can hide a surface in the shared graph:
    // removing an approach later must not reveal a surface we omitted here.
    if (fixed.some(c=>c.id!==s.id && c.maxY>s.maxY+EPS && c.minY<s.maxY+height-EPS
      && c.x-c.w/2<=box.minX && c.x+c.w/2>=box.maxX && c.z-c.d/2<=box.minZ && c.z+c.d/2>=box.maxZ)) continue;
    nodes.push({id:s.id,rect:footprint(s,radius),low:s.maxY,high:s.maxY});
  }
  const byId=new Map(nodes.map((node,i)=>[node.id,i]));
  const ladderNodes=[];
  for (const ladder of world.ladders) {
    const indices=[];
    for (let i=1;i<ladder.path.length;i++) {
      const a=ladder.path[i-1],b=ladder.path[i]; indices.push(nodes.length);
      nodes.push({id:`${ladder.id}:segment:${i}`,virtual:true,routeId:ladder.routeId,
        rect:{minX:Math.min(a.x,b.x)-radius,maxX:Math.max(a.x,b.x)+radius,minZ:Math.min(a.z,b.z)-radius,maxZ:Math.max(a.z,b.z)+radius},
        low:Math.min(a.y,b.y),high:Math.max(a.y,b.y)});
    }
    ladderNodes.push({ladder,indices});
  }
  const apex=MOVEMENT.jumpVelocity**2/(2*MOVEMENT.gravity),edgeCache=new Map();
  function possible(a,b) {
    const key=`${a}:${b}`; if (edgeCache.has(key)) return edgeCache.get(key);
    const source=nodes[a],target=nodes[b],rise=target.high-source.high;
    if (target.virtual || rise>apex+EPS) {edgeCache.set(key,false);return false;}
    const flight=(MOVEMENT.jumpVelocity+Math.sqrt(Math.max(0,MOVEMENT.jumpVelocity**2-2*MOVEMENT.gravity*rise)))/MOVEMENT.gravity;
    const budget=maxSpeed*flight;
    if (distance(...closest(source.rect,target.rect))>budget+EPS) {edgeCache.set(key,false);return false;}
    const low=Math.min(source.low,target.low),high=source.high+apex;
    // Expand by a square INSIDE the body's disk, never its circumscribed box.
    // These certified obstacles are a subset of real collisions at every
    // possible transition height, so their shortest detour is a lower bound.
    // Solo's .34 body can pass narrower gaps than .4 bots/online actors.
    // Use the widest support reach above, but the smallest collision body here.
    const inset=Math.min(radius,.34)/Math.SQRT2-EPS;
    const blocks=fixed.filter(s=>s.maxY>high+EPS && s.minY<low+height-EPS).map(s=>footprint(s,inset));
    const result=!detourExceeds(source.rect,target.rect,blocks,budget);
    edgeCache.set(key,result); return result;
  }
  const errors=[],byRoof=[];
  for (const roof of roofs.filter(r=>r.singleEntrance)) {
    const omitted=new Set((roof.routeSolidIds ?? []).filter(id=>!guards.has(id)));
    const routeId=roof.routeId ?? map.traversal.links?.find(l=>l.id===roof.entryLinkId)?.routeId;
    const target=byId.get(roof.supportId),reached=new Set(),queue=[];
    const mark=i=>{if (i!==undefined && !reached.has(i) && !omitted.has(nodes[i].id)
      && !(nodes[i].virtual && routeId && nodes[i].routeId===routeId)) {reached.add(i);queue.push(i);}};
    mark(0);
    for (const other of roofs) if (other.id!==roof.id) mark(byId.get(other.supportId));
    for (let head=0;head<queue.length && !reached.has(target);head++) {
      const source=queue[head];
      for (const entry of ladderNodes) if (entry.ladder.routeId!==routeId
        && (nodes[source].id===entry.ladder.bottom.supportId || nodes[source].id===entry.ladder.top.supportId)) {
        for (const i of entry.indices) mark(i);
        mark(byId.get(entry.ladder.bottom.supportId)); mark(byId.get(entry.ladder.top.supportId));
      }
      for (let next=1;next<nodes.length;next++) if (!reached.has(next) && !omitted.has(nodes[next].id) && !nodes[next].virtual && possible(source,next)) mark(next);
    }
    const bypassPossible=target===undefined || reached.has(target);
    byRoof.push({id:roof.id,bypassPossible});
    if (bypassPossible) errors.push(`Alternative roof approach ${roof.id}`);
  }
  return {ok:errors.length===0,errors,byRoof};
}

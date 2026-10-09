// Pure authored metadata: no map, renderer, physics or navigation imports.
const EPS = 1e-8;
const point = p => !!p && [p.x,p.y,p.z].every(Number.isFinite);
const id = value => typeof value === 'string' && value.length > 0;
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const copyPoint = p => ({x:p.x,y:p.y,z:p.z});
const rect = r => !!r && [r.minX,r.maxX,r.minZ,r.maxZ].every(Number.isFinite) && r.minX<r.maxX && r.minZ<r.maxZ;
const fail = message => { throw new Error(`Invalid access: ${message}`); };

function validPath(ladder) {
  if (!Array.isArray(ladder?.path) || ladder.path.length<2 || ladder.path.length>256
    || !ladder.path.every(point)) fail('ladder path');
  for (let i=1;i<ladder.path.length;i++) if (distance(ladder.path[i-1],ladder.path[i])<=EPS) fail('ladder zero-length segment');
}

export function ladderLength(ladder) {
  validPath(ladder);
  let total=0;
  for (let i=1;i<ladder.path.length;i++) total+=distance(ladder.path[i-1],ladder.path[i]);
  if (!Number.isFinite(total)) fail('ladder length');
  return total;
}

export function sampleLadder(ladder, at) {
  if (!Number.isFinite(at)) fail('ladder distance');
  const length=ladderLength(ladder);
  let remaining=Math.max(0,Math.min(length,at));
  for (let i=1;i<ladder.path.length;i++) {
    const a=ladder.path[i-1],b=ladder.path[i],span=distance(a,b);
    if (remaining<=span) {
      const t=remaining/span;
      return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t};
    }
    remaining-=span;
  }
  return copyPoint(ladder.path[ladder.path.length-1]);
}

export function projectLadder(ladder, p) {
  if (!point(p)) fail('ladder point');
  validPath(ladder);
  let travelled=0, best={distance:0,error:Infinity};
  for (let i=1;i<ladder.path.length;i++) {
    const a=ladder.path[i-1],b=ladder.path[i],dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,span=distance(a,b);
    const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy+(p.z-a.z)*dz)/(span*span)));
    const error=distance(p,{x:a.x+t*dx,y:a.y+t*dy,z:a.z+t*dz});
    if (error<best.error) best={distance:travelled+t*span,error};
    travelled+=span;
  }
  return best;
}

export function normalizeAccess(map) {
  const source=map.traversal ?? {}, stairs=source.stairs ?? [], ladders=source.ladders ?? [];
  if (!Array.isArray(stairs) || !Array.isArray(ladders) || stairs.length+ladders.length>256) fail('stairs/ladders collections');
  const ids=new Set();
  const identity = record => {
    if (!record || !id(record.id) || !id(record.routeId) || ids.has(record.id)) fail('duplicate/invalid stair or ladder ID');
    ids.add(record.id);
  };
  const result={stairs:[],ladders:[]};
  for (const ladder of ladders) {
    identity(ladder); ladderLength(ladder);
    if (!Number.isFinite(ladder.width) || ladder.width<1.6) fail(`ladder width ${ladder.id}`);
    const ends={};
    for (const [name,index] of [['bottom',0],['top',ladder.path.length-1]]) {
      const end=ladder[name],zone=end?.zone,p=end?.point;
      if (!point(p) || !id(end.supportId) || !rect(zone) || distance(p,ladder.path[index])>EPS
        || zone.minX>p.x || zone.maxX<p.x || zone.minZ>p.z || zone.maxZ<p.z
        || Math.max(p.x-zone.minX,zone.maxX-p.x,p.z-zone.minZ,zone.maxZ-p.z)>.6+EPS) fail(`ladder ${name} entry zone/path`);
      ends[name]={point:copyPoint(p),supportId:end.supportId,zone:{...zone}};
    }
    if (ladder.top.point.y<=ladder.bottom.point.y) fail('ladder endpoint heights');
    result.ladders.push({id:ladder.id,routeId:ladder.routeId,width:ladder.width,path:ladder.path.map(copyPoint),...ends});
  }
  for (const stair of stairs) {
    identity(stair);
    if (!Array.isArray(stair.treads) || stair.treads.length<2 || stair.treads.length>256
      || !Array.isArray(stair.links) || stair.links.length!==stair.treads.length-1) fail('stair treads/links');
    const supports=new Set();
    for (const [i,tread] of stair.treads.entries()) {
      if (!tread || !id(tread.supportId) || supports.has(tread.supportId) || !point(tread.point)
        || !Number.isFinite(tread.clearWidth) || tread.clearWidth<1.6
        || !Number.isFinite(tread.run) || typeof tread.landing!=='boolean') fail('stair tread');
      supports.add(tread.supportId);
      if (tread.run<(tread.landing?1.2:.35)-EPS) fail('stair tread/landing run');
      if ((i===0 || i===stair.treads.length-1) && !tread.landing) fail('stair endpoint landing');
      if (i>0) {
        const previous=stair.treads[i-1],link=stair.links[i-1],rise=tread.point.y-previous.point.y;
        if (rise< -EPS || rise>.25+EPS || !rect(link?.corridor)
          || link.fromSupportId!==previous.supportId || link.toSupportId!==tread.supportId) fail('stair adjacency/riser');
      }
    }
    result.stairs.push({id:stair.id,routeId:stair.routeId,
      treads:stair.treads.map(t=>({...t,point:copyPoint(t.point)})),links:stair.links.map(l=>({...l,corridor:{...l.corridor}}))});
  }
  return result;
}

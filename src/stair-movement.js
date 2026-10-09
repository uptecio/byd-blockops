import { supportBelow, sweepBodyClear } from './spatial.js';

const EPS=1e-8;

export function stepStair(body,candidate,{world,radius,height}) {
  if (!body.grounded || body.velocityY>0) return null;
  for (const stair of world.stairs ?? []) for (let i=0;i<stair.links.length;i++) {
    const link=stair.links[i],a=stair.treads[i],b=stair.treads[i+1];
    const from=body.supportId===a.supportId?a:body.supportId===b.supportId?b:null;
    if (!from) continue;
    const to=from===a?b:a,dx=to.point.x-from.point.x,dz=to.point.z-from.point.z;
    if ((candidate.x-body.x)*dx+(candidate.z-body.z)*dz<=0) continue;
    const c=link.corridor,alongX=Math.abs(dx)>Math.abs(dz);
    const inside=p=>p.x>=c.minX+(alongX?0:radius)-EPS && p.x<=c.maxX-(alongX?0:radius)+EPS
      && p.z>=c.minZ+(alongX?radius:0)-EPS && p.z<=c.maxZ-(alongX?radius:0)+EPS;
    if (!inside(body) || !inside(candidate) || Math.abs(body.y-from.point.y)>EPS) continue;
    const target={...candidate,y:to.point.y,velocityY:0,grounded:true,supportId:to.supportId};
    const support=supportBelow(target,radius,world);
    if (!support || support.id!==to.supportId || Math.abs(support.y-target.y)>EPS) continue;
    const corner=target.y>body.y?{...body,y:target.y}:{...candidate,y:body.y};
    if (sweepBodyClear(body,corner,radius,height,world) && sweepBodyClear(corner,target,radius,height,world)) return target;
  }
  return null;
}

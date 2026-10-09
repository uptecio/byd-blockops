import { ladderLength, sampleLadder, projectLadder } from './access-schema.js';
import { supportBelow, sweepBodyClear } from './spatial.js';

const EPS=1e-8, SPEED=2.4, DEADZONE=.1;
const inZone=(p,end)=>Math.abs(p.y-end.point.y)<EPS && p.x>=end.zone.minX-EPS && p.x<=end.zone.maxX+EPS
  && p.z>=end.zone.minZ-EPS && p.z<=end.zone.maxZ+EPS;
const released=body=>({...body,ladderId:null,ladderDistance:0,grounded:false,supportId:null,velocityY:0});

function pathClear(ladder,body,at,radius,height,world) {
  const from=body.ladderDistance,lo=Math.min(from,at),hi=Math.max(from,at),cuts=[];
  let total=0;
  for (let i=1;i<ladder.path.length;i++) {
    const a=ladder.path[i-1],b=ladder.path[i]; total+=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);
    if (total>lo && total<hi) cuts.push(total);
  }
  if (at<from) cuts.reverse(); cuts.push(at);
  let previous=body;
  for (const distance of cuts) {
    const next=sampleLadder(ladder,distance);
    if (!sweepBodyClear(previous,next,radius,height,world)) return false;
    previous=next;
  }
  return true;
}

export function stepLadder(body,intent,dt,{world,radius,height}) {
  let next={...body},climb=Math.max(-1,Math.min(1,intent.climb ?? 0));
  const result=(handled=false,invalid=false,consumeJump=false)=>({body:next,handled,invalid,consumeJump});
  const ladders=world.ladders ?? [];
  if (next.ladderBlockedId) {
    const blocked=ladders.find(l=>l.id===next.ladderBlockedId);
    if (!blocked || Math.abs(climb)<=DEADZONE || projectLadder(blocked,next).error>.6) next.ladderBlockedId=null;
  }
  let ladder=ladders.find(l=>l.id===next.ladderId);
  if (next.ladderId) {
    if (!ladder || !Number.isFinite(next.ladderDistance) || next.ladderDistance<0 || next.ladderDistance>ladderLength(ladder)
      || Math.hypot(next.x-sampleLadder(ladder,next.ladderDistance).x,next.y-sampleLadder(ladder,next.ladderDistance).y,
        next.z-sampleLadder(ladder,next.ladderDistance).z)>.0001) return result(false,true);
    if (intent.jump) {
      next={...released(next),ladderBlockedId:ladder.id}; return result(false,false,true);
    }
  } else {
    if (!next.grounded || intent.jump || Math.abs(climb)<.25 || next.alive===false || next.health<=0
      || next.hiddenSpotId || next.respawnRemaining>0) return result();
    for (const candidate of ladders) {
      if (candidate.id===next.ladderBlockedId) continue;
      const end=climb>0?candidate.bottom:candidate.top;
      if (next.supportId!==end.supportId || !inZone(next,end)) continue;
      // Looking away/sideways while outside the centerline must not pull a
      // walking player backwards onto a ladder. AI already on-center may
      // provide only its climb axis.
      const dx=end.point.x-next.x,dz=end.point.z-next.z,distance=Math.hypot(dx,dz);
      if (distance>EPS && Math.hypot(intent.vx,intent.vz)>EPS && dx*intent.vx+dz*intent.vz< -EPS) continue;
      const fraction=distance?Math.min(1,SPEED*Math.abs(climb)*dt/distance):1;
      const aligned={...next,x:next.x+dx*fraction,z:next.z+dz*fraction};
      if (!sweepBodyClear(next,aligned,radius,height,world) || supportBelow(aligned,radius,world)?.id!==end.supportId) return result(true);
      next=aligned;
      if (fraction<1) return result(true);
      ladder=candidate; next.ladderId=ladder.id; next.ladderDistance=climb>0?0:ladderLength(ladder);
      next.velocityY=0; next.grounded=false; next.supportId=null;
      if (distance>EPS) return result(true);
      break;
    }
    if (!ladder) return result();
  }
  next.velocityY=0; next.grounded=false; next.supportId=null;
  if (Math.abs(climb)<=DEADZONE) return result(true);
  const length=ladderLength(ladder),attempt=Math.max(0,Math.min(length,next.ladderDistance+climb*SPEED*dt));
  let accepted=attempt;
  if (!pathClear(ladder,next,attempt,radius,height,world)) {
    let safe=next.ladderDistance,blocked=attempt;
    for (let n=0;n<16;n++) {
      const middle=(safe+blocked)/2;
      if (pathClear(ladder,next,middle,radius,height,world)) safe=middle; else blocked=middle;
    }
    accepted=safe;
  }
  Object.assign(next,sampleLadder(ladder,accepted),{ladderDistance:accepted});
  if (accepted<=EPS || accepted>=length-EPS) {
    const end=accepted<=EPS?ladder.bottom:ladder.top,support=supportBelow(next,radius,world);
    if (support?.id===end.supportId && Math.abs(support.y-next.y)<EPS) {
      Object.assign(next,{...end.point,ladderId:null,ladderDistance:0,grounded:true,supportId:end.supportId});
    }
  }
  return result(true);
}

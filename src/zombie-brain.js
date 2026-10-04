import { canOccupy, moveCircle } from './collision.js';
import { meleeTarget, smokeBlocksSight } from './gear-combat.js';
import { ZOMBIE_BALANCE as balance } from './zombie-survival.js';

const radius = .4;
const point = a => ({ x:a.x, z:a.z });
const distance = (a,b) => Math.hypot(a.x-b.x,a.z-b.z);
const finite = a => a && [a.x,a.y,a.z,a.yaw,a.pitch].every(Number.isFinite);
const eye = a => ({ x:a.x,y:a.y+1.6,z:a.z });

export function selectZombieSpawn({ map,navigation,player,zombies,fovRadians }) {
  if (!finite(player) || !player.alive) return null;
  const candidates=[], seen=new Set();
  const locations=[...map.spawns,map.playerSpawn,...Object.values(map.teamSpawns).flat()];
  for (const p of locations) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
    const key=`${p.x}:${p.z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (p.x < map.bounds.min+radius || p.x > map.bounds.max-radius
      || p.z < map.bounds.min+radius || p.z > map.bounds.max-radius
      || distance(p,player) < balance.spawnDistance || !canOccupy(p.x,p.z,radius,map.solids)
      || zombies.some(z => z.alive && distance(p,z) < balance.separation)
      || !navigation.nextApproachWaypoint(p,player,.34)) continue;
    const dot=((p.x-player.x)*-Math.sin(player.yaw)+(p.z-player.z)*-Math.cos(player.yaw))/distance(p,player);
    const outside=dot < Math.cos((Number.isFinite(fovRadians) ? fovRadians : Math.PI/2)/2);
    candidates.push({ p,outside });
  }
  const chosen=candidates.find(c => c.outside) || candidates[0];
  return chosen ? point(chosen.p) : null;
}

export function createZombieBrain(kind) {
  if (kind !== 'walker' && kind !== 'runner') throw new RangeError('Unknown zombie kind');
  return { goal:null,waypoint:null,pathRemaining:0,attackRemaining:balance[kind].interval };
}

export function stepZombieBrain(brain,{ actor,player,zombies,navigation,solids,smokes,dt }) {
  const result={ x:actor.x,z:actor.z,yaw:actor.yaw,attack:false };
  if (!Number.isFinite(dt) || dt <= 0 || !finite(actor) || !finite(player) || !actor.alive || !player.alive) return result;
  const config=balance[actor.kind];
  if (!config || actor.flashRemaining > 0) return result;
  brain.attackRemaining=Math.max(0,brain.attackRemaining-dt);
  brain.pathRemaining=Math.max(0,brain.pathRemaining-dt);
  const concealed=smokeBlocksSight(eye(actor),eye(player),smokes);
  if (!concealed) brain.goal=point(player);
  if (!brain.goal) return result;
  if (brain.pathRemaining <= 1e-9 || (brain.waypoint && distance(actor,brain.waypoint) < 1e-8)) {
    brain.waypoint=navigation.nextApproachWaypoint(actor,brain.goal,.34);
    brain.pathRemaining=balance.pathInterval;
  }
  // Stop at touching distance; never move the human to resolve crowding.
  if (brain.waypoint && distance(actor,brain.goal) > .9) {
    const dx=brain.waypoint.x-actor.x,dz=brain.waypoint.z-actor.z,length=Math.hypot(dx,dz);
    if (length > 1e-9) {
      const step=Math.min(config.speed*dt,length,Math.max(0,distance(actor,brain.goal)-.9));
      Object.assign(result,moveCircle(actor,dx/length*step,dz/length*step,radius,solids));
    }
  }
  let pushX=0,pushZ=0;
  for (const other of zombies) {
    if (other.id === actor.id || !other.alive) continue;
    const dx=result.x-other.x,dz=result.z-other.z,length=Math.hypot(dx,dz);
    if (length >= balance.separation) continue;
    const push=(balance.separation-length)/2;
    pushX+=(length > 1e-9 ? dx/length : actor.id < other.id ? -1 : 1)*push;
    pushZ+=(length > 1e-9 ? dz/length : 0)*push;
  }
  const length=Math.hypot(pushX,pushZ),scale=length > 0 ? Math.min(length,config.speed*dt)/length : 0;
  Object.assign(result,moveCircle(result,pushX*scale,pushZ*scale,radius,solids));
  if (distance(result,brain.goal) > 1e-9) result.yaw=Math.atan2(result.x-brain.goal.x,result.z-brain.goal.z);
  if (!concealed && brain.attackRemaining <= 1e-9
    && meleeTarget({ ...actor,...result },[player],{ solids,isEnemy:(a,b) => a===actor.id && b===player.id })) {
    result.attack=true;
    brain.attackRemaining=config.interval;
  }
  return result;
}

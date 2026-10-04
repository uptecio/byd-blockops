import test from 'node:test';
import assert from 'node:assert/strict';
import { createZombieBrain, selectZombieSpawn, stepZombieBrain } from '../src/zombie-brain.js';
import { ZOMBIE_BALANCE } from '../src/zombie-survival.js';
import { MAPS } from '../src/maps.js';
import { createNavigation } from '../src/navigation.js';
import { canOccupy } from '../src/collision.js';

const actor = (extra = {}) => ({ id:'zombie-1', kind:'walker', x:0, y:0, z:0, yaw:0, pitch:0,
  alive:true, health:100, lifeId:1, teamId:null, equipment:null, protectedRemaining:0, flashRemaining:0, ...extra });
const player = extra => actor({ id:'local', x:0, z:-10, ...extra });
const map = (extra = {}) => ({ bounds:{ min:-22, max:22 }, solids:[], spawns:[{ x:0, z:-10 }, { x:0, z:10 }],
  playerSpawn:{ x:0, z:0 }, teamSpawns:{ red:[], blue:[] }, ...extra });
function context(extra = {}) {
  return { actor:actor(), player:player(), zombies:[], navigation:createNavigation(map(), { radius:.4 }),
    solids:[], smokes:[], dt:.05, ...extra };
}

test('spawn prefers outside view, deduplicates authored locations and obeys distances', () => {
  const arena = map(), navigation = createNavigation(arena, { radius:.4 });
  const args = { map:arena, navigation, player:player({ z:0 }), zombies:[], fovRadians:Math.PI/2 };
  assert.deepEqual(selectZombieSpawn(args), { x:0, z:10 });
  assert.deepEqual(selectZombieSpawn({ ...args, zombies:[actor({ z:10 })] }), { x:0, z:-10 });
  assert.deepEqual(selectZombieSpawn({ ...args, zombies:[actor({ z:10, alive:false })] }), { x:0, z:10 });
  assert.equal(selectZombieSpawn({ ...args, zombies:[actor({ z:10 }), actor({ z:-10 })] }), null);
  const invalid = map({ spawns:[{ x:0, z:7.99 }, { x:22, z:0 }, { x:NaN, z:10 }], playerSpawn:{ x:0, z:0 } });
  assert.equal(selectZombieSpawn({ ...args, map:invalid }), null);
  const blocked = map({ solids:[{ x:0,z:10,w:2,d:2,height:3 }], spawns:[{ x:0,z:10 }] });
  assert.equal(selectZombieSpawn({ ...args, map:blocked, navigation:createNavigation(blocked) }), null);
});

test('team spawn and player spawn participate even when the ordinary pool is empty', () => {
  const arena = map({ spawns:[], playerSpawn:{ x:0,z:10 }, teamSpawns:{ red:[{ x:0,z:-10 }], blue:[] } });
  const args = { map:arena, navigation:createNavigation(arena), player:player({ z:0 }), zombies:[], fovRadians:1 };
  assert.deepEqual(selectZombieSpawn(args), { x:0,z:10 });
  assert.deepEqual(selectZombieSpawn({ ...args, zombies:[actor({ z:10 })] }), { x:0,z:-10 });
});

for (const arena of MAPS) test(`${arena.id}: spawns can approach authored and legal wall-contact player positions`, () => {
  const navigation = createNavigation(arena, { radius:.4 });
  const wallContacts = arena.solids.flatMap(s => [
    { x:s.x+s.w/2+.34, z:s.z }, { x:s.x-s.w/2-.34, z:s.z },
    { x:s.x, z:s.z+s.d/2+.34 }, { x:s.x, z:s.z-s.d/2-.34 },
  ]).filter(p => p.x >= arena.bounds.min+.34 && p.x <= arena.bounds.max-.34
    && p.z >= arena.bounds.min+.34 && p.z <= arena.bounds.max-.34 && canOccupy(p.x,p.z,.34,arena.solids));
  assert.ok(wallContacts.length);
  for (const target of [arena.playerSpawn, ...arena.spawns, ...wallContacts]) {
    const point = selectZombieSpawn({ map:arena,navigation,player:player(target),zombies:[],fovRadians:1.3 });
    assert.ok(point, `no spawn for ${JSON.stringify(target)}`);
    assert.ok(Math.hypot(point.x-target.x,point.z-target.z) >= 8);
    assert.ok(canOccupy(point.x,point.z,.4,arena.solids));
    assert.ok(navigation.nextApproachWaypoint(point,target,.34));
  }
});

test('walkers and runners have specified speed, delayed first slash and repeat intervals', () => {
  for (const [kind,speed,interval,damage] of [['walker',2.1,1.2,20],['runner',3.4,.9,15]]) {
    const brain = createZombieBrain(kind), moving = context({ actor:actor({ kind }) });
    assert.equal(brain.attackRemaining,interval);
    assert.equal(ZOMBIE_BALANCE[kind].damage,damage);
    assert.ok(Math.abs(stepZombieBrain(brain,moving).z + speed*.05) < 1e-9);
    const attacking = createZombieBrain(kind), near = context({ actor:actor({ kind }), player:player({ z:-1 }) });
    for (let i=0;i<Math.round(interval/.05)-1;i++) assert.equal(stepZombieBrain(attacking,near).attack,false);
    assert.equal(stepZombieBrain(attacking,near).attack,true);
    assert.equal(stepZombieBrain(attacking,near).attack,false);
  }
});

test('smoke preserves remembered goal while human moves; no memory means no pursuit', () => {
  const brain = createZombieBrain('walker'), ctx = context();
  stepZombieBrain(brain,ctx);
  const remembered = { ...brain.goal };
  const hidden = { ...ctx, player:player({ x:4,z:0 }), smokes:[{ x:2,y:1.6,z:0,radius:3,remaining:3 }] };
  const result = stepZombieBrain(brain,hidden);
  assert.deepEqual(brain.goal,remembered);
  assert.equal(result.yaw,0);
  assert.equal(result.attack,false);
  const fresh = stepZombieBrain(createZombieBrain('walker'),hidden);
  assert.deepEqual(fresh,{ x:0,z:0,yaw:0,attack:false });
});

test('flash freezes movement and attacks; invalid delta does not mutate brain', () => {
  const brain = createZombieBrain('walker'); brain.attackRemaining=0;
  const ctx = context({ actor:actor({ flashRemaining:1 }), player:player({ z:-1 }), zombies:[actor({ id:'other',x:.1 })] });
  assert.deepEqual(stepZombieBrain(brain,ctx),{ x:0,z:0,yaw:0,attack:false });
  for (const dt of [0,-1,NaN,Infinity]) {
    const before = JSON.stringify(brain);
    assert.equal(stepZombieBrain(brain,{ ...ctx,dt }).attack,false);
    assert.equal(JSON.stringify(brain),before);
  }
});

test('slashes respect three-dimensional range, cover, protection and death', () => {
  for (const extra of [{ player:player({ z:-1,y:2 }) },{ player:player({ z:-1,protectedRemaining:1 }) },
    { player:player({ z:-1,alive:false }) },{ player:player({ z:-2.5 }) },
    { player:player({ z:-1 }),solids:[{ x:0,z:-.5,w:4,d:.05,height:3 }] }]) {
    const brain = createZombieBrain('walker'); brain.attackRemaining=0;
    assert.equal(stepZombieBrain(brain,context(extra)).attack,false);
  }
  const brain = createZombieBrain('walker'); brain.attackRemaining=0;
  assert.equal(stepZombieBrain(brain,context({ player:player({ z:-1,y:.4 }) })).attack,true,'torso ray contact');
});

test('null navigation paths retry at .15 seconds, not every frame', () => {
  let calls=0;
  const ctx = context({ navigation:{ nextApproachWaypoint(){ calls++; return null; } } });
  const brain = createZombieBrain('walker');
  for (let i=0;i<3;i++) stepZombieBrain(brain,ctx);
  assert.equal(calls,1);
  stepZombieBrain(brain,ctx);
  assert.equal(calls,2);
});

test('separation cannot cross a thin wall and never mutates input actors', () => {
  const solids=[{ x:0,z:0,w:.01,d:10,height:3 }], arena=map({ solids });
  const a=actor({ x:-.41 }), other=actor({ id:'other',x:-.6 });
  const ctx=context({ actor:a,player:player({ x:-.41,z:0 }),zombies:[a,other],solids,navigation:createNavigation(arena,{ radius:.4 }) });
  const before=JSON.stringify([a,other,ctx.player]);
  for (let i=0;i<10;i++) {
    const next=stepZombieBrain(createZombieBrain('walker'),ctx);
    assert.ok(next.x < 0);
    assert.ok(canOccupy(next.x,next.z,.4,solids));
  }
  assert.equal(JSON.stringify([a,other,ctx.player]),before);
});

test('nearby player behind a thin wall still causes a detour rather than a contact-distance stall', () => {
  const solids=[{ x:0,z:0,w:.01,d:3,height:3 }], arena=map({ solids });
  const ctx=context({ actor:actor({ x:-.41 }),player:player({ x:.4,z:0 }),solids,navigation:createNavigation(arena,{ radius:.4 }) });
  const result=stepZombieBrain(createZombieBrain('walker'),ctx);
  assert.ok(Math.hypot(result.x-ctx.actor.x,result.z-ctx.actor.z)>0);
  assert.equal(result.attack,false);
  assert.ok(canOccupy(result.x,result.z,.4,solids));
});

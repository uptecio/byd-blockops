import test from 'node:test';
import assert from 'node:assert/strict';
import { roofAuditFixture } from './helpers/access-fixture.js';
import { auditRoofApproaches } from '../src/roof-access-validation.js';
import { MAPS } from '../src/maps.js';
import { createSpatialWorld } from '../src/spatial.js';
import { createBody, moveCharacter } from '../src/character-movement.js';

test('a declared single entrance fails when the neighboring roof is a physical second approach', () => {
  const result=auditRoofApproaches(roofAuditFixture({screen:false}));
  assert.equal(result.ok,false); assert.equal(result.byRoof[0].bypassPossible,true);
});

test('a tall visible screen with an out-of-range detour certifies the only approach', () => {
  const map=roofAuditFixture(),before=structuredClone(map);
  assert.deepEqual(auditRoofApproaches(map),{ok:true,errors:[],byRoof:[{id:'target-roof',bypassPossible:false}]});
  assert.deepEqual(map,before,'audit must not remove live geometry or mutate route records');
});

test('an opened guard gap creates a physical bypass without adding a route record', () => {
  assert.equal(auditRoofApproaches(roofAuditFixture({open:true})).ok,false);
});

test('higher-to-lower transfers and reachable screen tops remain potential approaches', () => {
  assert.equal(auditRoofApproaches(roofAuditFixture({high:true})).ok,false);
  assert.equal(auditRoofApproaches(roofAuditFixture({guardTop:true})).ok,false);
});

test('disabling the owned ladder does not disable another ladder or its airborne release positions', () => {
  const map=roofAuditFixture({screen:false}); map.solids=map.solids.filter(s=>s.id!=='source');
  map.solids.push({id:'far-deck',x:12,z:0,w:2,d:2,minY:0,maxY:5});
  map.traversal.roofs[1]={id:'far-roof',point:{x:12,y:5,z:0},supportId:'far-deck',singleEntrance:false};
  assert.equal(auditRoofApproaches(map).ok,true,'own ladder is disabled; far deck alone is out of reach');
  map.traversal.ladders.push({id:'other',routeId:'other-route',width:1.6,
    path:[{x:14,y:0,z:0},{x:14,y:5,z:0},{x:0,y:5,z:-4},{x:12,y:5,z:0}],
    bottom:{point:{x:14,y:0,z:0},supportId:'ground',zone:{minX:13.8,maxX:14.2,minZ:-.2,maxZ:.2}},
    top:{point:{x:12,y:5,z:0},supportId:'far-deck',zone:{minX:11.8,maxX:12.2,minZ:-.2,maxZ:.2}}});
  assert.equal(auditRoofApproaches(map).ok,false,'release anywhere along another route counts');
});

test('undeclared low stepping surfaces can create an extra ground approach', () => {
  const map=roofAuditFixture();
  for (let n=1;n<=8;n++) map.solids.push({id:`extra:${n}`,x:0,z:13-n*1.4,w:1.6,d:1.4,minY:0,maxY:n*.5});
  assert.equal(auditRoofApproaches(map).ok,false);
});

test('a fast diagonal transfer counts even when a slower straight-line driver cannot reach', () => {
  const map=roofAuditFixture({screen:false}),source=map.solids.find(s=>s.id==='source');
  source.x=-7; source.z=-7;
  assert.equal(auditRoofApproaches(map,{maxSpeed:4}).ok,true);
  assert.equal(auditRoofApproaches(map,{maxSpeed:6}).ok,false);
});

test('near-touching guard gaps are not rounded shut when a body can pass', () => {
  const map=roofAuditFixture({open:true}),gap=.8400001;
  for (const guard of map.solids.filter(s=>s.id.startsWith('guard'))) {
    guard.d=8-gap/2; guard.z=Math.sign(guard.z)*(8+gap/2)/2;
  }
  assert.equal(auditRoofApproaches(map).ok,false);
});

test('route omission never deletes a destination guard even if listed in both sets', () => {
  const map=roofAuditFixture(); map.traversal.roofs[0].routeSolidIds=['guard:0'];
  assert.equal(auditRoofApproaches(map).ok,true);
});

test('a narrow diagonal gap usable by the smaller solo body cannot be certified closed', () => {
  const map=roofAuditFixture({screen:false});
  map.solids.push({id:'north-screen',x:-2.1,z:4.125,w:.2,d:7.75,minY:0,maxY:5},
    {id:'south-screen',x:-2.8,z:-4.125,w:.2,d:7.75,minY:0,maxY:5});
  const world=createSpatialWorld(map),goal={x:-1.7,y:4,z:-.8};
  let body=createBody({x:-3.2,y:4,z:.8},world,{radius:.34});
  for (let n=0;n<180;n++) {
    const dx=goal.x-body.x,dz=goal.z-body.z,d=Math.hypot(dx,dz),speed=Math.min(2.86,d*120);
    const next=moveCharacter(body,{vx:d?dx/d*speed:0,vz:d?dz/d*speed:0,jump:n===0},1/120,{world,radius:.34});
    assert.equal(next.invalid,false); body=next.body;
  }
  assert.equal(body.supportId,'target','actual smaller-body physics proves the bypass');
  assert.equal(auditRoofApproaches(map).ok,false);
});

for (const map of MAPS) test(`${map.id}: retain existing protected annex approaches`, t => {
  const start=performance.now(),result=auditRoofApproaches(map);
  assert.equal(result.ok,true,JSON.stringify(result.errors));
  t.diagnostic(`audit ${(performance.now()-start).toFixed(1)}ms`);
});

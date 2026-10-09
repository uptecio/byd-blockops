import test from 'node:test';
import assert from 'node:assert/strict';
import { accessFixture } from './helpers/access-fixture.js';
import { advanceBody } from './helpers/traversal-fixture.js';
import { createBody, moveCharacter } from '../src/character-movement.js';
import { canOccupyBody, createSpatialWorld } from '../src/spatial.js';

for (const radius of [.34,.4,.42]) test(`supported stairs walk both directions without Jump at radius ${radius}`, () => {
  const f=accessFixture({kind:'stair'}),options={radius};
  const up=advanceBody(createBody(f.start,f.world,options),{vx:0,vz:-2.1},2.275/2.1,f.world,options);
  assert.equal(up.supportId,'landing'); assert.equal(up.y,.8); assert.equal(up.grounded,true);
  const down=advanceBody(up,{vx:0,vz:2.1},2.275/2.1,f.world,options);
  assert.equal(down.y,0); assert.equal(down.supportId,'ground');
});

test('ordinary ice or crate steps never gain stair assistance', () => {
  const f=accessFixture({kind:'jump'});
  const end=advanceBody(createBody(f.start,f.world),{vx:0,vz:-2.1},2,f.world);
  assert.equal(end.y,0); assert.equal(end.supportId,'ground');
});

test('sideways entry cannot lift a body onto the side of a stair run', () => {
  const f=accessFixture({kind:'stair'});
  const end=advanceBody(createBody({x:1.5,y:0,z:.4},f.world),{vx:-2.1,vz:0},1,f.world);
  assert.equal(end.y,0); assert.ok(end.x>=1.19);
});

test('airborne ascent gets no automatic extra stair lift', () => {
  const f=accessFixture({kind:'stair'});
  let body=createBody({x:0,y:.05,z:1.005},f.world); body.velocityY=.1;
  const moved=moveCharacter(body,{vx:0,vz:-2.1},1/120,{world:f.world,radius:.42});
  assert.equal(moved.invalid,false); assert.ok(moved.body.y<.06);
});

test('a stair ceiling stops at the last safe body without clipping', () => {
  const f=accessFixture({kind:'stair',blocked:true});
  const end=advanceBody(createBody(f.start,f.world),{vx:0,vz:-2.1},2,f.world);
  assert.equal(end.y,0); assert.equal(canOccupyBody(end,.4,1.84,f.world),true);
});

test('walking off the outside of a staircase falls normally', () => {
  const f=accessFixture({kind:'stair'});
  const end=advanceBody(createBody(f.goal,f.world),{vx:2,vz:0},1.5,f.world);
  assert.equal(end.y,0); assert.equal(end.supportId,'ground');
});

test('long frames cannot stair-step through a blocked side wall', () => {
  const f=accessFixture({kind:'stair'});
  f.world.solids.push({id:'side',x:.1,z:-.4,w:.1,d:3,minY:0,maxY:3});
  const body=createBody({x:-.5,y:0,z:1.2},f.world,{radius:.34});
  const moved=moveCharacter(body,{vx:6,vz:-6},10,{world:f.world,radius:.34});
  assert.equal(moved.invalid,false); assert.equal(canOccupyBody(moved.body,.34,1.84,f.world),true);
  assert.ok(moved.body.x<=-.29+1e-8);
});

test('a full turn landing connects the next run but a solid turn obstruction stops it', () => {
  const f=accessFixture({kind:'stair'}),stair=f.map.traversal.stairs[0];
  f.map.solids.push({id:'turned',x:1.4,z:-1.075,w:1.2,d:1.6,minY:0,maxY:1});
  stair.treads.push({supportId:'turned',point:{x:1.4,y:1,z:-1.075},clearWidth:1.6,run:1.2,landing:true});
  stair.links.push({fromSupportId:'landing',toSupportId:'turned',corridor:{minX:-.1,maxX:1.5,minZ:-1.875,maxZ:-.275}});
  const world=createSpatialWorld(f.map);
  const clear=advanceBody(createBody(f.goal,world),{vx:2.1,vz:0},1.4/2.1,world);
  assert.equal(clear.y,1); assert.equal(clear.supportId,'turned');
  f.map.solids.push({id:'turn-block',x:.6,z:-1.075,w:.05,d:1.6,minY:0,maxY:3});
  const blockedWorld=createSpatialWorld(f.map);
  const stopped=advanceBody(createBody(f.goal,blockedWorld),{vx:2.1,vz:0},1,blockedWorld);
  assert.equal(stopped.y,.8); assert.ok(stopped.x<.18);
  assert.equal(canOccupyBody(stopped,.4,1.84,blockedWorld),true);
});

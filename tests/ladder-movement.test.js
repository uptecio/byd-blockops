import test from 'node:test';
import assert from 'node:assert/strict';
import { accessFixture } from './helpers/access-fixture.js';
import { advanceBody } from './helpers/traversal-fixture.js';
import { createBody, moveCharacter } from '../src/character-movement.js';
import { canOccupyBody } from '../src/spatial.js';

const idle={vx:0,vz:0,climb:0,jump:false};
const up={...idle,climb:1},down={...idle,climb:-1};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} ≠ ${b}`);
function halfway() {
  const f=accessFixture();
  return {...f,body:advanceBody(createBody(f.start,f.world),up,.5,f.world)};
}

test('full input travels 1.2 units up a vertical ladder in half a second', () => {
  const f=halfway(); near(f.body.y,1.2);
  assert.equal(f.body.ladderId,f.ladderId); near(f.body.ladderDistance,1.2);
  assert.deepEqual([f.body.velocityY,f.body.grounded,f.body.supportId],[0,false,null]);
});

test('both ladder ends complete a collision-safe supported exit', () => {
  const f=accessFixture();
  let body=createBody(f.start,f.world);
  for (let n=0;n<180;n++) {
    const next=moveCharacter(body,up,1/120,{world:f.world});
    assert.equal(next.invalid,false);
    assert.ok(Math.hypot(next.body.x-body.x,next.body.y-body.y,next.body.z-body.z)<=.02000001);
    assert.equal(canOccupyBody(next.body,.4,1.84,f.world),true); body=next.body;
  }
  near(body.y,2.4); near(body.z,-2.7); assert.equal(body.supportId,'deck'); assert.equal(body.ladderId,null);
  body=advanceBody(body,down,1.5,f.world);
  near(body.y,0); near(body.z,-1.5); assert.equal(body.supportId,'ground'); assert.equal(body.ladderId,null);
});

test('neutral and deadzone input hold without gravity drift', () => {
  const f=halfway();
  for (const climb of [0,.09,-.1]) {
    const held=advanceBody(f.body,{...idle,climb},2,f.world);
    near(held.y,1.2); assert.equal(held.ladderId,f.ladderId); assert.equal(held.velocityY,0);
  }
});

test('aim turns diagonal and sideways motion do not redirect attached travel', () => {
  const f=halfway();
  for (const [vx,vz] of [[6,0],[-6,0],[0,6],[0,-6]]) {
    const body=advanceBody(f.body,{vx,vz,climb:.5,fire:true,zoom:true,yaw:3,pitch:1},.5,f.world);
    near(body.y,1.8); near(body.x,0); near(body.z,-1.5); assert.equal(body.ladderId,f.ladderId);
  }
});

test('Jump releases without a boost and held forward cannot immediately regrab', () => {
  const f=halfway();
  const released=moveCharacter(f.body,{...up,jump:true},1/120,{world:f.world}).body;
  assert.equal(released.ladderId,null); assert.ok(released.velocityY<0); assert.ok(released.y<1.2);
  const held=advanceBody(released,up,2,f.world);
  assert.equal(held.y,0); assert.equal(held.ladderId,null);
  const neutral=advanceBody(held,idle,.1,f.world);
  assert.equal(advanceBody(neutral,up,.1,f.world).ladderId,f.ladderId);
});

test('release applies ordinary horizontal movement and leaving the shaft clears regrab suppression', () => {
  const f=halfway();
  const released=advanceBody(f.body,{...up,vx:6,jump:true},.2,f.world);
  assert.ok(released.x>1); assert.equal(released.ladderId,null); assert.equal(released.ladderBlockedId,null);
});

test('entry needs grounded intentional up or down and the small clear landing zone', () => {
  const f=accessFixture();
  for (const [point,intent] of [[f.start,idle],[f.start,{...idle,vx:1}],
    [f.start,{...up,climb:.24}],[{...f.start,x:.7},up],[{...f.start,y:.05},up],[f.goal,up]]) {
    const result=moveCharacter(createBody(point,f.world),intent,1/120,{world:f.world});
    assert.equal(result.body.ladderId,null);
  }
  assert.equal(moveCharacter(createBody(f.goal,f.world),down,1/120,{world:f.world}).body.ladderId,f.ladderId);
});

test('off-center entry aligns through bounded movement instead of teleporting', () => {
  const f=accessFixture(),body=createBody({...f.start,x:.25},f.world);
  const first=moveCharacter(body,up,1/120,{world:f.world}).body;
  assert.ok(first.x>.22); assert.equal(first.y,0);
  const next=advanceBody(first,up,.2,f.world);
  near(next.x,0); assert.ok(next.y>0); assert.equal(next.ladderId,f.ladderId);
});

test('a blocked ladder exit holds safely and still permits reverse and release', () => {
  const f=halfway();
  f.world.solids.push({id:'blocked-exit',x:0,z:-2.2,w:.1,d:.1,minY:2.4,maxY:4.5});
  const stopped=advanceBody(f.body,up,2,f.world);
  assert.equal(stopped.ladderId,f.ladderId); assert.equal(canOccupyBody(stopped,.4,1.84,f.world),true);
  assert.ok(stopped.z> -1.76);
  const reverse=advanceBody(stopped,down,.5,f.world);
  assert.ok(reverse.ladderDistance<stopped.ladderDistance);
  assert.equal(moveCharacter(stopped,{...idle,jump:true},.01,{world:f.world}).body.ladderId,null);
});

test('long frames retain the quarter-second cap and invalid state is rejected atomically', () => {
  const f=halfway();
  near(moveCharacter(f.body,up,20,{world:f.world}).body.y,1.8);
  for (const patch of [{ladderId:'missing'},{ladderId:false},{ladderDistance:NaN},{ladderDistance:500},{x:.01}]) {
    const body={...f.body,...patch};
    assert.deepEqual(moveCharacter(body,up,.1,{world:f.world}),{body,invalid:true});
  }
  assert.deepEqual(moveCharacter(f.body,{...up,climb:NaN},.1,{world:f.world}),{body:f.body,invalid:true});
});

test('corrupted runtime path data reports failure without throwing or publishing a partial body', () => {
  const f=halfway(); f.world.ladders[0].path[1].y=NaN;
  assert.deepEqual(moveCharacter(f.body,up,.1,{world:f.world}),{body:f.body,invalid:true});
});

test('resetting climb fields keeps position but cannot retain a match-local attachment', async () => {
  const {clearClimb}=await import('../src/character-movement.js'),f=halfway();
  const reset=clearClimb({...f.body,ladderBlockedId:f.ladderId});
  assert.deepEqual([reset.ladderId,reset.ladderDistance,reset.ladderBlockedId],[null,0,null]);
  assert.equal(reset.y,f.body.y); assert.equal(f.body.ladderId,f.ladderId);
});

test('multiple bodies may share a ladder without occupancy reservations', () => {
  const f=halfway(),other=advanceBody(createBody(f.start,f.world),up,.5,f.world);
  assert.deepEqual(other,f.body); assert.equal(other.ladderId,f.ladderId);
});

test('dead or hidden bodies cannot begin attachment', () => {
  const f=accessFixture();
  for (const patch of [{health:0},{alive:false},{hiddenSpotId:'hidden'},{respawnRemaining:1}]) {
    const body={...createBody(f.start,f.world),...patch};
    assert.equal(moveCharacter(body,up,.1,{world:f.world}).body.ladderId,null);
  }
});

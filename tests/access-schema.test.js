import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpatialWorld } from '../src/spatial.js';
import { validateTraversal } from '../src/map-traversal.js';
import { accessFixture } from './helpers/access-fixture.js';

test('ladder distance sampling and projection include purely vertical segments and clamp endpoints', async () => {
  const { ladderLength, sampleLadder, projectLadder } = await import('../src/access-schema.js');
  const ladder = accessFixture().map.traversal.ladders[0];
  assert.equal(ladderLength(ladder), 3.6);
  assert.deepEqual(sampleLadder(ladder, 1.2), {x:0,y:1.2,z:-1.5});
  assert.deepEqual(sampleLadder(ladder, -1), {x:0,y:0,z:-1.5});
  assert.deepEqual(sampleLadder(ladder, 100), {x:0,y:2.4,z:-2.7});
  assert.deepEqual(projectLadder(ladder, {x:.2,y:1.2,z:-1.5}), {distance:1.2,error:.2});
  assert.throws(() => sampleLadder(ladder, NaN), /distance/i);
  assert.throws(() => projectLadder(ladder, {x:Infinity,y:0,z:0}), /point/i);
});

test('the spatial world retains isolated authored ladder paths without aliasing map metadata', () => {
  const f = accessFixture();
  assert.deepEqual(f.world.ladders, f.map.traversal.ladders);
  f.map.traversal.ladders[0].path[0].x = 5;
  assert.equal(f.world.ladders[0].path[0].x, 0);
});

test('legacy geometry creates empty access collections', () => {
  const world = createSpatialWorld({id:'legacy',bounds:{min:-5,max:5},solids:[]});
  assert.deepEqual(world.stairs, []); assert.deepEqual(world.ladders, []);
});

test('ladder endpoints and the full upright swept body must be clear', () => {
  assert.deepEqual(validateTraversal(accessFixture().map), {ok:true,errors:[]});
  const blocked = validateTraversal(accessFixture({blocked:true}).map);
  assert.equal(blocked.ok, false);
  assert.match(blocked.errors.join(' '), /ladder.*(blocked|clear)|blocked.*ladder/i);
  const f = accessFixture(); f.map.traversal.ladders[0].top.supportId = 'missing';
  assert.equal(validateTraversal(f.map).ok, false);
});

test('fine stair treads are accepted while turn landings must fit a full body', () => {
  const f = accessFixture({kind:'stair'});
  assert.deepEqual(validateTraversal(f.map), {ok:true,errors:[]});
  f.map.traversal.stairs[0].treads[1].landing = true;
  assert.throws(() => createSpatialWorld(f.map), /landing/i);
});

for (const [name, mutate] of [
  ['duplicate ID', m => m.traversal.ladders.push(structuredClone(m.traversal.ladders[0]))],
  ['nonfinite path', m => {m.traversal.ladders[0].path[1].y=NaN;}],
  ['zero length segment', m => {m.traversal.ladders[0].path[1]={...m.traversal.ladders[0].path[0]};}],
  ['oversized entry zone', m => {m.traversal.ladders[0].bottom.zone.maxX=2;}],
  ['narrow shaft', m => {m.traversal.ladders[0].width=1;}],
  ['unmatched path end', m => {m.traversal.ladders[0].path[2]={x:0,y:2.4,z:-3};}],
  ['invalid stairs list', m => {m.traversal.stairs={};}],
]) test(`reject malformed access metadata: ${name}`, () => {
  const {map}=accessFixture(); mutate(map);
  assert.throws(() => createSpatialWorld(map), /access|ladder|stair/i);
});

test('ladder clearance catches a thin grazing obstruction between sample points', () => {
  const f=accessFixture();
  f.map.solids.push({id:'graze',x:.42,z:-1.5125,w:.00002,d:.00002,minY:2.5,maxY:2.6});
  assert.equal(validateTraversal(f.map).ok, false);
});

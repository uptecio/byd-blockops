import test from 'node:test';
import assert from 'node:assert/strict';
import { createBody, moveCharacter, humanMoveSpeed } from '../src/character-movement.js';
import { stackedFixture, advanceBody } from './helpers/traversal-fixture.js';

const idle = { vx: 0, vz: 0, jump: false };

test('rooftop support persists without drifting to ground', () => {
  const { world, roof } = stackedFixture();
  const start = createBody(roof, world);
  const result = advanceBody(start, idle, 1, world);
  assert.equal(result.y, 3); assert.equal(result.grounded, true); assert.equal(result.supportId, 'roof');
  assert.deepEqual(start, { ...roof, velocityY: 0, grounded: true, supportId: 'roof', ladderId:null,ladderDistance:0,ladderBlockedId:null });
});

test('a .55 step needs a jump and can be landed on with ordinary jump physics', () => {
  const { world } = stackedFixture();
  const start = createBody({ x: -6.6, y: 0, z: 0 }, world);
  const walk = advanceBody(start, { ...idle, vx: 2 }, .8, world);
  assert.ok(walk.x <= -6.4 + 1e-8); assert.equal(walk.y, 0);
  const land = advanceBody(start, { ...idle, vx: 2, jump: true }, .8, world);
  assert.ok(land.x > -5.8 && land.x < -4.9);
  assert.equal(land.y, .55); assert.equal(land.supportId, 'step');
});

test('jump cannot retrigger in mid-air', () => {
  const { world, ground } = stackedFixture();
  const first = moveCharacter(createBody(ground, world), { ...idle, jump: true }, .1, { world }).body;
  const again = moveCharacter(first, { ...idle, jump: true }, .1, { world }).body;
  assert.ok(again.velocityY < first.velocityY); assert.equal(again.grounded, false);
});

test('head collision stops upward velocity without entering an overhead slab', () => {
  const { world, ceilingPoint } = stackedFixture();
  const head = moveCharacter(createBody(ceilingPoint, world), { ...idle, jump: true }, .08, { world }).body;
  assert.ok(head.y <= .16 + 1e-8); assert.ok(head.velocityY <= 0);
  assert.equal(advanceBody(head, idle, .5, world).y, 0);
});

test('falling lands on the first support and walking off roofs returns safely to ground', () => {
  const { world } = stackedFixture();
  const fall = advanceBody(createBody({ x: 0, y: 6, z: 0 }, world), idle, 1, world);
  assert.equal(fall.y, 3); assert.equal(fall.supportId, 'roof');
  const edge = advanceBody(fall, { ...idle, vx: 5 }, .8, world);
  assert.ok(edge.y < 3); assert.equal(edge.grounded, false);
  assert.equal(advanceBody(edge, idle, 2, world).y, 0);
});

test('long frames are capped and cannot tunnel through thin walls', () => {
  const { world } = stackedFixture();
  const start = createBody({ x: 5, y: 0, z: 0 }, world);
  const body = moveCharacter(start, { ...idle, vx: 300 }, 4, { world }).body;
  assert.ok(body.x < 6.591 && body.x > 6.4);
  const a = createBody({ x: -8, y: 0, z: -8 }, world);
  assert.ok(Math.abs(moveCharacter(a, { ...idle, vx: 4 }, 20, { world }).body.x + 7) < 1e-8);
});

test('bounds contain bodies above perimeter walls and corner movement slides', () => {
  const { world } = stackedFixture();
  const body = moveCharacter(createBody({ x: 9, y: 7, z: 0 }, world), { ...idle, vx: 30, vz: 5 }, .25, { world }).body;
  assert.ok(body.x <= 9.6); assert.ok(body.z > 1.2);
});

test('a substepped jump edge is consumed once even when the low ceiling causes a quick landing', () => {
  const { world } = stackedFixture();
  const body = moveCharacter(createBody({ x: 0, y: 0, z: 6 }, world, { height: 1.96 }), { ...idle, jump: true }, .25, { world, height: 1.96 }).body;
  assert.equal(body.velocityY, 0); assert.equal(body.y, 0); assert.equal(body.grounded, true);
});

test('invalid inputs retain the original body without contaminating it', () => {
  const { world, ground } = stackedFixture();
  const body = createBody(ground, world);
  for (const dt of [NaN, Infinity, -1]) {
    assert.deepEqual(moveCharacter(body, idle, dt, { world }), { body, invalid: true });
  }
  for (const intent of [{ ...idle, vx: Infinity }, { ...idle, vz: NaN }]) {
    assert.deepEqual(moveCharacter(body, intent, .1, { world }), { body, invalid: true });
  }
  assert.deepEqual(moveCharacter(body, idle, 0, { world }), { body, invalid: false });
  assert.throws(() => createBody({ x: 0, y: 2.9, z: 0 }, world));
});

test('weapon class movement and zoom retain established speeds', () => {
  assert.equal(humanMoveSpeed('lmg', true), 4.4 * .65);
  assert.equal(humanMoveSpeed('smg', false), 6);
  assert.equal(humanMoveSpeed('sidearm', false), 6);
  assert.equal(humanMoveSpeed('rifle', false), 5.3);
});

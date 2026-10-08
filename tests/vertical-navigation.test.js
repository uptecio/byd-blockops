import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS } from '../src/maps.js';
import { createNavigation, navigationIntent } from '../src/navigation.js';
import { createBody, moveCharacter } from '../src/character-movement.js';
import { createSpatialWorld } from '../src/spatial.js';
import { createHeadlessGame, cleanupGame, positionBot } from './helpers/game-fixture.js';
import { createZombieBrain, stepZombieBrain } from '../src/zombie-brain.js';

function follow(nav, world, start, goal, speed) {
  let body = createBody(start, world), jumped = false;
  for (let n = 0; n < 2400; n++) {
    if (Math.hypot(body.x - goal.x, body.z - goal.z) < .04 && Math.abs(body.y - goal.y) < .01 && body.grounded) return { body, jumped };
    const waypoint = nav.nextWaypoint(body, goal);
    const intent = navigationIntent(body, waypoint, Math.min(speed, waypoint ? Math.hypot(waypoint.x - body.x, waypoint.z - body.z) * 60 : speed), world);
    jumped ||= intent.jump;
    const next = moveCharacter(body, intent, 1 / 60, { world });
    assert.equal(next.invalid, false); assert.ok(Math.hypot(next.body.x - body.x, next.body.z - body.z) <= speed / 60 + 1e-7);
    body = next.body;
  }
  assert.fail(`route failed at ${JSON.stringify(body)} to ${JSON.stringify(goal)}`);
}

for (const map of MAPS) test(`${map.id}: route reaches the selected support at bot walker runner and zoomed-LMG speeds`, () => {
  const world = createSpatialWorld(map), nav = createNavigation(map, { radius: .4 });
  for (const roof of map.traversal.roofs) {
    const start = map.traversal.links.find(link => link.routeId === map.traversal.links.find(l => l.id === roof.entryLinkId).routeId).from;
    for (const speed of [1.6, 2.1, 3.4, 4.4 * .65]) {
      assert.equal(nav.reachable(start, roof.point), true);
      const result = follow(nav, world, start, roof.point, speed);
      assert.equal(result.body.y, 2.2); assert.equal(result.body.grounded, true); assert.equal(result.jumped, true);
      assert.equal(follow(nav, world, roof.point, start, speed).body.y, 0);
    }
    const room = map.traversal.shelters.find(s => s.id === roof.id.replace(':position', ''));
    assert.equal(nav.reachable(room.point, roof.point), true);
    const a = nav.nextWaypoint(start, room.point), b = nav.nextWaypoint(start, roof.point);
    assert.ok(a && b);
    assert.equal(follow(nav, world, start, room.point, 2.1).body.y, 0);
  }
});

test('a failed jump replans from the actual lower support without teleporting', () => {
  const map = MAPS[0], world = createSpatialWorld(map), nav = createNavigation(map, { radius: .4 });
  const link = map.traversal.links[0];
  const body = createBody(link.from, world);
  const blockedIntent = navigationIntent(body, nav.nextWaypoint(body, map.traversal.roofs[0].point), 2.1, world);
  const missed = moveCharacter(body, { ...blockedIntent, jump: false }, .25, { world }).body;
  assert.equal(missed.y, 0);
  assert.equal(follow(nav, world, missed, map.traversal.roofs[0].point, 2.1).body.y, 2.2);
});

test('authored transition graphs reject invalid actor endpoints without throwing', () => {
  const map = MAPS[0], navigation = createNavigation(map);
  for (const value of [null, undefined, {}, { x: NaN, y: 0, z: 0 }]) {
    assert.equal(navigation.nextWaypoint(value, map.traversal.roofs[0].point), null);
    assert.equal(navigation.nextWaypoint(map.playerSpawn, value), null);
  }
});

test('the ordinary bot runtime climbs the same authored route with a physical body', t => {
  const game = createHeadlessGame(); game.start('m4a1', { bots: 1 }); t.after(() => cleanupGame(game));
  const roof = game.world.definition.traversal.roofs[0], start = game.world.definition.traversal.links[0].from;
  const bot = game.bots[0]; positionBot(bot, start.x, 0, start.z);
  bot.intent = { goal: roof.point, targetId: null }; bot.intentTimer = 100; bot.cooldown = 100;
  for (let i = 0; i < 1200 && bot.body.y !== roof.point.y; i++) game.updateBots(1 / 60);
  assert.equal(bot.body.y, roof.point.y); assert.equal(bot.body.grounded, true);
});

test('zombie separation ignores actors on a non-overlapping floor', () => {
  const map = MAPS[0], world = createSpatialWorld(map), navigation = createNavigation(map, { radius: .4 });
  const p = map.traversal.roofs[0].point;
  const actor = { id: 'z', kind: 'walker', ...createBody(p, world), yaw: 0, pitch: 0, alive: true, flashRemaining: 0 };
  const player = { id: 'local', x: p.x, y: 0, z: p.z, yaw: 0, pitch: 0, alive: true, protectedRemaining: 0, hiddenSpotId: 'test-hidden' };
  const nav = { ...navigation, patrolPoint: () => null };
  const ctx = { actor, player, navigation: nav, solids: world.solids, world, smokes: [], dt: .05 };
  const a = stepZombieBrain(createZombieBrain('walker'), { ...ctx, zombies: [] });
  const b = stepZombieBrain(createZombieBrain('walker'), { ...ctx, zombies: [{ ...actor, id: 'below', y: 0 }] });
  assert.deepEqual(a.body, b.body); assert.equal(b.attack, false);
});

for (const map of MAPS) test(`${map.id}: real walker and runner brains climb after a rooftop sighting`, () => {
  const world = createSpatialWorld(map), navigation = createNavigation(map, { radius: .4 });
  const roof = map.traversal.roofs[0], start = map.traversal.links[0].from;
  const center = map.traversal.shelters[0].point;
  for (const kind of ['walker', 'runner']) {
    const player = { id: 'local', ...center, y: roof.point.y, alive: true, yaw: 0, pitch: 0, protectedRemaining: 0 };
    let actor = { id: `z-${kind}`, kind, ...createBody(start, world), alive: true, yaw: 0, pitch: 0, flashRemaining: 0 };
    const brain = createZombieBrain(kind); brain.goal = { ...player }; brain.targetId = player.id;
    for (let n = 0; n < 1800 && !(actor.y === roof.point.y && actor.grounded); n++) {
      const next = stepZombieBrain(brain, { actor, player, zombies: [], navigation, world, solids: world.solids, smokes: [], dt: 1 / 60 });
      actor = { ...actor, ...next.body, yaw: next.yaw };
    }
    assert.equal(actor.y, 2.2, kind); assert.equal(actor.grounded, true);
  }
});

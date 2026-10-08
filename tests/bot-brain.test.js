import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS } from '../src/maps.js';
import { canOccupy } from '../src/collision.js';
import { createModeState, recordElimination, tickMode } from '../src/modes.js';
import { createNavigation } from '../src/navigation.js';
import { chooseBotIntent } from '../src/bot-brain.js';
import * as brain from '../src/bot-brain.js';
import { createEquipment, pickupEquipment } from '../src/equipment.js';

const arena = (solids = [], bounds = { min: -12, max: 12 }) => ({
  id: 'fixture', bounds, solids, bases: { red: { x: -8, y: 0, z: 0 }, blue: { x: 8, y: 0, z: 0 } },
});
const actor = (id, teamId, x, z = 0, extra = {}) => ({
  id, teamId, x, y: 0, z, alive: true, protectedRemaining: 0, lifeId: 0, ...extra,
});
const point = ({ x, z }) => ({ x, z });
const setup = (modeId = 'ctf', map = arena(), roster = [
  actor('bot-0', 'red', -8), actor('bot-1', 'blue', 8), actor('bot-2', 'red', -9, 2),
]) => {
  const actors = roster.map(a => ({ ...a, teamId: modeId === 'ffa' ? null : a.teamId }));
  const state = createModeState({ modeId, map, participants: actors });
  return { actors, state, map, role: 'attack' };
};
const decide = (context, role = context.role) => chooseBotIntent(context.actors[0], { ...context, role });

// Breaks if a route is disconnected, loops, enters cover, or cuts through a wall.
function follow(nav, from, goal, map, radius = .42) {
  let current = point(from);
  for (let step = 0; step < 600; step++) {
    if (Math.hypot(current.x - goal.x, current.z - goal.z) < 1e-8) return;
    const next = nav.nextWaypoint(current, goal);
    assert.ok(next, `no waypoint from ${JSON.stringify(current)} to ${JSON.stringify(goal)} on ${map.id}`);
    assert.ok(Number.isFinite(next.x) && Number.isFinite(next.z));
    const distance = Math.hypot(next.x - current.x, next.z - current.z);
    assert.ok(distance > 1e-8, 'a waypoint must make progress');
    for (let sample = 0; sample <= Math.ceil(distance / .02); sample++) {
      const t = sample / Math.max(1, Math.ceil(distance / .02));
      const x = current.x + (next.x - current.x) * t;
      const z = current.z + (next.z - current.z) * t;
      assert.ok(x >= map.bounds.min + radius - 1e-8 && x <= map.bounds.max - radius + 1e-8);
      assert.ok(z >= map.bounds.min + radius - 1e-8 && z <= map.bounds.max - radius + 1e-8);
      assert.equal(canOccupy(x, z, radius, map.solids), true, `wall collision at ${x},${z}`);
    }
    current = next;
  }
  assert.fail('route did not arrive within 600 steps');
}

test('all spawns can navigate to both flag bases on all eight maps', () => {
  for (const map of MAPS) {
    const nav = createNavigation(map);
    for (const spawn of [map.playerSpawn, ...map.spawns, ...map.teamSpawns.red, ...map.teamSpawns.blue]) {
      for (const base of Object.values(map.bases)) {
        assert.equal(nav.reachable(spawn, base), true, `${map.id}: ${JSON.stringify(spawn)}`);
        follow(nav, spawn, base, map);
      }
    }
  }
});

test('routes avoid walls and corners with fractional endpoints and actor radius', () => {
  const map = arena([{ x: 0, z: 0, w: .08, d: 5, height: 3 }], { min: -5, max: 5 });
  const from = { x: -2.17, y: 0, z: -.17 }, goal = { x: 2.12, y: 0, z: .14 };
  const nav = createNavigation(map, { radius: .7 });
  assert.equal(nav.reachable(from, goal), true);
  follow(nav, from, goal, map, .7);
});

test('a circle-clear endpoint beside a convex corner can still leave toward open ground', () => {
  const map = arena([{ x: 0, z: 0, w: 2, d: 2, height: 3 }]);
  const from = { x: 1.3, y: 0, z: 1.3 }, goal = { x: 3, y: 0, z: 3 };
  assert.equal(canOccupy(from.x, from.z, .42, map.solids), true);
  const nav = createNavigation(map);
  assert.equal(nav.reachable(from, goal), true);
  follow(nav, from, goal, map);
});

test('a thin wall between adjacent grid cells cannot be crossed', () => {
  const map = arena([{ x: -.25, z: 0, w: .01, d: 8, height: 3 }], { min: -4, max: 4 });
  const nav = createNavigation(map, { radius: .1 });
  assert.equal(nav.reachable({ x: -.5, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), false);
  assert.equal(nav.nextWaypoint({ x: -.5, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), null);
});

test('smaller-actor approach stays on the target side of thin walls and rejects invalid footprints', () => {
  const map = arena([{ x: 0, z: 0, w: .01, d: 8, height: 3 }], { min: -4, max: 4 });
  const nav = createNavigation(map, { radius: .4 });
  const goal = { x: .35, y: 0, z: 0 };
  assert.equal(canOccupy(goal.x, goal.z, .34, map.solids), true);
  assert.equal(nav.nextWaypoint({ x: 2, y: 0, z: 0 }, goal), null, 'strict API still rejects bot-blocked target');
  assert.equal(nav.reachable({ x: 2, y: 0, z: 0 }, goal), false);
  assert.ok(nav.nextApproachWaypoint({ x: 2, y: 0, z: 0 }, goal, .34));
  assert.equal(nav.nextApproachWaypoint({ x: -2, y: 0, z: 0 }, goal, .34), null, 'cannot project target through a thin dividing wall');
  for (const invalid of [{ x: .2, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: NaN, z: 0 }]) {
    assert.equal(nav.nextApproachWaypoint({ x: 2, y: 0, z: 0 }, invalid, .34), null);
  }
  for (const radius of [0, -.1, NaN, .5]) assert.equal(nav.nextApproachWaypoint({ x: 2, y: 0, z: 0 }, goal, radius), null);
});

test('diagonally touching chambers cannot cut through their shared corner', () => {
  const map = arena([
    { x: -1, z: 1, w: 2, d: 2, height: 3 },
    { x: 1, z: -1, w: 2, d: 2, height: 3 },
  ], { min: -2, max: 2 });
  const nav = createNavigation(map);
  assert.equal(nav.reachable({ x: -1, y: 0, z: -1 }, { x: 1, y: 0, z: 1 }), false);
  assert.equal(nav.nextWaypoint({ x: -1, y: 0, z: -1 }, { x: 1, y: 0, z: 1 }), null);
});

test('grid coordinates derive from shifted map bounds', () => {
  const map = arena([], { min: 30, max: 36 });
  const nav = createNavigation(map);
  follow(nav, { x: 31.12, y: 0, z: 31.17 }, { x: 34.87, y: 0, z: 34.92 }, map);
});

test('a moving actor between grid centers keeps advancing toward the goal', () => {
  const nav = createNavigation(arena());
  const from = { x: -7.9, y: 0, z: 0 }, goal = { x: 8, y: 0, z: 0 };
  assert.ok(nav.nextWaypoint(from, goal).x > from.x);
});

test('repeated fractional movement follows routes through every real map', () => {
  for (const map of MAPS) {
    const nav = createNavigation(map);
    let current = point(map.teamSpawns.red[0]);
    const goal = map.bases.blue;
    for (let step = 0; step < 1500 && Math.hypot(current.x - goal.x, current.z - goal.z) > .01; step++) {
      const next = nav.nextWaypoint(current, goal);
      assert.ok(next, map.id);
      const dx = next.x - current.x, dz = next.z - current.z;
      const length = Math.hypot(dx, dz);
      assert.ok(length > 1e-8, `stalled on ${map.id}`);
      const scale = Math.min(.11, length) / length;
      current = { x: current.x + dx * scale, z: current.z + dz * scale };
      assert.equal(canOccupy(current.x, current.z, .42, map.solids), true);
    }
    assert.ok(Math.hypot(current.x - goal.x, current.z - goal.z) <= .01, `did not arrive on ${map.id}`);
  }
});

test('jump height never allows navigation through a wall', () => {
  const nav = createNavigation(arena([{ x: 0, z: 0, w: 1, d: 24, height: .5 }]));
  const from = { x: -8, y: 3, z: 0 }, goal = { x: 8, y: 3, z: 0 };
  assert.equal(nav.reachable(from, goal), false);
  assert.equal(nav.nextWaypoint(from, goal), null);
  assert.equal(nav.nextWaypoint({ x: .3, y: 3, z: 0 }, goal), null);
});

test('invalid, blocked and out-of-bounds endpoints have no route', () => {
  const nav = createNavigation(arena([{ x: 0, z: 0, w: 2, d: 2, height: 3 }]));
  const from = { x: -8, y: 0, z: 0 };
  for (const goal of [null, {}, { x: NaN, z: 2 }, { x: Infinity, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 12, y: 0, z: 0 }]) {
    assert.equal(nav.reachable(from, goal), false);
    assert.equal(nav.nextWaypoint(from, goal), null);
    assert.equal(nav.nextWaypoint(goal, from), null);
  }
});

test('separate map caches cannot leak reachability through matching goal cells', () => {
  const open = arena(), closed = arena([{ x: 0, z: 0, w: 1, d: 24, height: 3 }]);
  const a = createNavigation(open), b = createNavigation(closed);
  const from = { x: -8, y: 0, z: 0 }, goal = { x: 8, y: 0, z: 0 };
  assert.equal(a.reachable(from, goal), true);
  assert.equal(b.reachable(from, goal), false);
  a.clearCache(); b.clearCache();
  assert.equal(b.reachable(from, goal), false);
  follow(a, from, goal, open);
});

test('changing among more than 32 goals and clearing fields preserves current routes', () => {
  const map = arena(), nav = createNavigation(map), from = { x: -8, y: 0, z: 0 };
  for (let x = -10; x <= 10; x += .5) follow(nav, from, { x, z: 7 }, map);
  nav.clearCache();
  follow(nav, from, { x: 8, y: 0, z: -7 }, map);
});

test('FFA pursues the nearest other living actor and breaks equal distances by stable ID', () => {
  const context = setup('ffa', arena(), [actor('bot-0', null, 0), actor('z', null, 2), actor('a', null, -2), actor('dead', null, .1, 0, { alive: false })]);
  assert.deepEqual(decide(context), { goal: { x: -2, y: 0, z: 0 }, targetId: 'a' });
  context.actors.reverse();
  assert.deepEqual(chooseBotIntent(context.actors.at(-1), context), { goal: { x: -2, y: 0, z: 0 }, targetId: 'a' });
});

test('TDM excludes teammates and unregistered actors from movement and shooting', () => {
  const context = setup('tdm');
  context.actors.push(actor('outsider', 'blue', -7));
  assert.deepEqual(decide(context), { goal: { x: 8, y: 0, z: 0 }, targetId: 'bot-1' });
});

test('a previously seen occluded enemy provides a pursuit goal but no shooting target', () => {
  const context = setup('tdm', arena([{ x: 0, z: 0, w: 1, d: 6, height: 3 }]));
  context.lastKnownTargets = new Map([['bot-1', { ...context.actors[1] }]]);
  assert.deepEqual(decide(context), { goal: { x: 8, y: 0, z: 0 }, targetId: null });
});

test('shooting chooses the nearest visible enemy independently of the pursuit goal', () => {
  const context = setup('tdm', arena([{ x: 0, z: 0, w: 1, d: 3, height: 3 }]), [
    actor('bot-0', 'red', -2), actor('hidden', 'blue', 2), actor('visible', 'blue', -2, 5),
  ]);
  context.lastKnownTargets = new Map([['hidden', { ...context.actors[1] }]]);
  assert.deepEqual(decide(context), { goal: { x: 2, y: 0, z: 0 }, targetId: 'visible' });
});

test('cover height is measured at actor shooting height including jumps', () => {
  const context = setup('tdm', arena([{ x: 0, z: 0, w: 1, d: 6, height: .5 }]));
  assert.equal(decide(context).targetId, 'bot-1');
  context.map = arena([{ x: 0, z: 0, w: 1, d: 6, height: 2 }]);
  assert.equal(decide(context).targetId, null);
  context.actors[0].y = 2; context.actors[1].y = 2;
  assert.equal(decide(context).targetId, 'bot-1');
});

test('protected enemies can be pursued but are not selected for damage', () => {
  const context = setup('tdm'); context.actors[1].protectedRemaining = 2;
  assert.deepEqual(decide(context), { goal: { x: 8, y: 0, z: 0 }, targetId: null });
});

test('CTF attackers of either team seek the enemy base without a visible target', () => {
  const context = setup('ctf', arena([{ x: 0, z: 0, w: 1, d: 6, height: 3 }]));
  assert.deepEqual(decide(context), { goal: { x: 8, y: 0, z: 0 }, targetId: null });
  assert.deepEqual(chooseBotIntent(context.actors[1], context), { goal: { x: -8, y: 0, z: 0 }, targetId: null });
});

test('attackers immediately redirect to the enemy flag after a real pickup and drop', () => {
  const context = setup(); const nav = createNavigation(context.map);
  assert.deepEqual(decide(context).goal, { x: 8, y: 0, z: 0 });
  nav.nextWaypoint(context.actors[0], decide(context).goal);
  tickMode(context.state, .1, [{ ...context.actors[2], x: 8, z: 0 }]);
  recordElimination(context.state, { killerId: 'bot-1', victimId: 'bot-2', position: { x: 4, y: 0, z: 3 }, lifeId: 0 });
  assert.deepEqual(decide(context).goal, { x: 4, y: 0, z: 3 });
  follow(nav, context.actors[0], decide(context).goal, context.map);
});

test('defenders recover their own dropped flag while still targeting a visible enemy', () => {
  const context = setup();
  tickMode(context.state, .1, [{ ...context.actors[1], x: -8 }]);
  recordElimination(context.state, { killerId: 'bot-2', victimId: 'bot-1', position: { x: -3, y: 0, z: 2 }, lifeId: 0 });
  assert.deepEqual(decide(context, 'defend'), { goal: { x: -3, y: 0, z: 2 }, targetId: 'bot-1' });
});

test('defenders intercept their nearby flag carrier using its current actor position', () => {
  const context = setup();
  tickMode(context.state, .1, [{ ...context.actors[1], x: -8 }]);
  context.actors[1].x = -4; context.actors[1].z = 2;
  assert.deepEqual(decide(context, 'defend'), { goal: { x: -4, y: 0, z: 2 }, targetId: 'bot-1' });
});

test('defenders guard home and intercept enemies approaching the home base', () => {
  const context = setup();
  assert.deepEqual(decide(context, 'defend').goal, { x: -8, y: 0, z: 0 });
  context.actors[1].x = -5;
  assert.deepEqual(decide(context, 'defend').goal, { x: -5, y: 0, z: 0 });
});

test('carriers return home while continuing to fight rather than chasing a target', () => {
  const context = setup();
  tickMode(context.state, .1, [{ ...context.actors[0], x: 8 }]);
  context.actors[0].x = 3;
  assert.deepEqual(decide(context), { goal: { x: -8, y: 0, z: 0 }, targetId: 'bot-1' });
});

test('carriers seek their own missing flag before returning home', () => {
  const context = setup();
  tickMode(context.state, .1, [{ ...context.actors[0], x: 8 }, { ...context.actors[1], x: -8 }]);
  context.actors[1].x = -3; context.actors[1].z = 4;
  assert.deepEqual(decide(context).goal, { x: -3, y: 0, z: 4 });
  recordElimination(context.state, { killerId: 'bot-2', victimId: 'bot-1', position: { x: -1, y: 0, z: 3 }, lifeId: 0 });
  assert.deepEqual(decide(context).goal, { x: -1, y: 0, z: 3 });
});

test('an attacker supports the teammate carrying the enemy flag', () => {
  const context = setup();
  tickMode(context.state, .1, [{ ...context.actors[2], x: 8, z: 0 }]);
  context.actors[2].x = 3; context.actors[2].z = 2;
  assert.deepEqual(decide(context).goal, { x: 3, y: 0, z: 2 });
});

test('a single bot on a team attacks even if asked to defend alongside a human', () => {
  const context = setup('ctf', arena(), [actor('bot-0', 'red', -8), actor('bot-1', 'blue', 8), actor('local', 'red', -9, 2)]);
  assert.deepEqual(decide(context, 'defend').goal, { x: 8, y: 0, z: 0 });
});

test('dead actors, ended rounds and a lone FFA actor have no intent', () => {
  const context = setup('ffa', arena(), [actor('bot-0', null, -8)]);
  assert.deepEqual(decide(context), { goal: null, targetId: null });
  const team = setup(); team.actors[0].alive = false;
  assert.deepEqual(decide(team), { goal: null, targetId: null });
  team.actors[0].alive = true; team.state.ended = true;
  assert.deepEqual(decide(team), { goal: null, targetId: null });
});

test('decisions are pure and returned goals do not alias actor, map or flag objects', () => {
  const context = setup();
  const before = structuredClone(context);
  const intent = decide(context); intent.goal.x = 999;
  assert.deepEqual(context, before);
  assert.deepEqual(decide(context).goal, { x: 8, y: 0, z: 0 });
});

for (const impairment of ['smoke', 'flash']) test(`${impairment} concealment denies targets and pursuit of current enemy coordinates`, () => {
  const context = setup('ffa', arena(), [actor('bot-0', null, -8), actor('bot-1', null, 8)]);
  const bot = context.actors[0], enemy = context.actors[1];
  context.smokes = impairment === 'smoke' ? [{ x: 0, y: 1.35, z: 0, radius: 4, remaining: 8 }] : [];
  bot.flashRemaining = impairment === 'flash' ? 1 : 0;
  context.lastKnownTargets = new Map([[enemy.id, { x: 5, z: 2, lifeId: enemy.lifeId }]]);
  assert.deepEqual(decide(context), { goal: { x: 5, y: 0, z: 2 }, targetId: null });
  enemy.x = 10; enemy.z = 3;
  assert.deepEqual(decide(context), { goal: { x: 5, y: 0, z: 2 }, targetId: null });
  context.lastKnownTargets.clear(); assert.deepEqual(decide(context), { goal: null, targetId: null });
});

test('blinded CTF bots keep objective routes without tracking concealed carriers or intruders', () => {
  const context = setup(); context.actors[0].flashRemaining = 2;
  assert.deepEqual(decide(context), { goal: { x: 8, y: 0, z: 0 }, targetId: null });
  tickMode(context.state, .01, [{ ...context.actors[1], x: -8 }]);
  context.actors[1].x = -3; context.actors[1].z = 4;
  assert.deepEqual(decide(context, 'defend'), { goal: { x: -8, y: 0, z: 0 }, targetId: null });
  context.lastKnownTargets = new Map([['bot-1', { x: -5, z: 1, lifeId: 0 }]]);
  assert.deepEqual(decide(context, 'defend'), { goal: { x: -5, y: 0, z: 1 }, targetId: null });
});

test('equipment decisions use owned guns and knife range without creating inventory', () => {
  const bot = actor('bot-0', null, 0, 0, { equipment: createEquipment('m4a1') });
  const enemy = actor('local', null, 0, -40);
  const context = { actors: [bot, enemy], intent: { targetId: enemy.id }, smokes: [], solids: [], now: 0 };
  assert.equal(brain.chooseBotEquipment(bot, context), null);
  pickupEquipment(bot.equipment, { kind: 'gun', weaponId: 'awp', ammo: 5, reserve: 495 });
  assert.deepEqual(brain.chooseBotEquipment(bot, context), { kind: 'equip-gun', weaponId: 'awp', source: 'inventory' });
  pickupEquipment(bot.equipment, { kind: 'knife' }); enemy.z = -1;
  assert.deepEqual(brain.chooseBotEquipment(bot, context), { kind: 'held-item', heldItem: 'knife' });
  assert.equal(bot.equipment.activeGunId, 'm4a1');
  bot.equipment.supplies.health = 1; bot.equipment.supplyUse = { type: 'health', remaining: 3 };
  assert.equal(brain.chooseBotEquipment(bot, context), null, 'automatic knife selection must not cancel an active supply');
});

test('grenade decisions require ownership, visibility and six seconds between attempts', () => {
  const bot = actor('bot-0', null, 0, 0, { equipment: createEquipment('m4a1'), health: 100, lastGrenadeAttempt: 10 });
  const enemy = actor('local', null, 0, -8);
  const context = { actors: [bot, enemy], intent: { targetId: enemy.id }, smokes: [], solids: [], now: 16 };
  assert.equal(brain.chooseBotEquipment(bot, context), null);
  bot.equipment.grenades.frag = 1;
  assert.deepEqual(brain.chooseBotEquipment(bot, context), { kind: 'throw', grenadeType: 'frag' });
  context.now = 15.99; assert.equal(brain.chooseBotEquipment(bot, context), null);
  context.now = 16; context.smokes = [{ x: 0, y: 1.35, z: -4, radius: 2, remaining: 8 }];
  assert.equal(brain.chooseBotEquipment(bot, context), null);
  context.smokes = []; bot.flashRemaining = 1; assert.equal(brain.chooseBotEquipment(bot, context), null);
  bot.flashRemaining = 0; bot.equipment.grenades = { frag: 0, flash: 0, smoke: 1 }; bot.carryingFlag = true;
  assert.deepEqual(brain.chooseBotEquipment(bot, context), { kind: 'throw', grenadeType: 'smoke' });
});

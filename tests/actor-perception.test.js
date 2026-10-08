import test from 'node:test';
import assert from 'node:assert/strict';
import { canPerceive, forgetTarget } from '../src/actor-perception.js';
import { createSpatialWorld } from '../src/spatial.js';
import { createNavigation } from '../src/navigation.js';
import { createZombieBrain, stepZombieBrain, selectZombieSpawn } from '../src/zombie-brain.js';
import { chooseBotIntent, chooseBotEquipment } from '../src/bot-brain.js';
import { createModeState } from '../src/modes.js';
import { createEquipment } from '../src/equipment.js';
import { MAPS } from '../src/maps.js';

const map = { id: 'perception', bounds: { min: -10, max: 10 }, solids: [], bases: { red: { x: -8, y: 0, z: 0 }, blue: { x: 8, y: 0, z: 0 } }, traversal: { patrolPoints: [{ x: -5, y: 0, z: -5 }] } };
const actor = (id, x, extra = {}) => ({ id, x, y: 0, z: 0, yaw: -Math.PI / 2, pitch: 0, alive: true, teamId: null, lifeId: 1, protectedRemaining: 0, flashRemaining: 0, ...extra });

test('hidden smoke flash and solid walls all prevent perception', () => {
  const a = actor('bot', 0), b = actor('local', 2), world = createSpatialWorld(map);
  assert.equal(canPerceive(a, b, { world, smokes: [] }), true);
  assert.equal(canPerceive(a, { ...b, hiddenSpotId: 'locker' }, { world, smokes: [] }), false);
  assert.equal(canPerceive({ ...a, flashRemaining: 1 }, b, { world, smokes: [] }), false);
  assert.equal(canPerceive(a, b, { world, smokes: [{ x: 1, y: 1.35, z: 0, radius: 1 }] }), false);
  const wall = createSpatialWorld({ ...map, solids: [{ x: 1, z: 0, w: .1, d: 5, height: 3 }] });
  assert.equal(canPerceive(a, b, { world: wall, smokes: [] }), false);
});

test('witnessed hiding erases target-specific pursuit without discarding a different objective', () => {
  const brain = { lastKnownTargets: new Map([['local', { x: 2, y: 0, z: 0 }]]), intent: { targetId: 'local', goal: { x: 2, y: 0, z: 0 } }, waypoint: { x: 1, y: 0, z: 0 }, pathTimer: 1 };
  forgetTarget(brain, 'local');
  assert.equal(brain.lastKnownTargets.has('local'), false); assert.equal(brain.intent.targetId, null); assert.equal(brain.intent.goal, null); assert.equal(brain.waypoint, null);
  const ownGoal = { x: -8, y: 0, z: 0 }; brain.intent = { goal: ownGoal, targetId: 'other' };
  forgetTarget(brain, 'local'); assert.equal(brain.intent.goal, ownGoal);
});

test('bots cannot pursue or choose an attack against a hidden flag carrier', () => {
  const a = actor('bot-0', 0, { teamId: 'red', equipment: createEquipment('m4a1') }), b = actor('local', 2, { teamId: 'blue', hiddenSpotId: 'locker' });
  a.equipment.grenades.frag = 1;
  const actors = [a, b], state = createModeState({ modeId: 'ctf', map, participants: actors });
  Object.assign(state.flags.red, { status: 'carried', carrierId: b.id, x: 2, z: 0 });
  const intent = chooseBotIntent(a, { actors, state, map, role: 'defend', lastKnownTargets: new Map([[b.id, b]]) });
  assert.equal(intent.targetId, null); assert.notDeepEqual(intent.goal, { x: 2, y: 0, z: 0 });
  assert.equal(chooseBotEquipment(a, { actors, intent: { targetId: b.id }, solids: [], now: 100 }), null);
});

test('zombies forget a witnessed hide and patrol independently of hidden coordinates', () => {
  const world = createSpatialWorld(map), navigation = createNavigation(map, { radius: .4 });
  const a = actor('z', 0, { kind: 'walker' }), b = actor('local', 2);
  const brain = createZombieBrain('walker'), ctx = { actor: a, player: b, zombies: [], navigation, solids: [], world, smokes: [], dt: .05 };
  stepZombieBrain(brain, ctx); assert.equal(brain.goal.x, 2);
  const remembered = structuredClone(brain);
  const hidden = { ...b, hiddenSpotId: 'locker' };
  const result = stepZombieBrain(brain, { ...ctx, player: hidden });
  assert.equal(result.attack, false); assert.equal(brain.targetId, null);
  assert.notEqual(brain.goal?.x, 2); assert.ok(Math.hypot(result.x, result.z) > 0);
  const other = stepZombieBrain(remembered, { ...ctx, player: { ...hidden, x: 9, z: 9 } });
  assert.deepEqual(other.body, result.body);
  const wallWorld = createSpatialWorld({ ...map, solids: [{ x: 1, z: 0, w: .1, d: 20, height: 3 }] });
  stepZombieBrain(brain, { ...ctx, solids: wallWorld.solids, world: wallWorld });
  assert.equal(brain.targetId, null); assert.notEqual(brain.goal?.x, 2);
});

test('hidden player entry anchors keep zombie spawning connected without becoming pursuit goals', () => {
  const arena = MAPS[0], world = createSpatialWorld(arena), navigation = createNavigation(arena, { radius: .4 });
  const spot = arena.hideSpots[0], player = actor('local', spot.occupant.x, { ...spot.occupant, hiddenSpotId: spot.id });
  const spawn = selectZombieSpawn({ map: arena, navigation, player, zombies: [], fovRadians: 1.3 });
  assert.ok(spawn);
  const brain = createZombieBrain('walker');
  stepZombieBrain(brain, { actor: actor('z', spawn.x, { ...spawn, kind: 'walker' }), player, zombies: [], navigation, world, solids: world.solids, smokes: [], dt: .05 });
  assert.notDeepEqual(brain.goal, spot.entry); assert.equal(brain.targetId, null);
});

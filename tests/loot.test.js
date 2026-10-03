import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, getMap } from '../src/maps.js';
import { canOccupy, hasLineOfSight, moveCircle } from '../src/collision.js';
import { createNavigation } from '../src/navigation.js';
import { createEquipment, equipGun, deathItems, pickupEquipment } from '../src/equipment.js';
import { WEAPONS } from '../src/weapons.js';
import { LOOT_SPAWNS } from '../src/loot-spawns.js';
import { createLootState, reconcileStartingGuns, tickLoot, collectLoot, addDeathDrops, lootDTO } from '../src/loot.js';

const create = options => createLootState({ mapId: 'courtyard', seed: 1, startingGunIds: ['ak47'], ...options });
const createGearActor = (id, position, gun = 'm4a1') => ({
  id, lifeId: 1, teamId: null, x: position.x, y: position.y ?? 0, z: position.z,
  yaw: 0, pitch: 0, alive: true, protectedRemaining: 0, flashRemaining: 0,
  equipment: createEquipment(gun),
});
const gunItem = state => lootDTO(state).find(record => record.item.weaponId === 'ak47');
const mapGuns = state => lootDTO(state).filter(record => record.source === 'map' && record.item.kind === 'gun');
const drops = state => lootDTO(state).filter(record => record.source === 'drop');
const collectAt = (state, record, actors) => collectLoot(state, actors ?? [createGearActor('collector', record)], { solids: [] });
const addDrop = (state, actorId = 'victim', lifeId = 1, options = {}) => addDeathDrops(state, {
  actorId, lifeId, position: { x: 0, y: 2, z: 0 },
  items: [{ kind: 'gun', weaponId: 'ak47', ammo: 7, reserve: 12 }], solids: [], ...options,
});

for (const map of MAPS) {
  test(`${map.id} authors sixteen immutable safe reachable locations`, () => {
    assert.ok(LOOT_SPAWNS, 'authored locations must exist');
    const locations = LOOT_SPAWNS[map.id];
    assert.equal(locations.length, 16);
    assert.equal(new Set(locations.map(point => point.id)).size, 16);
    assert.deepEqual(['gun', 'knife', 'grenade'].map(kind => locations.filter(point => point.kind === kind).length), [8, 2, 6]);
    for (const type of ['frag', 'smoke', 'flash']) assert.equal(locations.filter(point => point.grenadeType === type).length, 2);
    assert.ok(Object.isFrozen(LOOT_SPAWNS) && Object.isFrozen(locations));
    const navigation = createNavigation(map);
    const centers = [map.playerSpawn, ...map.spawns, ...map.teamSpawns.red, ...map.teamSpawns.blue, ...Object.values(map.bases)];
    for (const point of locations) {
      assert.ok(Object.isFrozen(point));
      assert.ok(canOccupy(point.x, point.z, .42, map.solids), `blocked ${point.id}`);
      assert.ok(navigation.reachable(map.playerSpawn, point), `unreachable ${point.id}`);
      for (const center of centers) assert.ok(Math.hypot(point.x - center.x, point.z - center.z) > 1.2, `interaction overlap ${point.id}`);
    }
  });
}

test('seeded assignments are reproducible, fresh and detached from DTO consumers', () => {
  const state = create();
  assert.deepEqual(lootDTO(state), lootDTO(create()));
  assert.notDeepEqual(mapGuns(state), mapGuns(create({ seed: 2 })));
  assert.equal(lootDTO(state).length, 16);
  for (const record of mapGuns(state)) assert.equal(record.item.ammo + record.item.reserve, 500);
  const dto = lootDTO(state);
  dto[0].item.weaponId = 'tampered';
  dto[0].x = 100;
  assert.notEqual(lootDTO(state)[0].item.weaponId, 'tampered');
  assert.notEqual(lootDTO(state)[0].x, 100);
});

test('starter coverage includes eight distinct IDs and repeated IDs only need one location', () => {
  const ids = WEAPONS.slice(0, 8).map(gun => gun.id);
  const state = create({ startingGunIds: ids });
  assert.deepEqual(new Set(mapGuns(state).map(record => record.item.weaponId)), new Set(ids));
  assert.deepEqual(lootDTO(create({ startingGunIds: ['ak47', 'ak47'] })), lootDTO(create()));
  const before = lootDTO(state);
  reconcileStartingGuns(state, ids);
  assert.deepEqual(lootDTO(state), before);
});

test('late joins preserve participants coverage and respawning reassignment keeps its timer', () => {
  const state = create();
  const assigned = mapGuns(state).map(record => record.item.weaponId);
  const missing = WEAPONS.find(gun => !assigned.includes(gun.id)).id;
  // Require seven existing assignments, leaving exactly one replaceable slot.
  const replace = mapGuns(state)[7];
  collectAt(state, replace, [createGearActor('collector', replace, WEAPONS.find(gun => gun.id !== replace.item.weaponId).id)]);
  tickLoot(state, 6);
  reconcileStartingGuns(state, [...assigned.slice(0, 7), missing]);
  assert.deepEqual(mapGuns(state).map(record => record.item.weaponId), assigned.slice(0, 7));
  tickLoot(state, 13.999);
  assert.equal(mapGuns(state).length, 7);
  tickLoot(state, .001);
  const restored = mapGuns(state).find(record => record.id === replace.id);
  assert.equal(restored.item.weaponId, missing);
  assert.deepEqual(new Set(mapGuns(state).map(record => record.item.weaponId)), new Set([...assigned.slice(0, 7), missing]));
});

test('available reassignment is atomic and changes only missing starter coverage', () => {
  const state = create();
  const before = mapGuns(state);
  const missing = WEAPONS.find(gun => !before.some(record => record.item.weaponId === gun.id)).id;
  reconcileStartingGuns(state, ['ak47', missing]);
  const after = mapGuns(state);
  assert.ok(after.some(record => record.item.weaponId === 'ak47'));
  assert.ok(after.some(record => record.item.weaponId === missing));
  assert.equal(after.filter((record, index) => record.item.weaponId !== before[index].item.weaponId).length, 1);
});

test('nearest contested pickup is awarded once', () => {
  const loot = create();
  const item = gunItem(loot);
  const a = createGearActor('a', { x: item.x + .2, z: item.z });
  const b = createGearActor('b', { x: item.x + .4, z: item.z });
  const events = collectLoot(loot, [b, a], { solids: [] });
  assert.equal(events.filter(event => event.itemId === item.id).length, 1);
  assert.equal(a.equipment.owned.has('ak47'), true);
  assert.equal(b.equipment.owned.has('ak47'), false);
  assert.deepEqual(events.find(event => event.itemId === item.id), { type: 'pickup', playerId: 'a', itemId: item.id, item: item.item });
});

test('contested winners ignore array order and equal distances use stable actor IDs', () => {
  for (const reversed of [false, true]) for (const tied of [false, true]) {
    const state = create(), item = gunItem(state);
    const actors = [createGearActor('a', { ...item, x: item.x + .2 }), createGearActor('b', { ...item, x: item.x + (tied ? -.2 : .4) })];
    const events = collectAt(state, item, reversed ? actors.reverse() : actors);
    assert.equal(events.find(event => event.itemId === item.id).playerId, 'a');
  }
});

test('pickup radius and vertical feet separation include the exact limits', () => {
  for (const [distance, height, eligible] of [[1.2, .75, true], [1.20001, 0, false], [0, .75001, false], [0, -.75, true]]) {
    const state = create(), item = gunItem(state);
    const actor = createGearActor('a', { x: item.x + distance, y: height, z: item.z });
    collectAt(state, item, [actor]);
    assert.equal(actor.equipment.owned.has('ak47'), eligible, `${distance}/${height}`);
  }
});

test('walls dead actors and duplicate ownership leave pickups for eligible actors', () => {
  for (const reason of ['wall', 'dead', 'duplicate']) {
    const state = create(), item = gunItem(state);
    const actor = createGearActor('a', { ...item, x: item.x + .8 });
    if (reason === 'dead') actor.alive = false;
    if (reason === 'duplicate') pickupEquipment(actor.equipment, item.item);
    const solids = reason === 'wall' ? [{ x: item.x + .4, z: item.z, w: .1, d: 3, height: 2 }] : [];
    const events = collectLoot(state, [actor], { solids });
    assert.ok(!events.some(event => event.itemId === item.id));
    assert.ok(lootDTO(state).some(record => record.id === item.id));
  }
  const state = create(), item = gunItem(state);
  const duplicate = createGearActor('a', item, 'ak47'), eligible = createGearActor('b', { ...item, x: item.x + .3 });
  assert.equal(collectAt(state, item, [duplicate, eligible]).find(event => event.itemId === item.id).playerId, 'b');
});

test('protected actors collect without changing their held gun and duplicate knives remain', () => {
  const state = create(), item = lootDTO(state).find(record => record.item.kind === 'knife');
  const actor = createGearActor('a', item);
  actor.protectedRemaining = 2;
  collectAt(state, item, [actor]);
  assert.equal(actor.equipment.knife, true);
  assert.equal(actor.equipment.activeGunId, 'm4a1');
  const other = lootDTO(state).find(record => record.item.kind === 'knife');
  Object.assign(actor, { x: other.x, z: other.z });
  assert.ok(!collectAt(state, other, [actor]).some(event => event.itemId === other.id));
});

test('full grenade capacity skips the nearest actor and each award rechecks capacity', () => {
  const state = create();
  addDrop(state, 'victim', 1, { items: ['frag', 'smoke', 'flash'].map(grenadeType => ({ kind: 'grenade', grenadeType })) });
  tickLoot(state, .5);
  const actor = createGearActor('a', { x: 0, z: 0 });
  actor.equipment.grenades.frag = 2;
  const events = collectAt(state, drops(state)[0], [actor]);
  assert.equal(events.filter(event => event.itemId.startsWith('drop:')).length, 1);
  assert.equal(Object.values(actor.equipment.grenades).reduce((a, b) => a + b), 3);
  assert.equal(drops(state).length, 2);
  const next = createGearActor('b', { x: .2, z: 0 });
  assert.equal(collectAt(state, drops(state)[0], [actor, next]).filter(event => event.itemId.startsWith('drop:')).length, 2);
});

test('map pickups respawn once after twenty seconds with the same assignment and ID', () => {
  const state = create(), item = gunItem(state);
  collectAt(state, item);
  tickLoot(state, 19.999);
  assert.ok(!lootDTO(state).some(record => record.id === item.id));
  tickLoot(state, .001);
  assert.deepEqual(lootDTO(state).find(record => record.id === item.id), item);
  tickLoot(state, 100);
  assert.equal(lootDTO(state).filter(record => record.id === item.id).length, 1);
});

test('death drops preserve active gun ammo and grenades and reject duplicate same-life drops', () => {
  const state = create(), actor = createGearActor('victim', { x: 0, z: 0 }, 'ak47');
  equipGun(actor.equipment, 'mp5', { source: 'armory' });
  const gun = actor.equipment.owned.get('mp5');
  gun.ammo = 3; gun.reserve = 9; gun.reloadRemaining = 1;
  actor.equipment.knife = true; actor.equipment.heldItem = 'knife'; actor.equipment.grenades.smoke = 2;
  addDrop(state, actor.id, 1, { items: deathItems(actor.equipment) });
  assert.equal(drops(state).length, 3);
  assert.deepEqual(drops(state)[0].item, { kind: 'gun', weaponId: 'mp5', ammo: 3, reserve: 9 });
  addDrop(state, actor.id, 1, { items: deathItems(actor.equipment) });
  assert.equal(drops(state).length, 3);
  addDrop(state, actor.id, 2);
  assert.equal(drops(state).length, 4);
});

test('drops unlock after half a second, expire at thirty seconds and never respawn', () => {
  const state = create();
  addDrop(state);
  const item = drops(state)[0], actor = createGearActor('a', item);
  assert.equal(item.y, 0);
  assert.equal(item.availableRemaining, .5);
  assert.equal(item.expiresRemaining, 30);
  tickLoot(state, .499);
  assert.ok(!collectAt(state, item, [actor]).some(event => event.itemId === item.id));
  tickLoot(state, .001);
  assert.ok(collectAt(state, item, [actor]).some(event => event.itemId === item.id));
  tickLoot(state, 40);
  assert.equal(drops(state).length, 0);
  addDrop(state, 'other');
  tickLoot(state, 29.999);
  assert.equal(drops(state).length, 1);
  tickLoot(state, .001);
  assert.equal(drops(state).length, 0);
});

test('oldest drop eviction caps drops at forty-eight without evicting map slots', () => {
  const state = create();
  addDrop(state, 'first');
  const firstId = drops(state)[0].id;
  for (let index = 0; index < 49; index++) {
    addDrop(state, `victim-${index}`);
    assert.ok(drops(state).length <= 48);
  }
  assert.equal(drops(state).length, 48);
  assert.ok(!drops(state).some(record => record.id === firstId));
  assert.equal(lootDTO(state).filter(record => record.source === 'map').length, 16);
});

test('drop spread stays grounded clear and on the origin side of cover', () => {
  const state = create();
  const position = { x: 0, y: 3, z: 0 };
  const solids = [{ x: .6, z: 0, w: .2, d: 2, height: 3 }];
  addDrop(state, 'victim', 1, { position, solids, items: deathItems(createEquipment('ak47')).concat(['frag', 'smoke', 'flash'].map(grenadeType => ({ kind: 'grenade', grenadeType }))) });
  assert.equal(drops(state).length, 4);
  assert.ok(new Set(drops(state).map(record => `${record.x},${record.z}`)).size > 1);
  for (const record of drops(state)) {
    assert.equal(record.y, 0);
    assert.ok(canOccupy(record.x, record.z, .42, solids));
    assert.ok(hasLineOfSight({ x: 0, z: 0 }, record, solids));
  }
});

test('human and bot deaths at legal wall contact drop their gun and grenades exactly once', () => {
  const map = getMap('courtyard');
  // Literal radii match solo humans (.34), solo bots and online actors (.4).
  for (const radius of [.34, .4]) for (const boundary of [false, true]) {
    const state = create();
    const start = boundary ? { x: 22 - radius - .02, z: 0 } : { x: -6.9 + radius + .02, z: 0 };
    const position = moveCircle(start, boundary ? .02 : -.02, 0, radius, map.solids);
    assert.ok(canOccupy(position.x, position.z, radius, map.solids));
    assert.equal(canOccupy(position.x, position.z, .42, map.solids), false);
    const equipment = createEquipment('ak47');
    equipment.owned.get('ak47').ammo = 7;
    equipment.owned.get('ak47').reserve = 11;
    equipment.grenades = { frag: 1, smoke: 1, flash: 1 };
    const args = { actorId: 'victim', lifeId: 1, position, items: deathItems(equipment), solids: map.solids };
    addDeathDrops(state, args);
    assert.equal(drops(state).length, 4, `radius ${radius}, boundary ${boundary}`);
    assert.deepEqual(drops(state)[0].item, { kind: 'gun', weaponId: 'ak47', ammo: 7, reserve: 11 });
    assert.deepEqual(drops(state).slice(1).map(record => record.item.grenadeType), ['frag', 'smoke', 'flash']);
    for (const record of drops(state)) {
      assert.ok(canOccupy(record.x, record.z, .34, map.solids));
      assert.ok(record.x >= map.bounds.min + .34 && record.x <= map.bounds.max - .34);
      assert.ok(record.z >= map.bounds.min + .34 && record.z <= map.bounds.max - .34);
      assert.ok(hasLineOfSight(position, record, map.solids));
      assert.equal(record.y, 0);
    }
    const before = drops(state);
    addDeathDrops(state, args);
    assert.deepEqual(drops(state), before);
  }
});

test('invalid origins create no drops and invalid time steps cannot corrupt timers', () => {
  const state = create();
  for (const position of [{ x: NaN, z: 0 }, { x: 30, z: 0 }]) addDrop(state, String(position.x), 1, { position });
  addDrop(state, 'blocked', 1, { solids: [{ x: 0, z: 0, w: 2, d: 2, height: 2 }] });
  assert.equal(drops(state).length, 0);
  const before = lootDTO(state);
  for (const dt of [-1, NaN, Infinity, 0]) tickLoot(state, dt);
  assert.deepEqual(lootDTO(state), before);
});

test('malformed death height rejects the entire drop operation without reserving that life', () => {
  const state = create();
  addDrop(state, 'victim', 1, { position: { x: 0, y: Infinity, z: 0 } });
  assert.equal(drops(state).length, 0);
  addDrop(state, 'victim', 1);
  assert.equal(drops(state).length, 1);
  assert.equal(drops(state)[0].id, 'drop:1');
});

test('invalid starter coverage is rejected without changing current assignments', () => {
  const state = create(), before = lootDTO(state);
  for (const ids of [['unknown'], WEAPONS.slice(0, 9).map(gun => gun.id)]) {
    assert.throws(() => reconcileStartingGuns(state, ids), RangeError);
    assert.deepEqual(lootDTO(state), before);
    assert.throws(() => create({ startingGunIds: ids }), RangeError);
  }
});

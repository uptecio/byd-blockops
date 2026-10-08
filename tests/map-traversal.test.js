import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS } from '../src/maps.js';
import { validateTraversal } from '../src/map-traversal.js';
import { createSpatialWorld, canOccupyBody, supportBelow, segmentClear } from '../src/spatial.js';
import { createBody, moveCharacter } from '../src/character-movement.js';
import { createNavigation } from '../src/navigation.js';
import { LOOT_SPAWNS } from '../src/loot-spawns.js';

function replay(link, speed, world) {
  let body = createBody(link.from, world, { radius: .42 });
  for (let n = 0; n < 360; n++) {
    const dx = link.to.x - body.x, dz = link.to.z - body.z, distance = Math.hypot(dx, dz);
    if (distance < .02 && Math.abs(body.y - link.to.y) < 1e-8 && body.grounded) return true;
    const velocity = Math.min(speed, distance * 120);
    const result = moveCharacter(body, { vx: distance ? dx / distance * velocity : 0,
      vz: distance ? dz / distance * velocity : 0, jump: n === 0 && link.kind === 'jump' }, 1 / 120, { world, radius: .42 });
    assert.equal(result.invalid, false); body = result.body;
  }
  return false;
}

for (const map of MAPS) {
  test(`${map.id}: authored routes and hiding anchors are physically valid`, () => {
    assert.equal(validateTraversal(map).ok, true, JSON.stringify(validateTraversal(map).errors));
    assert.ok(map.traversal.roofs.length >= 2); assert.ok(map.traversal.shelters.length >= 1);
    assert.ok(map.hideSpots.length >= 2); assert.ok(map.traversal.roofs.some(roof => roof.singleEntrance));
    assert.equal(new Set(map.hideSpots.map(s => s.id)).size, map.hideSpots.length);
    const world = createSpatialWorld(map);
    for (const solid of map.solids) {
      assert.equal(solid.maxY - solid.minY, solid.height);
      assert.ok(map.blocks.some(b => b.x === solid.x && b.z === solid.z && b.w === solid.w
        && b.d === solid.d && b.h === solid.height && b.y === (solid.minY + solid.maxY) / 2), solid.id);
    }
    for (const spot of map.hideSpots) {
      for (const key of ['entry', 'exit', 'recovery', 'occupant']) {
        assert.equal(canOccupyBody(spot[key], .42, 1.84, world), true, `${spot.id} ${key}`);
        assert.equal(supportBelow(spot[key], .42, world)?.y, spot[key].y);
      }
      assert.equal(segmentClear(spot.view, { ...spot.entry, y: spot.entry.y + 1.65 }, world), true);
    }
    for (const link of map.traversal.links) for (const speed of [4.4 * .65, 2.1, 3.4]) {
      assert.equal(replay(link, speed, world), true, `${link.id} at speed ${speed}`);
    }
  });

  test(`${map.id}: new routes retain all spawn base loot and doorway ground access`, () => {
    const navigation = createNavigation(map);
    const starts = map.traversal.links.filter(link => link.from.y === 0).map(link => link.from);
    for (const team of ['red', 'blue']) assert.ok(starts.some(point => navigation.reachable(map.teamSpawns[team][0], point)));
    for (const point of [map.playerSpawn, ...map.spawns, ...map.teamSpawns.red, ...map.teamSpawns.blue,
      map.bases.red, map.bases.blue, ...LOOT_SPAWNS[map.id], ...starts, ...map.traversal.shelters.map(room => room.point)]) {
      assert.ok(navigation.reachable(map.playerSpawn, point), `disconnected ${JSON.stringify(point)}`);
    }
  });
}

test('invalid route risers, narrow landings and corrupt hide anchors are rejected', () => {
  const base = MAPS[0];
  for (const mutate of [
    map => { map.solids.push({ ...map.solids[0] }); },
    map => { map.traversal.links.find(l => l.kind === 'jump').to.y += 2; },
    map => { map.traversal.links.find(l => l.kind === 'jump').width = .7; },
    map => { map.traversal.links.find(l => l.kind === 'jump').depth = .5; },
    map => { map.solids.find(s => s.id.includes(':step:1')).w = .5; },
    map => { const p = map.hideSpots[0].exit; map.solids.push({ id: 'blocked-exit', x: p.x, z: p.z, w: 1, d: 1, minY: 0, maxY: 2, height: 2 }); },
    map => { map.hideSpots[0].view.y = 100; },
    map => { map.hideSpots[0].recovery.x = 100; },
    map => { map.hideSpots[0].proxy.max.y = NaN; },
    map => { map.hideSpots[0].proxy.min.x = map.hideSpots[0].proxy.max.x; },
  ]) {
    const map = structuredClone(base); mutate(map);
    assert.equal(validateTraversal(map).ok, false);
  }
});

test('a marked single-entrance roof rejects an extra normal-jump staircase', () => {
  const map = structuredClone(MAPS[0]);
  const roof = map.traversal.roofs.find(r => r.singleEntrance);
  const original = map.traversal.links.find(l => l.id === roof.entryLinkId);
  map.traversal.links.push({ ...original, id: 'second-approach' });
  assert.equal(validateTraversal(map).ok, false);
});

test('single-entrance validation catches an undeclared physical bypass staircase', () => {
  const map = structuredClone(MAPS[0]), roof = map.traversal.roofs[0];
  // New approach climbs south to the north annex, without declaring any links.
  for (let i = 1; i <= 4; i++) map.solids.push({ id: `bypass:${i}`, x: 20, z: 3.8 - i * 1.4,
    w: 1.6, d: 1.4, minY: 0, maxY: i * .44, height: i * .44 });
  assert.equal(validateTraversal(map).ok, false, roof.id);
});

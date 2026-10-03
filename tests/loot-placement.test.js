import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS } from '../src/maps.js';
import { LOOT_SPAWNS } from '../src/loot-spawns.js';
import { createNavigation } from '../src/navigation.js';

// Independent measurements of the approved original layout; catch renewed clustering.
const previousMinimum = { courtyard: 4, 'dust-town': 6, 'neon-city': 6, 'snow-base': 8, 'jungle-ruins': Math.sqrt(85), harbor: 6, 'desert-fort': 10, 'space-station': 8 };
const unchanged = {
  courtyard: [[-3,0],[3,0],[-6,12],[6,-12],[-6,-12],[6,12],[-2,10],[2,-10]],
  'dust-town': [[-2,0],[2,0],[-6,7],[6,-7],[-6,-7],[6,7],[-14,-3],[14,3]],
  'neon-city': [[-3,0],[3,0],[-4,9],[4,-9],[-4,-9],[4,9],[-18,5],[18,-5]],
  'snow-base': [[-8,0],[8,0],[-4,8],[4,-8],[-4,-8],[4,8],[-19,0],[19,0]],
  'jungle-ruins': [[-4,1],[4,-1],[-10,12],[10,-12],[-3,-6],[3,6],[-12,0],[12,0]],
  harbor: [[-2,0],[2,0],[-2,10],[2,-10],[-8,0],[8,0],[-18,-8],[18,8]],
  'desert-fort': [[-2,0],[2,0],[-3,8],[3,-8],[-3,-8],[3,8],[-17,4],[17,-4]],
  'space-station': [[-5,0],[5,0],[-4,6],[4,-6],[-4,-6],[4,6],[-19,11],[19,-11]],
};

function walkingDistance(navigation, start, goal) {
  let point = start, distance = 0;
  for (let step = 0; step < 400; step++) {
    if (Math.hypot(point.x - goal.x, point.z - goal.z) < 1e-6) return distance;
    const next = navigation.nextWaypoint(point, goal);
    assert.ok(next, 'Each gun has a traversable path from every team spawn');
    distance += Math.hypot(point.x - next.x, point.z - next.z); point = next;
  }
  assert.fail('Authored gun route must finish within the arena path bound');
}

for (const map of MAPS) {
  test(`${map.id} distributes eight gun pickups across both ends and flanking lanes`, () => {
    const guns = LOOT_SPAWNS[map.id].filter(point => point.kind === 'gun');
    assert.deepEqual(guns.map(point => point.id), Array.from({ length: 8 }, (_, i) => `map:${map.id}:gun:${i + 1}`));
    const minimum = Math.min(...guns.flatMap((point, i) => guns.slice(i + 1).map(other => Math.hypot(point.x - other.x, point.z - other.z))));
    assert.ok(minimum >= 12.5, `nearest guns must be at least 12.5 units apart; actual ${minimum}`);
    assert.ok(minimum >= previousMinimum[map.id] * 1.25, 'Even the previously widest map improves nearest-gun spacing by at least 25%');
    assert.ok(Math.max(...guns.map(p => p.x)) - Math.min(...guns.map(p => p.x)) >= 34, 'Both outer flanks have gun pickups');
    assert.ok(Math.max(...guns.map(p => p.z)) - Math.min(...guns.map(p => p.z)) >= 34, 'Both team ends have gun pickups');
    assert.equal(guns.filter(p => p.z >= 16).length, 2);
    assert.equal(guns.filter(p => p.z <= -16).length, 2);
    assert.equal(guns.filter(p => Math.abs(p.z) <= 8 && Math.abs(p.x) <= 4).length, 2, 'Central approaches retain two contested gun choices');
  });

  test(`${map.id} spread guns preserve comparable real walking access for both teams`, () => {
    const navigation = createNavigation(map);
    const guns = LOOT_SPAWNS[map.id].filter(point => point.kind === 'gun');
    const distances = team => guns.map(goal => Math.min(...map.teamSpawns[team].map(start => walkingDistance(navigation, start, goal)))).sort((a, b) => a - b);
    const red = distances('red'), blue = distances('blue');
    assert.ok(Math.max(...red.map((distance, i) => Math.abs(distance - blue[i]))) <= 4, `paired team access differs by no more than 4 walking units: ${JSON.stringify({ red, blue })}`);
    assert.ok(Math.abs(red.reduce((a,b) => a+b, 0) - blue.reduce((a,b) => a+b, 0)) / 8 <= 1, 'Average access differs by no more than one walking unit');
  });

  test(`${map.id} gun redistribution preserves every knife and grenade location`, () => {
    const other = LOOT_SPAWNS[map.id].filter(point => point.kind !== 'gun');
    assert.deepEqual(other.map(p => [p.x, p.z]), unchanged[map.id]);
    assert.deepEqual(other.map(p => p.id), ['knife:1','knife:2','frag:1','frag:2','smoke:1','smoke:2','flash:1','flash:2'].map(id => `map:${map.id}:${id}`));
  });
}

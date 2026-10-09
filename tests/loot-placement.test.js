import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS } from '../src/maps.js';
import { LOOT_SPAWNS } from '../src/loot-spawns.js';
import { createNavigation } from '../src/navigation.js';
import baseline from './fixtures/pre-tall-roof-ground.json' with { type: 'json' };

// Explicit, measured relocations around the tall-roof entrances. Every other
// pickup must retain its pre-feature coordinates and stable identity.
const relocations={
  courtyard:{'gun:1':[-8,20],'gun:2':[8,-20],'gun:4':[-8,-20]},
  'neon-city':{'gun:1':[-10,19],'gun:2':[10,-19]},
  'dust-town':{'frag:1':[-4.5,7],'frag:2':[4.5,-7]},
  'snow-base':{'gun:5':[-20,-4],'gun:6':[20,4],'gun:7':[-2,8],'gun:8':[2,-8],
    'knife:1':[-9.5,0],'knife:2':[9.5,0],'flash:1':[-20.5,0],'flash:2':[20.5,0]},
  'jungle-ruins':{'flash:1':[-13,0],'flash:2':[13,0]},
  'space-station':{'gun:5':[-18,-2],'health:1':[-3.5,17],'health:2':[3.5,-17],'armour:1':[3.5,17],'armour:2':[-3.5,-17]},
};

// Independent measurements of the approved original layout; catch renewed clustering.
const previousMinimum = { courtyard: 4, 'dust-town': 6, 'neon-city': 6, 'snow-base': 8, 'jungle-ruins': Math.sqrt(85), harbor: 6, 'desert-fort': 10, 'space-station': 8 };
const unchanged = {
  courtyard: [[-3,0],[3,0],[-6,12],[6,-12],[-6,-12],[6,12],[-2,10],[2,-10]],
  'dust-town': [[-2,0],[2,0],[-4.5,7],[4.5,-7],[-6,-7],[6,7],[-14,-3],[14,3]],
  'neon-city': [[-3,0],[3,0],[-4,9],[4,-9],[-4,-9],[4,9],[-18,5],[18,-5]],
  'snow-base': [[-9.5,0],[9.5,0],[-4,8],[4,-8],[-4,-8],[4,8],[-20.5,0],[20.5,0]],
  'jungle-ruins': [[-4,1],[4,-1],[-10,12],[10,-12],[-3,-6],[3,6],[-13,0],[13,0]],
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
  test(`${map.id} preserves baseline loot except documented clear-route relocations`,()=>{
    assert.equal(LOOT_SPAWNS[map.id].length,baseline[map.id].loot.length);
    for(const prior of baseline[map.id].loot) {
      const next=LOOT_SPAWNS[map.id].find(p=>p.id===prior.id),key=prior.id.slice(`map:${map.id}:`.length);
      const [x,z]=relocations[map.id]?.[key]||[prior.x,prior.z];
      assert.deepEqual(next,{...prior,x,z});
    }
  });
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

  test(`${map.id} keeps the fixed knife and grenade spawn catalog`, () => {
    const other = LOOT_SPAWNS[map.id].filter(point => ['knife', 'grenade'].includes(point.kind));
    assert.deepEqual(other.map(p => [p.x, p.z]), unchanged[map.id]);
    assert.deepEqual(other.map(p => p.id), ['knife:1','knife:2','frag:1','frag:2','smoke:1','smoke:2','flash:1','flash:2'].map(id => `map:${map.id}:${id}`));
  });

  test(`${map.id} supplies are spread rotated pairs with fair walking access`, () => {
    const navigation = createNavigation(map), slots = LOOT_SPAWNS[map.id];
    for (const type of ['health', 'armour']) {
      const supplies = slots.filter(p => p.supplyType === type);
      assert.equal(supplies.length, 2);
      assert.deepEqual([supplies[1].x, supplies[1].z], [-supplies[0].x, -supplies[0].z]);
      assert.ok(Math.hypot(supplies[0].x - supplies[1].x, supplies[0].z - supplies[1].z) >= 10);
      for (const p of supplies) {
        assert.ok(p.x >= map.bounds.min + .42 && p.x <= map.bounds.max - .42);
        assert.ok(p.z >= map.bounds.min + .42 && p.z <= map.bounds.max - .42);
        for (const other of slots.filter(s => s !== p)) assert.ok(Math.hypot(p.x - other.x, p.z - other.z) >= 3, `${p.id} near ${other.id}`);
        for (const start of [map.playerSpawn, ...map.spawns, ...map.teamSpawns.red, ...map.teamSpawns.blue]) assert.ok(navigation.reachable(start, p));
      }
      const distances = team => supplies.map(p => Math.min(...map.teamSpawns[team].map(start => walkingDistance(navigation, start, p)))).sort((a,b) => a-b);
      const red = distances('red'), blue = distances('blue');
      assert.ok(red.every((distance, i) => Math.abs(distance - blue[i]) <= 4), JSON.stringify({ type, red, blue }));
    }
    assert.deepEqual(slots.filter(p => p.kind === 'gun').map(p => [p.x,p.z]), map.id==='courtyard'
      ? [[-8,20],[8,-20],[10,18],[-8,-20],[-18,-4],[18,4],[-2,6],[2,-6]]
      : map.id==='neon-city' ? [[-10,19],[10,-19],[10,18],[-10,-18],[-18,-4],[18,4],[-2,6],[2,-6]]
      : map.id==='snow-base'
      ? [[-10,18],[10,-18],[10,18],[-10,-18],[-20,-4],[20,4],[-2,8],[2,-8]]
      : map.id==='space-station' ? [[-10,18],[10,-18],[10,18],[-10,-18],[-18,-2],[18,4],[-2,6],[2,-6]]
      : [[-10,18],[10,-18],[10,18],[-10,-18],[-18,-4],[18,4],[-2,6],[2,-6]]);
  });
}

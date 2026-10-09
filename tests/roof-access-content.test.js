import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS } from '../src/maps.js';
import { createSpatialWorld, canOccupyBody, supportBelow } from '../src/spatial.js';
import { auditRoofApproaches } from '../src/roof-access-validation.js';
import { replayRoof } from './helpers/roof-route-replay.js';
import baseline from './fixtures/pre-tall-roof-ground.json' with { type: 'json' };

const families = [ ['dust-town',4,'wooden crates'], ['snow-base',7,'ice blocks'], ['jungle-ruins',4,'broken stone'], ['space-station',9,'metal platforms'] ];
for (const [id, originals, theme] of families) {
  test(`${id}: complete original roof catalog, visible supports and unchanged ground anchors`, () => {
    const map = MAPS.find(m=>m.id===id), world = createSpatialWorld(map);
    for(const key of ['bounds','playerSpawn','spawns','teamSpawns','bases']) assert.deepEqual(map[key],baseline[id][key],`${id}: preserved ${key}`);
    assert.deepEqual(map.traversal.shelters,baseline[id].shelters);
    assert.deepEqual(map.hideSpots.map(({id,entry,exit,recovery,occupant,view})=>({id,entry,exit,recovery,occupant,view})),baseline[id].hideSpots);
    assert.equal(map.traversal.roofs.length, originals+2);
    assert.equal(map.traversal.roofs.filter(r=>r.source==='original').length, originals);
    assert.equal(map.traversal.roofs.filter(r=>r.source==='annex').length, 2);
    assert.deepEqual(map.bounds,{min:-22,max:22}); assert.deepEqual(map.playerSpawn,{x:0,z:19});
    assert.deepEqual(map.bases,{red:{x:0,z:18},blue:{x:0,z:-18}});
    for (const [team,z] of [['red',19],['blue',-19]]) assert.deepEqual(map.teamSpawns[team],[-8,-4,0,4,8].map(x=>({x,z})));
    for (const roof of map.traversal.roofs) {
      assert.equal(roof.style,'jump'); assert.equal(roof.theme,theme);
      assert.ok(roof.source==='annex' || roof.id.startsWith(`${id}:original:`));
      assert.equal(supportBelow(roof.point,.42,world)?.id,roof.supportId);
      assert.equal(canOccupyBody(roof.point,.42,1.84,world),true);
      const a=roof.standingArea;
      assert.ok(a.maxX-a.minX>=1.6-1e-8 && a.maxZ-a.minZ>=1.2-1e-8,`${roof.id}: useful standing area`);
      for (const x of [a.minX+.42,(a.minX+a.maxX)/2,a.maxX-.42]) for (const z of [a.minZ+.42,(a.minZ+a.maxZ)/2,a.maxZ-.42]) {
        assert.equal(canOccupyBody({x,y:roof.point.y,z},.42,1.84,world),true,`${roof.id}: clear standing area`);
      }
      for (const solidId of [roof.supportId,...roof.guardSolidIds,...roof.routeSolidIds]) {
        const solid=map.solids.find(s=>s.id===solidId),block=map.blocks.find(b=>b.solidId===solidId);
        assert.ok(solid && block,solidId); assert.ok(Math.abs(block.y+block.h/2-solid.maxY)<1e-8);
      }
      const links=map.traversal.links.filter(l=>l.routeId===roof.routeId);
      assert.equal(links.at(-1).id,roof.entryLinkId);
      for (const link of links) { assert.ok(link.to.y-link.from.y<=.55+1e-8); assert.ok(link.width>=1.6 && link.depth>=1.2); }
      for(let i=0;i<links.length-1;i++) {
        const a=links[i].from,b=links[i].to,c=links[i+1].to,dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);
        if(Math.abs(dx*(c.z-b.z)-dz*(c.x-b.x))>1e-6) continue;
        for(const sign of [-1,1]) assert.equal(canOccupyBody({x:b.x-dz/length*.38*sign,y:b.y,z:b.z+dx/length*.38*sign},.42,1.84,world),true,`${roof.id}: full 1.6 clear tread width ${i}`);
      }
    }
    for (const spot of map.hideSpots) for (const anchor of ['entry','exit','recovery','occupant']) assert.equal(canOccupyBody(spot[anchor],.42,1.84,world),true,`${spot.id}:${anchor}`);
    const started=performance.now(),audit=auditRoofApproaches(map);
    assert.equal(audit.ok,true); assert.ok(performance.now()-started<5000,'bounded authoring audit');
  });
  test(`${id}: every route physically climbs and descends, still requiring Jump`, t => {
    const map=MAPS.find(m=>m.id===id);
    assert.equal(map.traversal.roofs.length, originals+2);
    for (const roof of map.traversal.roofs) for (const radius of [.34,.4,.42]) for (const speed of [1.6,2.1,3.4,2.86,5.3,6]) {
      for (const direction of ['up','down']) {
        const result=replayRoof(map,roof,{speed,radius,direction});
        assert.ok(result.seconds<200,`${roof.id}/${radius}/${speed}/${direction}: stalled ${JSON.stringify(result.body)}`);
        assert.equal(result.body.supportId,direction==='up'?roof.supportId:'ground');
        assert.equal(result.trace.every(s=>!s.invalid),true);
        if (direction==='up') assert.equal(result.intents.some(i=>i.jump),true);
        assert.ok(result.stats.nodes<=40000 && result.stats.cachedFields<=32);
      }
    }
    for (const roof of map.traversal.roofs) assert.notEqual(replayRoof(map,roof,{speed:6,jump:false}).body.supportId,roof.supportId);
    t.diagnostic(`${map.solids.length} solids / ${map.traversal.links.length} links`);
  });
}

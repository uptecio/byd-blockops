import test from 'node:test';
import assert from 'node:assert/strict';
import { accessFixture } from './helpers/access-fixture.js';
import { createNavigation, navigationIntent } from '../src/navigation.js';
import { createBody, moveCharacter } from '../src/character-movement.js';
import { createSpatialWorld } from '../src/spatial.js';
import { advanceBody } from './helpers/traversal-fixture.js';
import { createHeadlessGame, cleanupGame } from './helpers/game-fixture.js';

function follow(f,nav,start,goal,speed) {
  let body=start,trace=[],intents=[];
  for (let n=0;n<2400;n++) {
    if (Math.hypot(body.x-goal.x,body.y-goal.y,body.z-goal.z)<.008 && (goal.ladderId?body.ladderId===goal.ladderId:body.grounded)) return {body,trace,intents};
    const waypoint=nav.nextWaypoint(body,goal);
    assert.ok(waypoint,`no waypoint from ${JSON.stringify(body)} to ${JSON.stringify(goal)}`);
    const intent=navigationIntent(body,waypoint,Math.min(speed,Math.hypot(waypoint.x-body.x,waypoint.z-body.z)*60),f.world);
    const result=moveCharacter(body,intent,1/120,{world:f.world,radius:.42});
    assert.equal(result.invalid,false); trace.push(result); intents.push(intent); body=result.body;
  }
  assert.fail(`stalled at ${JSON.stringify(body)} to ${JSON.stringify(goal)}`);
}

for (const kind of ['stair','ladder']) for (const speed of [1.6,2.1,3.4,2.86,6]) test(`${kind} navigates up and down at ground speed ${speed}`, () => {
  const f=accessFixture({kind}),nav=createNavigation(f.map);
  const up=follow(f,nav,createBody(f.start,f.world,{radius:.42}),f.goal,speed);
  assert.equal(up.body.supportId,kind==='stair'?'landing':'deck');
  assert.equal(up.intents.some(i=>i.jump),false);
  if (kind==='ladder') assert.equal(up.trace.some(s=>s.body.ladderId===f.ladderId),true);
  const down=follow(f,nav,up.body,f.start,speed);
  assert.equal(down.body.supportId,'ground'); assert.equal(down.intents.some(i=>i.jump),false);
});

test('navigation pursues actual intermediate ladder height from either endpoint and along a vertical shaft', () => {
  const f=accessFixture(),nav=createNavigation(f.map),goal={x:0,y:1.15,z:-1.5,ladderId:f.ladderId};
  for (const start of [f.start,f.goal]) {
    assert.equal(nav.reachable(start,goal),true);
    const result=follow(f,nav,createBody(start,f.world),goal,2.1);
    assert.ok(Math.abs(result.body.y-1.15)<.008); assert.equal(result.body.ladderId,f.ladderId);
  }
  const middle=advanceBody(createBody(f.start,f.world),{vx:0,vz:0,climb:1},.2,f.world);
  assert.equal(nav.nextApproachWaypoint(middle,goal,.34).ladderId,f.ladderId);
  assert.ok(follow(f,nav,middle,goal,0).body.y>1.14);
});

test('an attached body routes to the correct real landing before a separate ground goal', () => {
  const f=accessFixture(),nav=createNavigation(f.map);
  const middle=advanceBody(createBody(f.start,f.world),{vx:0,vz:0,climb:1},.5,f.world);
  const result=follow(f,nav,middle,{x:0,y:0,z:1},2.1);
  assert.equal(result.body.ladderId,null); assert.equal(result.body.y,0);
  assert.equal(result.intents.some(i=>i.climb<0),true);
});

test('navigation caches remain bounded and clear without retaining prior map attachments', () => {
  const f=accessFixture(),nav=createNavigation(f.map);
  for (let x=-8;x<=8;x++) for (let z=-8;z<=8;z++) nav.nextWaypoint(f.start,{x,y:0,z});
  assert.ok(nav.stats().nodes<=40000); assert.ok(nav.stats().cachedFields<=32);
  nav.clearCache(); assert.equal(nav.stats().cachedFields,0);
  const other=accessFixture({kind:'stair'}),fresh=createNavigation(other.map);
  assert.equal(fresh.nextWaypoint({...f.start,ladderId:f.ladderId},other.goal),null);
});

test('a physical interruption keeps the ladder waypoint without granting a teleport', () => {
  const f=accessFixture(),nav=createNavigation(f.map);
  let body=advanceBody(createBody(f.start,f.world),{vx:0,vz:0,climb:1},.1,f.world);
  f.world.solids.push({id:'block',x:0,z:-1.5,w:.1,d:.1,minY:2.4,maxY:2.5});
  for (let n=0;n<120;n++) {
    const waypoint=nav.nextWaypoint(body,f.goal),intent=navigationIntent(body,waypoint,2.1,f.world);
    const result=moveCharacter(body,intent,1/120,{world:f.world});
    assert.equal(result.invalid,false); body=result.body;
  }
  assert.ok(body.y<.57); assert.equal(body.ladderId,f.ladderId);
  assert.equal(nav.nextWaypoint(body,f.goal).ladderId,f.ladderId);
});

test('the ordinary bot runtime supplies climb intent even on a purely vertical shaft', t => {
  const f=accessFixture(),game=createHeadlessGame(); game.start('m4a1',{bots:1}); t.after(()=>cleanupGame(game));
  game.world.spatial=f.world; game.world.solids=f.world.solids; game.world.definition=f.map;
  game.navigation=createNavigation(f.map,{radius:.4});
  const bot=game.bots[0]; bot.body=createBody(f.start,f.world);
  bot.intent={goal:f.goal,targetId:null}; bot.intentTimer=100; bot.pathTimer=0; bot.cooldown=100;
  for (let n=0;n<900 && bot.body.supportId!=='deck';n++) game.updateBots(1/120);
  assert.equal(bot.body.supportId,'deck'); assert.equal(bot.body.y,2.4);
});

test('a new jump around a corner is not pulled back onto the previous landing', () => {
  const points=[{x:0,y:0,z:0},{x:1.4,y:.4,z:0},{x:1.4,y:.8,z:1.4},{x:2.8,y:1.2,z:1.4}];
  const map={id:'corner',bounds:{min:-10,max:10},solids:points.slice(1).map((p,i)=>({id:`p${i}`,x:p.x,z:p.z,w:1.6,d:1.6,minY:0,maxY:p.y})),
    traversal:{links:points.slice(1).map((p,i)=>({id:`link${i}`,from:points[i],to:p,kind:'jump',routeId:'corner'}))}};
  const world=createSpatialWorld(map),nav=createNavigation(map),body=createBody(points[1],world);
  const airborne=moveCharacter(body,{vx:0,vz:1.6,jump:true},1/60,{world}).body;
  assert.equal(nav.nextWaypoint(airborne,points[3]).linkId,'link1');
  assert.equal(follow({world},nav,createBody(points[0],world),points[3],1.6).body.supportId,'p2');
});

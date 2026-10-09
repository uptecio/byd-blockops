import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { climbHint, renderClimbHint, interpolateClimber } from '../src/climb-presentation.js';
import { sampleLadder, projectLadder, ladderLength } from '../src/access-schema.js';
import { canOccupyBody } from '../src/spatial.js';
import { createBody } from '../src/character-movement.js';
import { OnlineArena } from '../src/online-game.js';
import { RoomManager } from '../server/rooms.js';
import { createHeadlessGame, cleanupGame } from './helpers/game-fixture.js';
import { accessFixture } from './helpers/access-fixture.js';

test('contextual ladder hints are display-only, compact and suppressed outside eligible play',()=>{
  const f=accessFixture(),ladder=f.world.ladders[0],body={...createBody(f.start,f.world),health:100};
  assert.deepEqual(climbHint(body,f.world),{visible:true,text:'Up / down to climb'});
  const attached={...body,...sampleLadder(ladder,1),ladderId:ladder.id,grounded:false,supportId:null};
  assert.deepEqual(climbHint(attached,f.world),{visible:true,text:'Climbing · Jump to let go'});
  for(const change of [{health:0},{hiddenSpotId:'hidden'},{dead:1},{respawnRemaining:1},{alive:false}])
    assert.equal(climbHint({...attached,...change},f.world).visible,false);
  assert.equal(climbHint({...body,x:10},f.world).visible,false);
  assert.equal(climbHint({...attached,ladderId:'old-map'},f.world).visible,false);
  const element={addEventListener:()=>assert.fail('hint must not register new controls')};
  renderClimbHint(element,climbHint(attached,f.world));assert.equal(element.hidden,false);assert.match(element.textContent,/Jump/);
  renderClimbHint(element,{visible:false,text:''});assert.equal(element.hidden,true);assert.equal(element.textContent,'');
  assert.match(readFileSync('index.html','utf8'),/id="climb-hint"/);
  assert.match(readFileSync('src/main.js','utf8'),/renderClimbHint\(/);
});

test('climbing interpolation follows bent path distance both ways, snapping attachment/life/map changes',()=>{
  const f=accessFixture(),ladder=f.world.ladders[0],world=f.world;
  const at=d=>({...sampleLadder(ladder,d),ladderId:ladder.id,lifeId:1,mapId:f.map.id});
  for(const [a,b] of [[1.8,3.3],[3.3,1.8]])for(const alpha of [0,.1,.3,.5,.7,.9,1]) {
    const point=interpolateClimber(at(a),at(b),alpha,world);
    assert.ok(projectLadder(ladder,point).error<1e-8);assert.ok(canOccupyBody(point,.4,1.84,world));
    assert.ok(Math.abs(projectLadder(ladder,point).distance-(a+(b-a)*alpha))<1e-8);
  }
  for(const change of [{ladderId:null},{lifeId:2},{mapId:'different'},{ladderId:'stale'}]) {
    const next={...at(ladderLength(ladder)),...change};
    assert.deepEqual(interpolateClimber(at(1.8),next,.1,world),{x:next.x,y:next.y,z:next.z});
  }
  assert.deepEqual(interpolateClimber({x:0,y:0,z:0,ladderId:null},{x:2,y:0,z:2,ladderId:null},.5,world),{x:1,y:0,z:1});
});

test('online late joins and both directions render attached camera and remote without resetting held Fire on attach',t=>{
  const manager=new RoomManager(),room=manager.create('a','A','m4a1',{mapId:'harbor'});
  manager.join('b',room.code,'B');manager.start('a');
  const a=room.players.get('a'),b=room.players.get('b'),ladder=room.physics.spatial.ladders[0];
  for(const player of [a,b])Object.assign(player,createBody(ladder.bottom.point,room.physics.spatial));
  const game=createHeadlessGame(),sent=[],arena=new OnlineArena(game,{send:p=>{sent.push(p);return true;}});
  t.after(()=>{arena.stop();cleanupGame(game);});
  const snapshot=()=>({...manager.snapshot(room,false),selfEquipment:manager.equipmentSnapshot(a.id)});
  arena.start(snapshot(),a.id,{});game.input.fire=true;game.input.keys.add('KeyW');
  for(const player of [a,b])manager.input(player.id,{lifeId:player.lifeId,x:0,y:1,yaw:1.8,pitch:0});
  manager.tick(.2);arena.sync(snapshot());
  assert.equal(game.player.ladderId,ladder.id);assert.equal(game.input.fire,true);assert.equal(game.input.keys.has('KeyW'),true);
  assert.equal(game.camera.position.y,a.y+1.65);
  let crossedBend=false;
  for(const direction of [1,-1])for(let n=0;n<17;n++) {
    for(const player of [a,b])manager.input(player.id,{lifeId:player.lifeId,x:0,y:direction,yaw:n,pitch:0});
    manager.tick(.1);arena.sync(snapshot());arena.update(.03);
    crossedBend ||= a.y===ladder.top.point.y;
    assert.ok(projectLadder(ladder,game.player).error<1e-8);
    assert.ok(projectLadder(ladder,arena.remotes.get(b.id).model.position).error<1e-8);
  }
  assert.equal(crossedBend,true,'actual online presentation reaches the roof-edge bend');
  const lateGame=createHeadlessGame(),late=new OnlineArena(lateGame,{send:()=>true});
  t.after(()=>{late.stop();cleanupGame(lateGame);});late.start(snapshot(),a.id,{});
  assert.equal(lateGame.player.y,a.y);assert.equal(lateGame.player.ladderId,ladder.id);
  assert.equal(late.remotes.get(b.id).model.position.y,b.y);
  for(const player of [a,b])manager.input(player.id,{lifeId:player.lifeId,x:0,y:0,jump:true,yaw:0,pitch:0});
  manager.tick(.01);arena.sync(snapshot());
  assert.equal(game.player.ladderId,null);assert.equal(game.player.y,a.y);
  assert.deepEqual(arena.remotes.get(b.id).model.position.toArray(),[b.x,b.y,b.z]);
  const previous=snapshot();manager.spawn(room,a);arena.sync(snapshot());arena.sync(previous);
  assert.equal(game.player.lifeId,a.lifeId);assert.equal(game.player.y,0);
  room.phase='ended';manager.configure(a.id,{mapId:'snow-base',modeId:'ffa'});manager.start(a.id);arena.sync(snapshot());
  assert.equal(game.world.definition.id,'snow-base');assert.equal(game.player.ladderId,null);assert.equal(game.player.y,0);
  arena.stop();assert.equal(game.player.ladderId,null);assert.equal(game.player.ladderDistance,0);assert.equal(game.player.ladderBlockedId,null);
});

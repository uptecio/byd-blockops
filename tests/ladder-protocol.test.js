import test from 'node:test';
import assert from 'node:assert/strict';
import { validPlayerSpatial } from '../src/hiding-protocol.js';
import { PROTOCOL_VERSION } from '../src/protocol.js';
import { RoomClient } from '../src/network.js';
import { RoomManager } from '../server/rooms.js';
import { createBody, moveCharacter } from '../src/character-movement.js';
import { accessFixture } from './helpers/access-fixture.js';
import { WebSocket } from 'ws';
import { startServer } from '../server/server.mjs';
import { getMap } from '../src/maps.js';
import { createNavigation } from '../src/navigation.js';

test('protocol seven validates only living exposed collision-safe attachments on this map',()=>{
  assert.equal(PROTOCOL_VERSION,7);
  const f=accessFixture();
  const actor={...moveCharacter(createBody(f.start,f.world),{vx:0,vz:0,climb:1},.25,{world:f.world}).body,
    health:100,respawnRemaining:0,hiddenSpotId:null};
  assert.equal(validPlayerSpatial(actor,f.map),true);
  assert.equal(validPlayerSpatial({...actor,x:.00009},f.map),true);
  for(const change of [{x:.001},{ladderId:undefined},{ladderId:''},{ladderId:3},{ladderId:'old-map:ladder'},
    {health:0},{health:NaN},{respawnRemaining:1},{grounded:true},{supportId:'ground'},{hiddenSpotId:f.map.hideSpots[0].id}])
    assert.equal(validPlayerSpatial({...actor,...change},f.map),false,JSON.stringify(change));
  const obstructed={...f.map,solids:[...f.map.solids,{id:'obstacle',x:0,z:-1.5,w:.2,d:.2,minY:.7,maxY:1}]};
  assert.equal(validPlayerSpatial(actor,obstructed),false);
  assert.equal(validPlayerSpatial({...actor,ladderId:null},f.map),true,'ordinary falling body remains valid');
});

class Socket extends EventTarget {
  constructor(){super();Socket.last=this;this.readyState=1;}
  send(){}
  close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
  packet(value){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(value)}));}
}

test('strict room snapshots accept actual climbing, reject forged fields atomically, and keep internal progress private',async t=>{
  const prior=globalThis.WebSocket;globalThis.WebSocket=Socket;t.after(()=>{globalThis.WebSocket=prior;});
  const manager=new RoomManager(),room=manager.create('a','Host','m4a1',{mapId:'harbor'});
  manager.join('b',room.code,'Guest');manager.start('a');const a=room.players.get('a'),ladder=room.physics.spatial.ladders[0];
  Object.assign(a,createBody(ladder.bottom.point,room.physics.spatial));
  manager.input(a.id,{lifeId:a.lifeId,x:0,y:1,yaw:0,pitch:0});manager.tick(.2);
  const errors=[],client=new RoomClient({onError:e=>errors.push(e)});t.after(()=>client.close());
  const pending=client.connect('http://localhost:4180',{type:'create'}),socket=Socket.last;
  socket.dispatchEvent(new Event('open'));
  const packet=()=>({type:'state',protocol:PROTOCOL_VERSION,room:manager.snapshot(room,false),equipment:manager.equipmentSnapshot(a.id),progression:manager.progressionSnapshot(a.id)});
  socket.packet({...packet(),type:'welcome',id:a.id});await pending;
  const original=client.room;
  assert.equal(original.players[0].ladderId,ladder.id);
  assert.ok(original.players.every(p=>!Object.hasOwn(p,'ladderDistance')&&!Object.hasOwn(p,'ladderBlockedId')));
  for(const mutate of [p=>{delete p.room.players[0].ladderId;},p=>{p.room.players[0].ladderId='stale';},
    p=>{p.room.players[0].ladderDistance=100;},p=>{p.room.players[0].ladderBlockedId=null;},
    p=>{p.room.players[0].x+=.001;},p=>{p.room.players[0].health=0;},p=>{p.room.players[0].grounded=true;},
    p=>{p.protocol=6;}]) {
    const bad=packet();mutate(bad);const count=errors.length;socket.packet(bad);
    assert.equal(client.room,original);assert.equal(errors.length,count+1);
  }
  assert.match(errors.at(-1),/Update required/);
  manager.join('late',room.code,'Late');socket.packet(packet());
  assert.equal(client.room.players.length,3);assert.equal(client.room.players[0].ladderId,ladder.id);
});

for (const snapshotDelay of [0,100]) test(`independent websocket peers and a late join see actual public-input ascent hold and descent (${snapshotDelay}ms snapshot delay)`,async t=>{
  class DelayedWebSocket extends WebSocket {
    addEventListener(type,listener,...options) {
      return super.addEventListener(type,type==='message'&&snapshotDelay
        ? event=>setTimeout(()=>{if(this.readyState===WebSocket.OPEN)listener(event);},snapshotDelay)
        : listener,...options);
    }
  }
  const previous=globalThis.WebSocket;globalThis.WebSocket=DelayedWebSocket;t.after(()=>{globalThis.WebSocket=previous;});
  const server=await startServer({port:0});t.after(()=>server.close());
  const errors=[],clients=Array.from({length:3},()=>new RoomClient({onError:e=>errors.push(e)}));
  t.after(()=>clients.forEach(c=>c.close()));const [a,b,late]=clients,url=`http://127.0.0.1:${server.port}`;
  const inputTrace=[];
  const until=async(check,timeout=5000)=>{const deadline=Date.now()+timeout;while(Date.now()<deadline){if(check())return;await new Promise(r=>setTimeout(r,30));}assert.fail(`Authoritative ladder state timed out: ${JSON.stringify({inputTrace:inputTrace.slice(-12),clients:clients.map(c=>({id:c.id,room:c.room})),errors})}`);};
  await a.connect(url,{type:'create',name:'Climber',mapId:'harbor'});await b.connect(url,{type:'join',name:'Observer',code:a.room.code});
  a.send({type:'start'});await until(()=>a.room.phase==='playing'&&b.room.phase==='playing');
  const map=getMap('harbor'),ladder=map.traversal.ladders[0],navigation=createNavigation(map,{radius:.4}),goal=ladder.bottom.point;
  const own=()=>a.room.players.find(p=>p.id===a.id);
  const controls=fields=>{inputTrace.push({at:Date.now(),body:{...own()},fields});return a.send({type:'input',lifeId:own().lifeId,x:0,y:0,yaw:0,pitch:0,...fields});};
  const deadline=Date.now()+30000;
  while(Math.hypot(own().x-goal.x,own().z-goal.z)>.08&&Date.now()<deadline) {
    const body=own(),next=navigation.nextWaypoint(body,goal);assert.ok(next);
    const dx=next.x-body.x,dz=next.z-body.z,d=Math.hypot(dx,dz),scale=Math.min(1,d/.5)/Math.max(.001,d);
    controls({x:dx*scale,y:-dz*scale});await new Promise(r=>setTimeout(r,67));
  }
  assert.ok(Math.hypot(own().x-goal.x,own().z-goal.z)<=.08,'public controls reached authored ladder entry');
  // The last walking packet can carry the server past the centre while this
  // snapshot still shows the near side. Stop and observe newer simulation
  // time before deriving facing; an away-facing grab is correctly refused.
  const arrivalTime=a.room.timeLeft;controls({});
  await until(()=>a.room.timeLeft<arrivalTime-.4);
  controls({y:1,yaw:Math.atan2(own().x-goal.x,own().z-goal.z)});
  await until(()=>own().ladderId===ladder.id&&own().y>.25);controls({yaw:2,pitch:.7});
  await new Promise(r=>setTimeout(r,400));const height=own().y;
  await until(()=>Math.abs(b.room.players.find(p=>p.id===a.id).y-height)<1e-8);
  await late.connect(url,{type:'join',name:'Late',code:a.room.code});
  assert.equal(late.room.players.find(p=>p.id===a.id).ladderId,ladder.id);
  assert.equal(late.room.players.find(p=>p.id===a.id).y,height);
  controls({y:-1,yaw:-2,pitch:-.7});await until(()=>own().y<height-.15);controls({});
  await new Promise(r=>setTimeout(r,200));assert.ok(own().y<height);assert.deepEqual(errors,[]);
});

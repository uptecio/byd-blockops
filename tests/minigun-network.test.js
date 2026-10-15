import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startServer } from '../server/server.mjs';
import { validGearWorld, validEquipmentSnapshot } from '../src/gear-protocol.js';

async function peer(t,port) {
  const socket=new WebSocket(`ws://127.0.0.1:${port}/ws`),queue=[],waiters=[];
  socket.on('message',data=>{
    const packet=JSON.parse(data),index=waiters.findIndex(w=>w.predicate(packet));
    if(index<0)queue.push(packet);else {const [waiter]=waiters.splice(index,1);clearTimeout(waiter.timer);waiter.resolve(packet);}
  });
  t.after(()=>{for(const waiter of waiters)clearTimeout(waiter.timer);socket.terminate();});
  await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
  return {send:packet=>socket.send(JSON.stringify(packet)),next(predicate=()=>true){
    const index=queue.findIndex(predicate);if(index>=0)return Promise.resolve(queue.splice(index,1)[0]);
    return new Promise((resolve,reject)=>{
      const waiter={predicate,resolve};waiter.timer=setTimeout(()=>{waiters.splice(waiters.indexOf(waiter),1);reject(new Error('minigun socket timeout'));},4000);waiters.push(waiter);
    });
  }};
}

test('old protocol7 cannot enter rooms whose random loot can contain miniguns',async t=>{
  const server=await startServer({port:0});t.after(()=>server.close());const client=await peer(t,server.port);
  client.send({type:'create',protocol:7,name:'Old copy',weaponId:'m4a1'});
  const reply=await client.next();
  assert.equal(reply.type,'error');assert.match(reply.message,/Update required/);
  assert.equal((await (await fetch(`http://127.0.0.1:${server.port}/health`)).json()).rooms,0);
});

test('protocol8 peers receive validated minigun loadout, loot, finite ammo and shared shots',async t=>{
  const server=await startServer({port:0});t.after(()=>server.close());
  const host=await peer(t,server.port),guest=await peer(t,server.port);
  host.send({type:'create',protocol:8,name:'Mini host',weaponId:'minigun'});
  const welcome=await host.next(p=>p.type==='welcome'||p.type==='error');assert.equal(welcome.type,'welcome');
  guest.send({type:'join',protocol:8,name:'Mini guest',code:welcome.room.code,weaponId:'m4a1'});
  const joined=await guest.next(p=>p.type==='welcome'||p.type==='error');assert.equal(joined.type,'welcome');
  host.send({type:'start'});
  const playing=await host.next(p=>p.type==='state'&&p.room.phase==='playing');
  const own=playing.room.players.find(p=>p.id===welcome.id);
  assert.deepEqual([own.weaponId,own.ammo,own.reserve],['minigun',200,300]);
  assert.equal(validEquipmentSnapshot(playing.equipment,own),true);
  assert.equal(validGearWorld(playing.room.gear),true);
  assert.ok(playing.room.gear.loot.some(item=>item.item.weaponId==='minigun'));
  host.send({type:'input',lifeId:own.lifeId,x:0,y:0,yaw:0,pitch:.8,fire:true});
  const seen=await guest.next(p=>p.type==='state'&&p.room.players.find(player=>player.id===welcome.id)?.ammo<=195);
  const remote=seen.room.players.find(p=>p.id===welcome.id);
  assert.equal(remote.weaponId,'minigun');assert.equal(remote.reserve,300);assert.ok(remote.ammo>0);
  assert.ok(seen.room.events.some(e=>e.type==='shot'&&e.playerId===welcome.id));
  host.send({type:'input',lifeId:own.lifeId,x:0,y:0,yaw:0,pitch:.8,fire:false});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startServer } from '../server/server.mjs';

async function connect(port) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const queue=[]; const pending=[];
  socket.on('message',data=>{const packet=JSON.parse(data); const waiter=pending.find(item=>item.predicate(packet)); if(waiter){pending.splice(pending.indexOf(waiter),1);clearTimeout(waiter.timer);waiter.resolve(packet);}else queue.push(packet);});
  await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
  return {socket,send:packet=>socket.send(JSON.stringify(packet)),next(predicate=()=>true){
    const index=queue.findIndex(predicate);if(index!==-1)return Promise.resolve(queue.splice(index,1)[0]);
    return new Promise((resolve,reject)=>{const item={predicate,resolve};item.timer=setTimeout(()=>{pending.splice(pending.indexOf(item),1);reject(new Error('WebSocket packet timeout'));},3000);pending.push(item);});
  }};
}

test('two independent sockets create, join, start, move and transfer host', async t => {
  const server=await startServer({port:0}); t.after(()=>server.close());
  const a=await connect(server.port), b=await connect(server.port);
  t.after(()=>{a.socket.terminate();b.socket.terminate();});
  a.send({type:'create',name:'A',weaponId:'m4a1'});
  const welcome=await a.next(p=>p.type==='welcome');
  b.send({type:'join',code:welcome.room.code,name:'B',weaponId:'g17'});
  const joined=await b.next(p=>p.type==='welcome');
  assert.notEqual(welcome.id,joined.id); assert.equal(joined.room.players.length,2);
  b.send({type:'start'}); assert.match((await b.next(p=>p.type==='error')).message,/host/i);
  a.send({type:'start'});
  const playing=await b.next(p=>p.type==='state'&&p.room.phase==='playing');
  const old=playing.room.players.find(p=>p.id===welcome.id).z;
  a.send({type:'input',x:0,y:1,yaw:0,pitch:0,fire:false});
  const moved=await b.next(p=>p.type==='state'&&p.room.players.find(p=>p.id===welcome.id)?.z<old);
  assert.ok(moved.room.timeLeft<180);
  a.send({type:'leave'});
  const left=await b.next(p=>p.type==='state'&&p.room.players.length===1);
  assert.equal(left.room.hostId,joined.id);
  b.send({type:'ping',at:123});assert.equal((await b.next(p=>p.type==='pong')).at,123);
});

test('HTTP allowlist and malformed WebSocket messages fail safely', async t => {
  const server=await startServer({port:0});t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.port}`;
  assert.equal((await fetch(`${base}/health`)).status,200);
  assert.equal((await fetch(`${base}/?room=ABC123`)).status,200);
  assert.equal((await fetch(`${base}/package.json`)).status,404);
  assert.equal((await fetch(`${base}/%2e%2e/server/rooms.js`)).status,404);
  const client=await connect(server.port);t.after(()=>client.socket.terminate());
  client.socket.send('{bad JSON');assert.match((await client.next(p=>p.type==='error')).message,/json/i);
  client.send({type:'create',name:'A',weaponId:'fake'});assert.match((await client.next(p=>p.type==='error')).message,/weapon/i);
  client.send({type:'create',name:'A',weaponId:'g17'});assert.equal((await client.next(p=>p.type==='welcome')).room.phase,'lobby');
});

test('server closes oversized messages and connections exceeding 100 packets a second', async t => {
  const server=await startServer({port:0});t.after(()=>server.close());
  const oversized=await connect(server.port);
  const tooLarge=new Promise(resolve=>oversized.socket.once('close',resolve));
  oversized.socket.send('x'.repeat(4097));assert.equal(await tooLarge,1009);
  const flooded=await connect(server.port);
  const limited=new Promise(resolve=>flooded.socket.once('close',resolve));
  for(let i=0;i<110;i++)flooded.send({type:'ping',at:i});
  assert.equal(await limited,1008);
});

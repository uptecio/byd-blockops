import test from 'node:test';
import { PROTOCOL_VERSION } from '../src/protocol.js';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startServer } from '../server/server.mjs';
import { validEquipmentSnapshot, validGearWorld } from '../src/gear-protocol.js';
import { RoomManager } from '../server/rooms.js';

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
  a.send({type:'create',protocol: PROTOCOL_VERSION,name:'A',weaponId:'m4a1'});
  const welcome=await a.next(p=>p.type==='welcome');
  b.send({type:'join',protocol: PROTOCOL_VERSION,code:welcome.room.code,name:'B',weaponId:'g17'});
  const joined=await b.next(p=>p.type==='welcome');
  assert.notEqual(welcome.id,joined.id); assert.equal(joined.room.players.length,2);
  b.send({type:'start'}); assert.match((await b.next(p=>p.type==='error')).message,/host/i);
  a.send({type:'start'});
  const playing=await b.next(p=>p.type==='state'&&p.room.phase==='playing');
  const old=playing.room.players.find(p=>p.id===welcome.id).z;
  a.send({type:'input',lifeId:playing.room.players.find(p=>p.id===welcome.id).lifeId,x:0,y:1,yaw:0,pitch:0,fire:false});
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
  client.send({type:'create',protocol: PROTOCOL_VERSION,name:'A',weaponId:'fake'});assert.match((await client.next(p=>p.type==='error')).message,/weapon/i);
  client.send({type:'create',protocol: PROTOCOL_VERSION,name:'A',weaponId:'g17'});assert.equal((await client.next(p=>p.type==='welcome')).room.phase,'lobby');
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

test('initial protocol must be exactly version 8 and rejected settings leave the connection unjoined', async t => {
  const server = await startServer({ port: 0 }); t.after(() => server.close());
  const client = await connect(server.port); t.after(() => client.socket.terminate());
  for (const protocol of [undefined, 1, 2, 3, 4, 5, 6, 7, 9, '8', null]) {
    client.send({ type: 'create', protocol, name: 'A', weaponId: 'g17' });
    assert.equal((await client.next(p => p.type === 'error')).message, 'Update required: install the latest Block Ops APK or reload the game.');
  }
  for (const settings of [{ mapId: 'bad' }, { modeId: 'bad' }, { skinId: 'bad' }]) {
    client.send({ type: 'create', protocol: PROTOCOL_VERSION, name: 'A', weaponId: 'g17', ...settings });
    assert.match((await client.next(p => p.type === 'error')).message, /Unknown/);
  }
  assert.equal((await (await fetch(`http://127.0.0.1:${server.port}/health`)).json()).rooms, 0);
  client.send({ type: 'create', protocol: PROTOCOL_VERSION, name: 'A', weaponId: 'g17', mapId: 'harbor', modeId: 'tdm', skinId: 'space-guard' });
  const welcome = await client.next(p => p.type === 'welcome');
  assert.equal(welcome.protocol, PROTOCOL_VERSION); assert.equal(welcome.room.mapId, 'harbor'); assert.equal(welcome.room.modeId, 'tdm');
  assert.equal(welcome.room.players[0].skinId, 'space-guard');
  assert.equal((await client.next(p => p.type === 'state')).protocol, PROTOCOL_VERSION);
});

for (const transition of ['start','configure']) test(`final receipt precedes immediate ${transition} between simulation broadcasts`, async t => {
  // Control only simulation intervals, not the real WebSocket transport or scoring.
  t.mock.timers.enable({apis:['setInterval']});
  let manager,room;
  const originalStart=RoomManager.prototype.start;
  t.mock.method(RoomManager.prototype,'start',function(id){manager=this;room=originalStart.call(this,id);return room;});
  const server=await startServer({port:0});t.after(()=>server.close());
  const a=await connect(server.port),b=await connect(server.port);t.after(()=>{a.socket.terminate();b.socket.terminate();});
  a.send({type:'create',protocol:PROTOCOL_VERSION,name:'A',finishId:'gold'});const welcome=await a.next(p=>p.type==='welcome');
  assert.equal(welcome.progression,null);assert.equal(welcome.room.roundId,null);assert.equal(welcome.room.players[0].finishId,'gold');
  b.send({type:'join',protocol:PROTOCOL_VERSION,code:welcome.room.code,name:'B'});const joined=await b.next(p=>p.type==='welcome');
  a.send({type:'start'});await a.next(p=>p.type==='state'&&p.room.phase==='playing');
  manager.eliminate(room,welcome.id,room.players.get(joined.id));
  room.modeState.timeLeft=1/30;const roundId=room.roundId;
  t.mock.timers.tick(34);assert.equal(room.phase,'ended'); // odd tick: no periodic broadcast yet
  const packets=[];a.socket.on('message',data=>{const p=JSON.parse(data);if(p.type==='state')packets.push(p);});
  a.send(transition==='start'?{type:'start'}:{type:'configure',mapId:'harbor',modeId:'tdm'});
  const fresh=await a.next(p=>p.type==='state'&&p.room.roundId!==roundId
    && (transition==='start'?p.room.phase==='playing':p.room.mapId==='harbor'&&p.room.phase==='lobby'));
  assert.equal(packets[0].room.phase,'ended');assert.equal(packets[0].room.roundId,roundId);
  assert.equal(packets[0].progression.playerId,welcome.id);assert.equal(packets[0].progression.tally.earnedTotal,85);
  assert.equal(fresh.progression?.tally.earnedTotal??0,0);assert.equal(fresh.room.phase,transition==='start'?'playing':'lobby');
  const other=await b.next(p=>p.type==='state'&&p.room.roundId===roundId&&p.room.phase==='ended');
  assert.equal(other.progression.playerId,joined.id);assert.equal(other.progression.tally.earnedTotal,0);
});

test('finish messages accept only exact known appearance records without altering held inventory',async t=>{
  const server=await startServer({port:0});t.after(()=>server.close());const client=await connect(server.port);t.after(()=>client.socket.terminate());
  client.send({type:'create',protocol:PROTOCOL_VERSION,name:'A'});const welcome=await client.next(p=>p.type==='welcome');
  for(const packet of [{type:'finish'},{type:'finish',finishId:'bad'},{type:'finish',finishId:'gold',xp:8400},{type:'skin',skinId:'ranger',extra:1}]) {
    client.send(packet);assert.match((await client.next(p=>p.type==='error')).message,/Unknown|Invalid/);
  }
  client.send({type:'finish',finishId:'crimson-red'});const updated=await client.next(p=>p.type==='state'&&p.room.players[0].finishId==='crimson-red');
  assert.deepEqual(updated.equipment,welcome.equipment);assert.equal(updated.progression,null);
});

test('socket configuration, skin settings and duplicate/stale input remain authoritative while paused clients share time', async t => {
  const server = await startServer({ port: 0 }); t.after(() => server.close());
  const a = await connect(server.port), b = await connect(server.port); t.after(() => { a.socket.terminate(); b.socket.terminate(); });
  a.send({ type: 'create', protocol: PROTOCOL_VERSION, name: 'A', weaponId: 'g17', mapId: 'courtyard', modeId: 'tdm', skinId: 'desert-ops' });
  const welcome = await a.next(p => p.type === 'welcome');
  b.send({ type: 'join', protocol: 1, code: welcome.room.code, name: 'B', weaponId: 'g17' });
  assert.match((await b.next(p => p.type === 'error')).message, /Update required/);
  b.send({ type: 'join', protocol: PROTOCOL_VERSION, code: welcome.room.code, name: 'B', weaponId: 'g17', skinId: 'neon-runner' });
  const joined = await b.next(p => p.type === 'welcome'); assert.equal(joined.room.players.find(p => p.id === joined.id).skinId, 'neon-runner');
  b.send({ type: 'configure', mapId: 'harbor', modeId: 'ctf' }); assert.match((await b.next(p => p.type === 'error')).message, /host/);
  a.send({ type: 'configure', mapId: 'neon-city', modeId: 'tdm' });
  await b.next(p => p.type === 'state' && p.room.mapId === 'neon-city');
  a.send({ type: 'start' }); await b.next(p => p.type === 'state' && p.room.phase === 'playing');
  a.send({ type: 'configure', mapId: 'harbor', modeId: 'ctf' }); assert.match((await a.next(p => p.type === 'error')).message, /progress|round/);
  a.send({ type: 'skin', skinId: 'shadow-ninja' });
  const pending = await b.next(p => p.type === 'state' && p.room.players.find(p => p.id === welcome.id)?.pendingSkinId === 'shadow-ninja');
  assert.equal(pending.room.players.find(p => p.id === welcome.id).skinId, 'desert-ops');
  const start = pending.room.players.find(p => p.id === welcome.id);
  for (let i = 0; i < 8; i++) a.send({ type: 'input', lifeId: start.lifeId, x: 1, y: 0, yaw: 0, pitch: 0, firePressed: true, kills: 900, health: 900, teamScores: { red: 999 } });
  const fired = await b.next(p => p.type === 'state' && p.room.players.find(p => p.id === welcome.id)?.ammo === 16);
  assert.equal(fired.room.players.find(p => p.id === welcome.id).kills, 0); assert.equal(fired.room.teamScores.red, 0);
  const expired = await b.next(p => p.type === 'state' && p.room.timeLeft < pending.room.timeLeft - 0.6);
  const stopped = expired.room.players.find(p => p.id === welcome.id);
  assert.equal(stopped.ammo, 16); assert.ok(stopped.x > start.x); assert.ok(stopped.x - start.x < 2);
  const later = await b.next(p => p.type === 'state' && p.room.timeLeft < expired.room.timeLeft - 0.3);
  assert.equal(later.room.players.find(p => p.id === welcome.id).x, stopped.x);
});

// Drive the real simulation through public controls; no server internals or test-only hooks.
async function moveTo(client, id, x, z) {
  let state = await client.next(p => p.type === 'state' && p.room.phase === 'playing');
  for (let steps = 0; steps < 200; steps++) {
    const player = state.room.players.find(p => p.id === id);
    const dx = x - player.x, dz = z - player.z, length = Math.hypot(dx, dz);
    if (length < 0.4) { client.send({ type: 'input', lifeId: player.lifeId, x: 0, y: 0, yaw: 0, pitch: 0 }); return state; }
    client.send({ type: 'input', x: dx / length, y: -dz / length, yaw: 0, pitch: 0, lifeId: player.lifeId });
    state = await client.next(p => p.type === 'state' && p.room.timeLeft < state.room.timeLeft);
  }
  throw new Error('Player did not reach flag waypoint');
}

test('real socket late joins see current scores and flags, then carrier disconnect drops and transfers host', async t => {
  const server = await startServer({ port: 0 }); t.after(() => server.close());
  const a = await connect(server.port), b = await connect(server.port), c = await connect(server.port);
  t.after(() => { a.socket.terminate(); b.socket.terminate(); c.socket.terminate(); });
  a.send({ type: 'create', protocol: PROTOCOL_VERSION, name: 'A', weaponId: 'g17', mapId: 'courtyard', modeId: 'ctf' });
  const welcome = await a.next(p => p.type === 'welcome');
  b.send({ type: 'join', protocol: PROTOCOL_VERSION, code: welcome.room.code, name: 'B', weaponId: 'g17' });
  const joined = await b.next(p => p.type === 'welcome');
  a.send({ type: 'start' }); await a.next(p => p.type === 'state' && p.room.phase === 'playing');
  await moveTo(a, welcome.id, 0, 19); await moveTo(a, welcome.id, 0, -18);
  await a.next(p => p.type === 'state' && p.room.flags.blue.carrierId === welcome.id);
  await moveTo(a, welcome.id, 0, 18);
  await a.next(p => p.type === 'state' && p.room.teamScores.red === 1);
  await moveTo(a, welcome.id, 0, -18);
  await a.next(p => p.type === 'state' && p.room.flags.blue.carrierId === welcome.id);
  c.send({ type: 'join', protocol: PROTOCOL_VERSION, code: welcome.room.code, name: 'C', weaponId: 'g17', skinId: 'arctic-scout' });
  const late = await c.next(p => p.type === 'welcome');
  assert.equal(late.room.teamScores.red, 1); assert.equal(late.room.flags.blue.carrierId, welcome.id);
  assert.equal(late.room.players.find(p => p.id === late.id).teamId, 'red');
  a.socket.close();
  const left = await c.next(p => p.type === 'state' && p.room.players.length === 2);
  assert.equal(left.room.hostId, joined.id); assert.equal(left.room.flags.blue.status, 'dropped');
  assert.equal(left.room.flags.blue.carrierId, null); assert.ok(left.room.flags.blue.returnRemaining > 14);
  assert.ok(left.room.events.some(event => event.type === 'flag-drop' && event.teamId === 'blue' && event.playerId === welcome.id));
});

test('real socket fire cannot damage a teammate', async t => {
  const server = await startServer({ port: 0 }); t.after(() => server.close());
  const a = await connect(server.port), b = await connect(server.port), c = await connect(server.port);
  t.after(() => { a.socket.terminate(); b.socket.terminate(); c.socket.terminate(); });
  a.send({ type: 'create', protocol: PROTOCOL_VERSION, name: 'A', weaponId: 'awp', modeId: 'tdm' });
  const welcome = await a.next(p => p.type === 'welcome');
  b.send({ type: 'join', protocol: PROTOCOL_VERSION, code: welcome.room.code, name: 'B', weaponId: 'g17' }); await b.next(p => p.type === 'welcome');
  c.send({ type: 'join', protocol: PROTOCOL_VERSION, code: welcome.room.code, name: 'C', weaponId: 'g17' }); const teammate = await c.next(p => p.type === 'welcome');
  a.send({ type: 'start' });
  const ready = await a.next(p => p.type === 'state' && p.room.phase === 'playing' && p.room.timeLeft < 177.9);
  const shooter = ready.room.players.find(p => p.id === welcome.id), target = ready.room.players.find(p => p.id === teammate.id);
  const yaw = Math.atan2(shooter.x - target.x, shooter.z - target.z);
  a.send({ type: 'input', x: 0, y: 0, yaw, pitch: 0, lifeId: shooter.lifeId, firePressed: true });
  const shot = await a.next(p => p.type === 'state' && p.room.events.some(event => event.type === 'shot'));
  assert.equal(shot.room.players.find(p => p.id === teammate.id).health, 100);
  assert.deepEqual(shot.room.teamScores, { red: 0, blue: 0 });
});

test('real sockets share one pickup event batch and receive only their own equipment', async t => {
  const server = await startServer({ port: 0 }); t.after(() => server.close());
  const a = await connect(server.port), b = await connect(server.port);
  t.after(() => { a.socket.terminate(); b.socket.terminate(); });
  a.send({ type: 'create', protocol: PROTOCOL_VERSION, name: 'A', weaponId: 'ak47' }); const wa = await a.next(p => p.type === 'welcome');
  b.send({ type: 'join', protocol: PROTOCOL_VERSION, code: wa.room.code, name: 'B', weaponId: 'g17' }); const wb = await b.next(p => p.type === 'welcome');
  assert.equal(wa.equipment.playerId, wa.id); assert.equal(wb.equipment.playerId, wb.id);
  assert.deepEqual(wb.equipment.equipment.owned.map(g => g.weaponId), ['g17']);
  assert.ok(wb.room.players.every(p => p.equipment === undefined && p.inventory === undefined));
  a.send({ type: 'equip', weaponId: 'mp5' }); assert.match((await a.next(p => p.type === 'error')).message, /Unknown message/);
  a.send({ type: 'start' }); const started = await a.next(p => p.type === 'state' && p.room.phase === 'playing');
  a.send({ type: 'loadout', weaponId: 'mp5' }); assert.match((await a.next(p => p.type === 'error')).message, /active round/);
  const packet = { type: 'equipment-action', seq: 1, lifeId: started.equipment.lifeId, kind: 'equip-gun', weaponId: 'mp5', source: 'armory' };
  a.send(packet); const equipped = await a.next(p => p.type === 'state' && p.equipment.equipment.activeGunId === 'mp5');
  a.send(packet); assert.match((await a.next(p => p.type === 'error')).message, /Repeated/);
  a.send({ ...packet, seq: 2, weaponId: 'ak47' }); assert.equal((await a.next(p => p.type === 'error')).message, 'Find this gun as loot');
  assert.equal(equipped.equipment.lastActionSeq, 1);
  await moveTo(a, wa.id, 0, 0);
  const pickup = a.next(p => p.type === 'state' && p.room.events.some(e => e.type === 'pickup' && e.item.kind === 'knife' && e.playerId === wa.id));
  await moveTo(a, wa.id, -3, 0); const pa = await pickup;
  const knifeEvent = pa.room.events.find(e => e.type === 'pickup' && e.item.kind === 'knife');
  const pb = await b.next(p => p.type === 'state' && p.room.events.some(e => e.id === knifeEvent.id));
  assert.deepEqual(pa.room, pb.room); assert.equal(pa.equipment.equipment.knife, true); assert.equal(pb.equipment.equipment.knife, false);
  assert.equal(validEquipmentSnapshot(pa.equipment, pa.room.players.find(p => p.id === wa.id)), true);
  assert.equal(validEquipmentSnapshot(pb.equipment, pb.room.players.find(p => p.id === wb.id)), true);
  assert.equal(validGearWorld(pa.room.gear), true);
  await moveTo(b, wb.id, 0, 0); const second = await moveTo(b, wb.id, -3, 0);
  assert.equal(second.equipment.equipment.knife, false);
});

test('real socket late joins reassign full gun slots for the newcomer original gun', async t => {
  const server = await startServer({ port: 0 }); t.after(() => server.close());
  const a = await connect(server.port), b = await connect(server.port), c = await connect(server.port);
  t.after(() => { a.socket.terminate(); b.socket.terminate(); c.socket.terminate(); });
  a.send({ type: 'create', protocol: PROTOCOL_VERSION, name: 'A', weaponId: 'ak47' }); const wa = await a.next(p => p.type === 'welcome');
  b.send({ type: 'join', protocol: PROTOCOL_VERSION, code: wa.room.code, name: 'B', weaponId: 'g17' }); await b.next(p => p.type === 'welcome');
  a.send({ type: 'start' }); const state = await a.next(p => p.type === 'state' && p.room.phase === 'playing');
  const available = new Set(state.room.gear.loot.filter(l => l.item.kind === 'gun').map(l => l.item.weaponId));
  const newGun = ['awp', 'm4a1', 'mp5', 'scar', 'p90', 'famas', 'm249', 'scout', 'vector'].find(g => !available.has(g));
  assert.ok(newGun);
  c.send({ type: 'join', protocol: PROTOCOL_VERSION, code: wa.room.code, name: 'Late', weaponId: newGun }); const late = await c.next(p => p.type === 'welcome');
  assert.ok(late.room.gear.loot.some(l => l.item.weaponId === newGun));
  assert.ok(late.room.gear.loot.some(l => l.item.weaponId === 'ak47'));
  assert.ok(late.room.gear.loot.some(l => l.item.weaponId === 'g17'));
  assert.equal(late.equipment.equipment.startingGunId, newGun);
  assert.equal(validGearWorld(late.room.gear), true);
});

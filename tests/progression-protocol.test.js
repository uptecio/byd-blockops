import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/rooms.js';
import { RoomClient } from '../src/network.js';
import { PROTOCOL_VERSION } from '../src/protocol.js';
import * as progressionProtocol from '../src/progression-protocol.js';
import { emptyTally, awardTally, finishTally } from '../src/progression.js';
import { OnlineArena } from '../src/online-game.js';
import { createHeadlessGame,cleanupGame } from './helpers/game-fixture.js';

function fixture(modeId='ffa') {
  const manager=new RoomManager(),room=manager.create('a','A','m4a1',{modeId});manager.join('b',room.code,'B');
  const packet=()=>({type:'state',protocol:PROTOCOL_VERSION,room:manager.snapshot(room,false),equipment:manager.equipmentSnapshot('a'),progression:manager.progressionSnapshot('a')});
  return {manager,room,packet};
}
test('private progression validates exact recipient round phase mode weighted totals and real winner',()=>{
  assert.equal(PROTOCOL_VERSION,7);
  for(const modeId of ['ffa','tdm','ctf']) {
    const {manager,room,packet}=fixture(modeId);
    const valid=v=>progressionProtocol.validProgressionReceipt(v,manager.snapshot(room,false),'a');
    assert.equal(valid(null),true);assert.equal(valid({}),false);manager.start('a');
    const receipt=packet().progression; assert.equal(valid(receipt),true);assert.equal(valid(null),false);
    for(const mutate of [
      r=>{r.playerId='b';},r=>{r.roundId='old-round';},r=>{r.modeId='zombies';},r=>{r.extra=1;},
      r=>{r.tally.extra=1;},r=>{r.tally.earnedTotal=10;},r=>{r.tally.eliminations=Infinity;},
      r=>{r.tally.eliminations=2147483648;r.tally.earnedTotal=2147483647;},
      r=>{r.tally.zombieKills=1;r.tally.earnedTotal=2;},
      r=>{r.tally=finishTally(awardTally(emptyTally(),modeId,'eliminations'),{modeId,naturalEnd:true,won:true});},
    ]) {const bad=structuredClone(receipt);mutate(bad);assert.equal(valid(bad),false);}
    assert.equal(valid(Object.create(receipt)),false);
    const inherited=structuredClone(receipt);inherited.tally=Object.create(inherited.tally);assert.equal(valid(inherited),false);
    const proto=structuredClone(receipt);Object.setPrototypeOf(proto,{injected:true});assert.equal(valid(proto),false);
    manager.eliminate(room,'b',room.players.get('a'));manager.tick(180);
    const forged=packet().progression;forged.tally=finishTally(awardTally(emptyTally(),modeId,'eliminations'),{modeId,naturalEnd:true,won:true});
    assert.equal(valid(forged),false);assert.equal(valid(packet().progression),true);
  }
});
class Socket extends EventTarget {
  constructor(){super();this.readyState=1;Socket.last=this;this.sent=[];}
  send(value){this.sent.push(JSON.parse(value));}
  close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
  message(packet){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(packet)}));}
}
test('RoomClient atomically rejects invalid receipts/appearance and retains trusted origin across menu-time packets',async t=>{
  const original=globalThis.WebSocket;globalThis.WebSocket=Socket;t.after(()=>{globalThis.WebSocket=original;});
  const {manager,room,packet}=fixture();manager.start('a');const errors=[],seen=[];
  const client=new RoomClient({onError:e=>errors.push(e),onRoom:r=>seen.push(r)});t.after(()=>client.close());
  const pending=client.connect('https://play.example.com/path',{type:'create',finishId:'gold'}),socket=Socket.last;
  socket.dispatchEvent(new Event('open'));socket.message({...packet(),type:'welcome',id:'a'});await pending;
  assert.equal(client.serverOrigin,'https://play.example.com');assert.throws(()=>{client.serverOrigin='https://wrong.example';},TypeError);
  assert.equal(socket.sent[0].finishId,'gold');const previous=client.room;
  for(const mutate of [p=>{delete p.progression;},p=>{p.progression.playerId='b';},p=>{p.progression.tally.earnedTotal=10;},
    p=>{p.room.players[0].finishId='bad';},p=>{p.room.players[0].pendingFinishId={};},p=>{p.room.roundId=null;},p=>{p.extra=1;}]) {
    const bad=packet();mutate(bad);const count=errors.length;socket.message(bad);assert.equal(errors.length,count+1);assert.equal(client.room,previous);
  }
  manager.eliminate(room,'a',room.players.get('b'));const awarded=packet();socket.message(awarded);
  assert.equal(client.room.selfProgression.tally.earnedTotal,10);socket.message(awarded);assert.equal(client.room.selfProgression.tally.earnedTotal,10);
  manager.tick(180);socket.message(packet());assert.equal(client.room.selfProgression.tally.earnedTotal,85);
  const final=packet(),roundId=client.room.roundId;manager.start('a');socket.message(packet());
  assert.notEqual(client.room.roundId,roundId);assert.equal(client.room.selfProgression.tally.earnedTotal,0);
  const rematch=client.room;socket.message(final);assert.equal(client.room,rematch,'stale old life cannot replace a new round');
  assert.ok(seen.length>=4);
});

test('online adapter replicates current and pending finishes without applying the pending look early',t=>{
  const {manager,room,packet}=fixture();manager.start('a');
  const game=createHeadlessGame();t.after(()=>cleanupGame(game));const online=new OnlineArena(game,{send:()=>true});t.after(()=>online.stop());
  const snapshot=()=>{const p=packet();return {...p.room,selfEquipment:p.equipment,selfProgression:p.progression};};
  online.start(snapshot(),'a',{});const model=online.remotes.get('b').model;
  manager.setFinish('a','crimson-red');manager.setFinish('b','gold');online.pause();online.sync(snapshot());
  assert.equal(game.player.finishId,'standard');assert.equal(game.player.pendingFinishId,'crimson-red');assert.equal(online.remotes.get('b').model,model);
  manager.eliminate(room,'b',room.players.get('a'));manager.spawn(room,room.players.get('a'));
  manager.eliminate(room,'a',room.players.get('b'));manager.spawn(room,room.players.get('b'));online.sync(snapshot());
  assert.equal(game.player.finishId,'crimson-red');assert.equal(game.presentedFinishId,'crimson-red');
  assert.notEqual(online.remotes.get('b').model,model);assert.equal(online.remotes.get('b').model.userData.finishId,'gold');
});

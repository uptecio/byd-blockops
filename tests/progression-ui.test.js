import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProfileStore, PROFILE_KEY } from '../src/profile-store.js';
import { createProgressionSession } from '../src/progression-session.js';
import { emptyTally, awardTally, finishTally, MAX_XP } from '../src/progression.js';
import { createProgressionUI } from '../src/progression-ui.js';
import { createProgressionController } from '../src/progression-controller.js';
import { createInventoryDOM } from './helpers/inventory-dom-fixture.js';
import { RoomManager } from '../server/rooms.js';
import { MultiplayerUI } from '../src/multiplayer-ui.js';

function storage() { const data=new Map();let writes=0;return {getItem:k=>data.get(k)??null,setItem(k,v){writes++;data.set(k,v);},get writes(){return writes;}}; }
function fixture(t) {
  const dom=createInventoryDOM(t),disk=storage(),store=createProfileStore({getStorage:()=>disk}),session=createProgressionSession(store),notices=[];
  const controller=createProgressionController({store,session,onChange:()=>{},onDelta:d=>notices.push(d)});
  const ui=createProgressionUI({document:dom.document,onEquip:patch=>controller.equip(patch)});t.after(()=>ui.dispose());
  const $=id=>dom.document.getElementById(id),context={live:false,modeId:'ffa',currentSkinId:'ranger',currentFinishId:'standard'};
  return {...dom,disk,store,session,controller,ui,$,context,notices};
}
const soloKey=id=>JSON.stringify(['solo',id]);

test('Home and Armory show original free looks and exact level locks without auto-equipping',t=>{
  const {ui,store,$,context,send}=fixture(t);ui.render(store.view(),context);
  assert.equal($('skin-grid').children.length,16);assert.equal($('finish-grid').children.length,9);
  assert.equal($('skin-grid').children.filter(b=>!b.disabled).length,8);
  assert.equal($('finish-grid').children.filter(b=>!b.disabled).length,1);
  const locked=$('skin-grid').children.find(b=>b.dataset.skin==='crimson-ninja');
  assert.equal(locked.getAttribute('aria-disabled'),'true');assert.match(locked.textContent,/Level 2/);
  send(locked,'click');assert.equal(store.view().skinId,'ranger');
  $('armory-skin').value='crimson-ninja';send($('armory-skin'),'change');assert.equal(store.view().skinId,'ranger');
  assert.equal($('room-skin').children.find(o=>o.value==='crimson-ninja').disabled,true);
  const delta=store.credit(soloKey('earned'),350);ui.render(store.view(),context);ui.notify(delta,store.view());
  assert.equal(store.view().skinId,'ranger');assert.equal(store.view().finishId,'standard');
  assert.equal(locked.disabled,false);send(locked,'click');assert.equal(store.view().skinId,'crimson-ninja');
  const finish=$('finish-grid').children.find(b=>b.dataset.finish==='crimson-red');send(finish,'click');assert.equal(store.view().finishId,'crimson-red');
  assert.equal(store.equip({finishId:'gold'}).ok,false);
  assert.match($('home-progression').textContent,/Level 3/);assert.match($('home-progression').textContent,/Midnight Ops/);
});

test('appearance timing follows live mode and displays current look separately from saved desired choice',t=>{
  const {ui,store,$,context}=fixture(t);store.credit(soloKey('earned'),350);store.equip({skinId:'crimson-ninja',finishId:'crimson-red'});
  ui.render(store.view(),{...context,live:true});assert.match($('appearance-timing').textContent,/Next respawn/);
  assert.match($('appearance-timing').textContent,/Ranger/);assert.match($('appearance-timing').textContent,/Crimson Ninja/);
  ui.render(store.view(),{...context,live:true,modeId:'zombies'});assert.match($('appearance-timing').textContent,/Next run/);
  ui.render(store.view(),context);assert.match($('appearance-timing').textContent,/Equipped/);
  assert.equal($('armory-skin').value,'crimson-ninja');assert.equal($('room-skin').value,'crimson-ninja');
});

test('results are read-only breakdowns and max rank formats bounded lifetime XP',t=>{
  const {ui,store,session,$,context,disk}=fixture(t);const key=soloKey('round');session.begin(key,'ffa');
  session.accept(key,finishTally(awardTally(emptyTally(),'ffa','eliminations',15),{modeId:'ffa',naturalEnd:true,won:true}));
  const before=disk.writes;ui.renderResults(session.summary(),store.view());ui.renderResults(session.summary(),store.view());
  assert.equal(disk.writes,before);assert.match($('results-progression').textContent,/225 XP/);
  for(const label of ['150','50','25','Crimson Ninja'])assert.ok($('results-progression').textContent.includes(label));
  store.credit(soloKey('max-layout'),MAX_XP);ui.render(store.view(),context);
  assert.match($('home-progression').textContent,/Level 17/);assert.match($('home-progression').textContent,/All rewards unlocked/);
  assert.match($('home-progression').textContent,/2,147,483,647/);
});

test('XP and crossed unlock notices coalesce without intercepting input and dispose removes queued work',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const {ui,store,$}=fixture(t);
  const first=store.credit(soloKey('one'),150);ui.notify(first,store.view());const next=store.credit(soloKey('two'),200);ui.notify(next,store.view());
  ui.notify({creditedXP:0,newRewards:[],saved:true},store.view());t.mock.timers.tick(300);
  assert.match($('progression-toast').textContent,/350 XP/);
  assert.match($('progression-toast').textContent,/Crimson Ninja/);assert.match($('progression-toast').textContent,/Crimson Red/);
  assert.equal($('progression-toast').style.pointerEvents,'none');
  t.mock.timers.tick(4000);assert.equal($('progression-toast').textContent,'');
  ui.notify({creditedXP:10,newRewards:[],saved:true},store.view());ui.dispose();t.mock.timers.tick(5000);assert.equal($('progression-toast').textContent,'');
});

test('denied storage stays playable, warns honestly and announces a later successful retry',t=>{
  const {document,$,ui,context}=fixture(t);let denied=true;const disk=storage();
  const store=createProfileStore({getStorage(){if(denied)throw Error('Denied');return disk;}}),session=createProgressionSession(store);
  const controller=createProgressionController({store,session,onChange:profile=>ui.render(profile,context)});
  ui.render(store.view(),context);assert.equal($('progression-save-status').textContent,'Progress is not saved — storage unavailable');
  controller.solo({type:'start',key:soloKey('offline'),modeId:'ffa',tally:emptyTally()});
  controller.solo({type:'update',key:soloKey('offline'),modeId:'ffa',tally:awardTally(emptyTally(),'ffa','eliminations')});
  assert.equal(store.view().lifetimeXP,10);assert.equal($('progression-save-status').hidden,false);
  denied=false;controller.retry();assert.equal(store.view().saveStatus,'saved');assert.match($('progression-save-status').textContent,/Saved on this device/);
  assert.equal(JSON.parse(disk.getItem(PROFILE_KEY)).lifetimeXP,10);assert.equal(document.getElementById('armory-save-status').textContent,'Saved on this device');
});

test('authoritative old look cannot revert preference and accepted online totals survive menus/rematch/restart',t=>{
  const {controller,store,session,disk}=fixture(t);store.credit(soloKey('prior'),350);controller.equip({skinId:'crimson-ninja',finishId:'crimson-red'});
  const manager=new RoomManager(),room=manager.create('a','A');manager.join('b',room.code,'B');manager.start('a');
  const client={id:'a',connected:true,serverOrigin:'https://game.example',room:null};
  const accept=()=>{client.room={...manager.snapshot(room,false),selfProgression:manager.progressionSnapshot('a')};controller.room(client.room,client);};
  accept();manager.eliminate(room,'a',room.players.get('b'));accept();accept();
  assert.equal(store.view().lifetimeXP,360);assert.equal(client.room.players[0].skinId,'ranger');
  assert.equal(store.view().skinId,'crimson-ninja');assert.equal(store.view().finishId,'crimson-red');
  manager.tick(180);accept();assert.equal(store.view().lifetimeXP,435);assert.equal(session.summary().creditedXP,85);
  const stale=client.room;manager.start('a');accept();assert.equal(session.summary().creditedXP,0);
  controller.room(stale,client);assert.equal(store.view().lifetimeXP,435);
  controller.stop();client.connected=false;controller.room(client.room,client);assert.equal(store.view().lifetimeXP,435);
  const reopened=createProfileStore({getStorage:()=>disk});assert.equal(reopened.view().skinId,'crimson-ninja');assert.equal(reopened.view().finishId,'crimson-red');
});

test('solo stop/replay and online lobby deactivate earning without awarding exit bonuses',t=>{
  const {controller,store,session}=fixture(t),key=soloKey('first'),tally=awardTally(emptyTally(),'ffa','eliminations');
  controller.solo({type:'start',key,modeId:'ffa',tally:emptyTally()});controller.solo({type:'update',key,modeId:'ffa',tally});
  controller.solo({type:'stop',key,modeId:'ffa',tally});controller.solo({type:'update',key,modeId:'ffa',tally:awardTally(tally,'ffa','eliminations')});
  assert.equal(store.view().lifetimeXP,10);assert.equal(session.summary().tally.completed,false);
  const client={id:'a',connected:true,serverOrigin:'http://localhost:4180'},room={selfProgression:null,phase:'lobby',roundId:null};client.room=room;controller.room(room,client);
  assert.equal(store.view().lifetimeXP,10);
});

test('MultiplayerUI reconciles progression before arena/results callbacks and stops before disconnect teardown',t=>{
  const {document}=createInventoryDOM(t);document.body={dataset:{mode:'armory'}};
  const calls=[],room={code:'CODE',hostId:'b',mapId:'courtyard',modeId:'ffa',phase:'ended',roundId:'one',players:[],selfEquipment:{}};
  const ui=Object.create(MultiplayerUI.prototype);Object.assign(ui,{room:{...room,phase:'playing'},client:{id:'a',send(){},close(){calls.push('close');}},
    arena:{sync(){calls.push('sync');},stop(){calls.push('arena-stop');}},renderRoom(){calls.push('render');},onProgressionRoom(){calls.push('receipt');},
    showResults(){calls.push('results');},onProgressionStop(){calls.push('stop');},getGame:()=>({quit(){}})});
  ui.receive(room);assert.deepEqual(calls.slice(0,4),['receipt','render','sync','results']);ui.leave();assert.ok(calls.indexOf('stop')<calls.indexOf('close'));
});

test('main wiring keeps gameplay earning separate from results and appearance previews consume desired finish',()=>{
  const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8'),home=readFileSync(new URL('../src/home-ui.js',import.meta.url),'utf8');
  assert.match(main,/onProgression:\s*.*\.solo\(/);assert.match(main,/onProgressionRoom:/);assert.match(main,/onProgressionStop:/);assert.match(main,/onResults:/);
  assert.match(main,/setPendingAppearance\(/);assert.match(main,/finishId:\s*selection.finishId/);
  assert.doesNotMatch(home,/ALL SKINS UNLOCKED/);assert.match(home,/selection.finishId/);
  assert.equal(readFileSync(new URL('../src/match-ui.js',import.meta.url),'utf8').includes('credit('),false);
});

test('room selector rejects a locked injected choice and restores the saved desired value',t=>{
  const {controller,store,$,send}=fixture(t);
  const previous={location:globalThis.location,localStorage:globalThis.localStorage};
  globalThis.location={origin:'http://localhost:4180',hostname:'localhost',search:''};globalThis.localStorage={getItem:()=>null};
  t.after(()=>{for(const [key,value] of Object.entries(previous))if(value===undefined)delete globalThis[key];else globalThis[key]=value;});
  const ui=new MultiplayerUI({getSelection:()=>store.view(),onSkin:skinId=>controller.equip({skinId}),onHome(){},onLoadout(){}});
  t.after(()=>ui.client.close());
  $('room-skin').value='golden-ninja';send($('room-skin'),'change');
  assert.equal(store.view().skinId,'ranger');assert.equal($('room-skin').value,'ranger');
});

test('valid lobby receipt deactivates a prior session before later callbacks can award',t=>{
  const {controller,store,session}=fixture(t),manager=new RoomManager(),room=manager.create('a','A');manager.join('b',room.code,'B');manager.start('a');
  const client={id:'a',connected:true,serverOrigin:'https://game.example'};
  const accept=()=>{client.room={...manager.snapshot(room,false),selfProgression:manager.progressionSnapshot('a')};controller.room(client.room,client);};
  accept();manager.eliminate(room,'a',room.players.get('b'));accept();const key=session.summary().key;
  manager.tick(180);accept();manager.configure('a',{mapId:'courtyard',modeId:'ffa'});accept();
  const before=store.view().lifetimeXP;assert.equal(session.accept(key,awardTally(emptyTally(),'ffa','eliminations',14)).creditedXP,0);
  assert.equal(store.view().lifetimeXP,before);
});

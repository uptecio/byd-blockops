import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {MAPS} from '../../src/maps.js';
import {SIDES} from '../../src/map-traversal.js';
import {getWeapon} from '../../src/weapons.js';
import {humanMoveSpeed} from '../../src/character-movement.js';
import {nativeProgressionFixture} from './helpers/progression-native.js';
import {cleanupOwnedOnlineSession} from './online-cleanup.mjs';
import {observer,until} from '../../tests/helpers/loot-browser.js';
import {observeGame,followRoute,aimAt} from '../../tests/helpers/traversal-browser.js';
import {readProfile} from '../../tests/helpers/progression-browser.js';

const server=process.env.GAME_TEST_SERVER_URL,dir=process.env.ANDROID_TEST_ARTIFACTS;
assert.ok(server&&dir,'Explicit owned TLS staging and artifacts required');assert.equal(new URL(server).protocol,'https:');await mkdir(dir,{recursive:true});
const f=await nativeProgressionFixture({artifactDir:dir,serverOrigin:server});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1200,height:700},hasTouch:true}),peer=await context.newPage(),packets=[],errors=[];
peer.on('pageerror',e=>errors.push(e.message));peer.on('websocket',s=>s.on('framereceived',frame=>packets.push(JSON.parse(String(frame.payload)))));
const evidence={server,errors:[]},map=MAPS[0],spot=map.hideSpots[0];let page,peerView,nativeView,a,b,originalError,nativeId;
try {
  page=await f.attach();assert.deepEqual(await f.version(),{code:10,name:'0.8.0'});evidence.beforeProfile=await readProfile(page);
  await peer.goto(server);await peer.waitForSelector('body[data-mode="home"]');
  await peer.locator('#home-armory').click();await peer.locator('[data-class="sidearm"]').click();await peer.locator('[data-weapon="g17"]').click();await peer.locator('#armory-home').click();
  for(const [p,name]of [[peer,'Rooftop Browser'],[page,'Rooftop Android']]) {
    await p.locator('#home-online').click();await p.locator('#player-name').fill(name);
    await p.locator('.server-settings').evaluate(e=>{e.open=true;});await p.locator('#server-address').fill(server);
  }
  await peer.locator('#create-room').click();await peer.locator('#room-lobby:not([hidden])').waitFor();
  await peer.locator('#room-map').selectOption(map.id);await peer.locator('#room-mode').selectOption('ctf');
  const code=await peer.locator('#room-code').textContent();evidence.code=code;
  await page.locator('#room-code-input').fill(code);await page.locator('#join-room').click();
  await until(async()=>await peer.locator('#room-roster .roster-player').count()===2,'native and independent browser joined');
  await peer.locator('#start-online').click();await page.waitForSelector('body[data-mode="playing"]');
  const streams={packets:[f.packets,packets]};a=observer(streams,0);b=observer(streams,1);
  await until(()=>a.player&&b.player,'authoritative native snapshots');nativeId=a.id;
  assert.equal(a.player.teamId,'blue');nativeView=await observeGame(page);peerView=await observeGame(peer);
  const walk=(p,view,points)=>followRoute(p,async()=>({...view.player}),points,{map,online:true,speed:humanMoveSpeed(getWeapon(view.player.weaponId).classId),timeout:90000});
  await walk(page,a,[{...map.bases.red,y:0},map.traversal.roofs[0].point]);
  assert.equal(a.player.supportId,map.traversal.roofs[0].supportId);assert.equal(a.player.y,2.2);
  assert.equal(b.room.players.find(p=>p.id===nativeId).y,2.2,'independent peer receives native elevation');
  assert.equal(a.room.flags.red.carrierId,nativeId);await page.screenshot({path:`${dir}/native-roof-flag.png`});
  const center=map.traversal.shelters[0].point,out=SIDES[spot.facing],doorway={x:center.x+out.x*3,y:0,z:center.z+out.z*3};
  await walk(page,a,[{...doorway,direct:true},spot.entry]);await walk(peer,b,[spot.entry]);
  console.log(`NATIVE SETUP: ${a.room.timeLeft.toFixed(1)} seconds remain`);
  await page.locator('#hide-button').click();await until(()=>a.player.hiddenSpotId===spot.id,'native flag carrier hidden');
  await until(async()=>{const s=await peerView.read();return s.models.some(m=>!m.visible&&m.labelVisible===false)&&s.flags.red===false;},'browser sees concealed native avatar, label and flag');
  await page.screenshot({path:`${dir}/native-hidden.png`});await peer.screenshot({path:`${dir}/browser-native-concealed.png`});
  await aimAt(peer,async()=>b.player,Math.atan2(-(spot.occupant.x-b.player.x),-(spot.occupant.z-b.player.z)),0);
  const health=a.player.health;await peer.keyboard.press('KeyF',{delay:30});
  await until(()=>a.player.hiddenSpotId===null&&a.player.health<health,'browser body shot ejects native occupant');assert.equal(health-a.player.health,23);
  await page.locator('#hide-button').click();await until(()=>a.player.hiddenSpotId===spot.id,'native hides again before departure');
  // The red browser must leave pickup range, otherwise it legitimately
  // returns its own dropped flag on the same tick as native departure.
  await walk(peer,b,[doorway]);
  evidence.beforeDeparture=a.player;evidence.profile=await readProfile(page);
  await nativeView.close();nativeView=null;await f.close();
  await until(()=>!b.room.players.some(p=>p.id===nativeId)&&b.room.flags.red.status==='dropped','native process departure drops hidden flag');
  const flag=b.room.flags.red;assert.equal(flag.x,spot.exit.x);assert.equal(flag.y,0);assert.equal(flag.z,spot.exit.z);
  evidence.droppedFlag=flag;await peer.screenshot({path:`${dir}/browser-native-departed.png`});
  f.clean();assert.deepEqual(errors,[]);console.log('PASS native TLS: physical roof elevation, hidden avatar/label/flag,23-damage proxy ejection, departure flag drop');
}catch(error){originalError=error;evidence.errors.push(error.stack);evidence.lastPackets={native:f.packets.slice(-5),browser:packets.slice(-5)};await page?.screenshot({path:`${dir}/failure.png`}).catch(()=>{});throw error;}
finally {
  await nativeView?.close().catch(()=>{});await peerView?.close().catch(()=>{});
  await cleanupOwnedOnlineSession({originalError,stopApp:()=>f.close(),
    verifyDeparture:async()=>{if(nativeId)await until(()=>!b.room.players.some(p=>p.id===nativeId),'observer verifies native departure');},
    closePeers:()=>browser.close()});
  await writeFile(`${dir}/evidence.json`,JSON.stringify(evidence,null,2));
}

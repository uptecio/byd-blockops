import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { RoomClient } from '../src/network.js';
import { MAPS } from '../src/maps.js';
import { LOOT_SPAWNS } from '../src/loot-spawns.js';
import { getWeapon } from '../src/weapons.js';
import { humanMoveSpeed } from '../src/character-movement.js';
import { fixture,observer,until,equip } from './helpers/loot-browser.js';
import { goHome } from './helpers/progression-browser.js';
import { observeGame,followRoute,aimAt,assertRendered } from './helpers/traversal-browser.js';

const legacy=process.env.LEGACY_WEBVIEW==='1',dir=process.env.ARTIFACT_DIR||`artifacts/rooftops-hiding-zQylUE/online-${legacy?'legacy':'modern'}`;
await mkdir(dir,{recursive:true}); const f=await fixture({width:1200,height:700},{legacy});
const evidence={distDir:process.env.DIST_DIR,legacy,rounds:[],errors:[]};const observations=[];
const previousWebSocket=globalThis.WebSocket;globalThis.WebSocket=WebSocket;const late=new RoomClient();
try {
  for(const modeId of process.env.HIDING_MODE?[process.env.HIDING_MODE]:['ffa','tdm','ctf']) {
    const map=MAPS[0],spot=map.hideSpots[0];
    for(const [index,page] of f.pages.entries()) {
      f.packets[index].length=0;await page.goto(f.base);await page.locator('#home-online').tap();
      await page.locator('#player-name').fill(`HidePeer${index}`);await page.locator('.server-settings summary').tap();await page.locator('#server-address').fill(f.base);
    }
    const [host,guest]=f.pages;
    await host.locator('#create-room').tap();await host.locator('#room-lobby:not([hidden])').waitFor();
    await host.locator('#room-map').selectOption(map.id);await host.locator('#room-mode').selectOption(modeId);
    const code=await host.locator('#room-code').textContent();await guest.locator('#room-code-input').fill(code);await guest.locator('#join-room').tap();
    await until(async()=>await host.locator('#room-roster .roster-player').count()===2,'both peers joined');await host.locator('#start-online').tap();
    await Promise.all(f.pages.map(p=>p.waitForSelector('body[data-mode="playing"]')));
    const peers=f.pages.map((_,i)=>observer(f,i));await until(()=>peers.every(p=>p.player),'authoritative participants');
    for(const page of f.pages)observations.push(await observeGame(page));
    const walk=(index,points)=>followRoute(f.pages[index],async()=>({...peers[index].player}),points,{map,speed:humanMoveSpeed(getWeapon(peers[index].player.weaponId).classId),online:true});
    // Loot is acquired by walking over actual authored pickups.
    const knife=LOOT_SPAWNS[map.id].find(p=>p.kind==='knife'),frag=LOOT_SPAWNS[map.id].find(p=>p.grenadeType==='frag');
    if(modeId!=='ctf') {
      await walk(1,[{...frag,y:0},{...knife,y:0}]);
      assert.equal(peers[1].equipment.knife,true);assert.ok(peers[1].equipment.grenades.frag>0);
    }
    if(modeId==='ctf') {
      await walk(1,[{...map.bases.red,y:0}]);await until(()=>peers[0].room.flags.red.carrierId===peers[1].id,'guest stole enemy flag');
    }
    await walk(0,[map.traversal.roofs[0].point]);
    assert.equal(peers[0].player.supportId,map.traversal.roofs[0].supportId);
    await walk(0,[spot.entry]);await walk(1,[spot.entry]);
    console.log(`SETUP ${modeId}: ${peers[0].room.timeLeft.toFixed(1)} seconds remain`);
    await guest.locator('#hide-button').tap();await until(()=>peers[1].player.hiddenSpotId===spot.id,'guest is hidden');
    await until(async()=>(await observations[0].read()).models.some(m=>m.labelVisible===false&&m.visible===false),'remote avatar and label hidden');
    if(modeId==='ctf')assert.equal((await observations[0].read()).flags.red,false,'carried flag hidden with its carrier');
    await until(async()=>await host.locator('#hide-button').isDisabled()&&/Occupied/.test(await host.locator('#hide-button').textContent()),'occupied HUD catches up to authoritative snapshot');
    await late.connect(f.base,{type:'join',code,name:'Late observer',weaponId:'m4a1'});
    assert.equal(late.room.players.find(p=>p.id===peers[1].id).hiddenSpotId,spot.id);late.close();
    await equip(host,'sidearm','g17');
    await aimAt(host,async()=>peers[0].player,Math.atan2(-(spot.occupant.x-peers[0].player.x),-(spot.occupant.z-peers[0].player.z)),0);
    const before=peers[1].player.health;await host.keyboard.press('KeyF',{delay:25});
    await until(()=>peers[1].player.hiddenSpotId===null && peers[1].player.health<before,'body hit ejects occupied prop');
    assert.equal(before-peers[1].player.health,23,'occupied prop cannot grant enormous headshot damage');
    if(modeId==='ctf') {
      await guest.locator('#hide-button').tap();await until(()=>peers[1].player.hiddenSpotId===spot.id,'flag carrier hides again');
      await walk(0,[map.traversal.roofs[0].point,{x:spot.exit.x,y:2.2,z:spot.exit.z}]);
      console.log(`FLOOR ${modeId}: ${peers[0].room.timeLeft.toFixed(1)} seconds remain`);
      await goHome(guest);
      await until(()=>peers[0].room.flags.red.status==='dropped','leaving hidden drops flag below roof');
      const dropped={...peers[0].room.flags.red};assert.equal(dropped.y,0);assert.equal(dropped.x,spot.exit.x);assert.equal(dropped.z,spot.exit.z);
      await host.waitForTimeout(500);assert.equal(peers[0].room.flags.red.status,'dropped','standing directly above cannot return/capture through roof');
      await guest.locator('#home-online').tap();await guest.locator('#room-code-input').fill(code);await guest.locator('#join-room').tap();
      await guest.waitForSelector('body[data-mode="playing"]');
      // observer() normally chooses the first welcome; a new participation
      // requires a stream beginning at its new welcome, never the departed ID.
      const welcomeIndex=f.packets[1].findLastIndex(p=>p.type==='welcome');f.packets[1].splice(0,welcomeIndex);
      await until(()=>peers[1].player&&peers[1].player.hiddenSpotId===null,'rejoining starts exposed');
      await host.waitForSelector('body[data-mode="results"]',{timeout:190000});await guest.waitForSelector('body[data-mode="results"]');
      const oldRound=peers[0].room.roundId;
      await host.locator('#again-button').tap();await guest.locator('#again-button').tap();await host.locator('#start-online').tap();
      await until(()=>peers[0].room.roundId!==oldRound&&peers[0].room.players.every(p=>p.hiddenSpotId===null),'real rematch starts with no stale occupancy');
      await assertRendered(host,observations[0],`${modeId} rematch`);
      evidence.rounds.push({modeId,code,dropped,rematch:peers[0].room});
      for(const observation of observations.splice(0))await observation.close();
      for(const page of f.pages)await goHome(page);
      await until(async()=>(await (await fetch(`${f.base}/health`)).json()).rooms===0,'owned CTF room empty');
      console.log('PASS ctf: carried flag concealment, safe hidden leave, no return through floor, rejoin/rematch');
      continue;
    }
    // Reverse roles: the guest's actually collected knife can attack host hide.
    await host.locator('#hide-button').tap();await until(()=>peers[0].player.hiddenSpotId===spot.id,'host hides');
    await guest.locator('[data-inventory-key="knife"]').tap();
    await aimAt(guest,async()=>peers[1].player,Math.atan2(-(spot.occupant.x-peers[1].player.x),-(spot.occupant.z-peers[1].player.z)),0);
    await guest.locator('#fire-button').tap();await until(()=>peers[0].player.hiddenSpotId===null && peers[0].player.health<100,'knife ejects hidden host');
    await host.locator('#hide-button').tap();await until(()=>peers[0].player.hiddenSpotId===spot.id,'host hides again');
    const hiddenHealth=peers[0].player.health;
    await guest.locator('[data-inventory-key="grenade:frag"]').tap();
    await aimAt(guest,async()=>peers[1].player,peers[1].player.yaw,-1.2);await guest.locator('#throw-button').tap();
    await until(()=>peers[0].player.hiddenSpotId===null && peers[0].player.health<hiddenHealth,'real frag damages/ejects or eliminates hidden host',10000);
    await assertRendered(host,observations[0],`${modeId} online`);
    await host.screenshot({path:`${dir}/${modeId}-combat.png`});
    evidence.rounds.push({modeId,code,room:peers[0].room});
    for(const observation of observations.splice(0))await observation.close();
    for(const page of f.pages)await goHome(page);
    await until(async()=>(await (await fetch(`${f.base}/health`)).json()).rooms===0,'owned rooms empty');
    console.log(`PASS ${modeId}: live climb, host/guest hide, occupancy, late join, gun/knife/frag, leave`);
  }
  f.clean();
}catch(error){evidence.errors.push(error.stack);evidence.lastPackets=f.packets.map(p=>p.at(-1));await f.pages[0].screenshot({path:`${dir}/failure.png`}).catch(()=>{});throw error;}
finally {late.close();globalThis.WebSocket=previousWebSocket;for(const o of observations)await o.close().catch(()=>{});await writeFile(`${dir}/evidence.json`,JSON.stringify(evidence,null,2));await f.close();console.log('CLEANUP complete: owned browser and server closed');}

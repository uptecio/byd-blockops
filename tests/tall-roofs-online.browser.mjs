import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { MAPS } from '../src/maps.js';
import { sampleLadder } from '../src/access-schema.js';
import { fixture,observer,until,equip } from './helpers/loot-browser.js';
import { goHome } from './helpers/progression-browser.js';
import { observeGame,followRoute,aimAt,assertRendered } from './helpers/traversal-browser.js';

const legacy=process.env.LEGACY_WEBVIEW==='1',dir=process.env.ARTIFACT_DIR||`artifacts/tall-roofs-online-${legacy?'legacy':'modern'}`;
await mkdir(dir,{recursive:true});
const f=await fixture({width:1200,height:700},{legacy}),[host,guest]=f.pages;
const evidence={distDir:process.env.DIST_DIR,legacy,rounds:[],errors:[]};let observations=[];
try {
  for(const modeId of process.env.ROOF_ONLINE_MODE?[process.env.ROOF_ONLINE_MODE]:['ffa','tdm','ctf']) {
    assert.ok(['ffa','tdm','ctf'].includes(modeId));
    for(const [index,page] of f.pages.entries()) {
      f.packets[index].length=0;await page.goto(f.base);await page.locator('#home-online').tap();
      await page.locator('#player-name').fill(`RoofPeer${index}`);
      await page.locator('.server-settings summary').tap();await page.locator('#server-address').fill(f.base);
    }
    const map=MAPS.find(m=>m.id==='harbor'),roof=map.traversal.roofs.find(r=>r.id==='harbor:original:container-4');
    const ladder=map.traversal.ladders.find(l=>l.routeId===roof.routeId),middle={...sampleLadder(ladder,1.5),ladderId:ladder.id};
    await host.locator('#create-room').tap();await host.locator('#room-lobby:not([hidden])').waitFor();
    await host.locator('#room-map').selectOption(map.id);await host.locator('#room-mode').selectOption(modeId);
    const code=await host.locator('#room-code').textContent();
    await guest.locator('#room-code-input').fill(code);await guest.locator('#join-room').tap();
    await until(async()=>await host.locator('#room-roster .roster-player').count()===2,'two browser players');
    await host.locator('#start-online').tap();await Promise.all(f.pages.map(p=>p.waitForSelector('body[data-mode="playing"]')));
    const peers=[observer(f,0),observer(f,1)];await until(()=>peers.every(p=>p.player),'both authoritative snapshots');
    observations=await Promise.all(f.pages.map(observeGame));
    for(const o of observations)assert.equal((await o.read()).remotes.length,1,'observe current live OnlineArena');
    const walk=(i,route,touch=true)=>followRoute(f.pages[i],async()=>({...peers[i].player}),route,{map,online:true,touch});
    const traces=[];
    for(const role of [0,1]) {
      const up=await walk(role,[roof.point],role===0);
      assert.equal(peers[role].player.supportId,roof.supportId);
      await until(()=>Math.abs(peers[1-role].room.players.find(p=>p.id===peers[role].id).y-roof.point.y)<.1,'remote has matching roof elevation');
      assert.ok(up.samples.some(s=>s.ladderId===ladder.id),'real network ladder attachment');
      const hold=await walk(role,[middle],role===0),before={...peers[role].player};
      await f.pages[role].waitForTimeout(400);
      assert.equal(peers[role].player.ladderId,ladder.id);assert.ok(Math.abs(peers[role].player.y-before.y)<.03,'neutral holds height');
      await aimAt(f.pages[role],async()=>peers[role].player,before.yaw+1,0);
      assert.ok(Math.abs(peers[role].player.y-before.y)<.03,'free aim does not slide');
      await f.pages[role].screenshot({path:`${dir}/${modeId}-peer${role}-climb.png`});
      const down=await walk(role,[ladder.bottom.point],role===0);
      assert.equal(peers[role].player.ladderId,null);assert.equal(peers[role].player.supportId,'ground');
      traces.push({role,up,hold,down});
    }
    // Leave and late-rejoin through the real UI while the other peer holds a ladder.
    await walk(0,[middle]);await goHome(guest);
    await until(()=>peers[0].room.players.length===1,'departed browser participant removed');
    await guest.locator('#home-online').tap();await guest.locator('#room-code-input').fill(code);await guest.locator('#join-room').tap();
    await guest.waitForSelector('body[data-mode="playing"]');
    await observations[1].close();observations[1]=await observeGame(guest);
    const welcomeIndex=f.packets[1].findLastIndex(p=>p.type==='welcome');assert.ok(welcomeIndex>=0);f.packets[1].splice(0,welcomeIndex);
    await until(()=>peers[1].player&&peers[1].room.players.find(p=>p.id===peers[0].id)?.ladderId===ladder.id,'late join sees held ladder');
    assert.equal(peers[1].player.ladderId,null,'new life starts unattached');
    await until(async()=>{const remote=(await observations[1].read()).remotes?.find(a=>a.id===peers[0].id);return remote&&Math.abs(remote.y-peers[0].player.y)<.1;},'late join renders matching remote height');
    // A real nonfatal body shot at the attached actor; no injected damage.
    await walk(1,[{x:ladder.bottom.point.x-2,y:0,z:ladder.bottom.point.z}]);
    await equip(guest,'sidearm','g17');
    const a=peers[1].player,b=peers[0].player,dx=b.x-a.x,dz=b.z-a.z;
    await aimAt(guest,async()=>peers[1].player,Math.atan2(-dx,-dz),Math.atan2(b.y+.9-(a.y+1.6),Math.hypot(dx,dz)));
    const health=b.health;await guest.keyboard.press('KeyF',{delay:30});
    await until(()=>peers[0].player.health<health,'real body hit on attached target');
    assert.equal(peers[0].player.ladderId,ladder.id,'nonfatal damage retains attachment');
    await assertRendered(host,observations[0],`${modeId} online`);
    if(modeId==='ctf') {
      const roundId=peers[0].room.roundId;
      await host.waitForSelector('body[data-mode="results"]',{timeout:190000});await guest.waitForSelector('body[data-mode="results"]');
      await host.locator('#again-button').tap();await guest.locator('#again-button').tap();await host.locator('#start-online').tap();
      await until(()=>peers[0].room.roundId!==roundId&&peers[0].room.players.every(p=>p.ladderId===null),'real rematch resets all attachments');
      evidence.rematch=peers[0].room;
    }
    evidence.rounds.push({modeId,code,traces,room:peers[0].room});
    await writeFile(`${dir}/${modeId}-messages.json`,JSON.stringify(f.packets));
    for(const o of observations)await o.close();observations=[];
    for(const page of f.pages)await goHome(page);
    await until(async()=>(await (await fetch(`${f.base}/health`)).json()).rooms===0,'owned room fully cleaned');
    console.log(`PASS ${modeId}: both roles, up/down, free aim/hold, late rejoin, real damage${modeId==='ctf'?', rematch':''}`);
  }
  f.clean();
} catch(error){evidence.errors.push(error.stack);evidence.lastPackets=f.packets.map(p=>p.at(-1));evidence.observations=await Promise.all(observations.map(o=>o.read().catch(e=>({error:e.message}))));await host.screenshot({path:`${dir}/failure.png`}).catch(()=>{});throw error;}
finally{await writeFile(`${dir}/evidence.json`,JSON.stringify(evidence,null,2));for(const o of observations)await o.close().catch(()=>{});await f.close();console.log('CLEANUP: owned two-peer browser/server closed');}

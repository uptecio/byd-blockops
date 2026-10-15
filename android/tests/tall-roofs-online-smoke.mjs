import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {MAPS} from '../../src/maps.js';
import {sampleLadder} from '../../src/access-schema.js';
import {nativeProgressionFixture} from './helpers/progression-native.js';
import {cleanupOwnedOnlineSession} from './online-cleanup.mjs';
import {observer,until} from '../../tests/helpers/loot-browser.js';
import {goHome} from '../../tests/helpers/progression-browser.js';
import {observeGame,followRoute,aimAt,assertRendered} from '../../tests/helpers/traversal-browser.js';

const dir=process.env.ANDROID_TEST_ARTIFACTS,server=process.env.GAME_TEST_SERVER_URL;
assert.ok(dir&&server,'Explicit owned artifacts and private TLS staging required');assert.equal(new URL(server).protocol,'https:');await mkdir(dir,{recursive:true});
const f=await nativeProgressionFixture({artifactDir:dir,serverOrigin:server}),evidence={server,scales:[],errors:[]};
const map=MAPS.find(m=>m.id==='harbor'),roof=map.traversal.roofs.find(r=>r.id==='harbor:original:container-4'),ladder=map.traversal.ladders.find(l=>l.routeId===roof.routeId);
let browser,page,peer,nativeView,peerView,a,b,nativeId,originalError;const packets=[],errors=[];
try {
  assert.deepEqual(await f.version(),{code:11,name:'0.9.0'},'native ladder peer is exact candidate');
  assert.ok(process.env.DIST_DIR,'Exact frozen browser assets required for private native staging');evidence.assets={};
  for(const file of ['index.html','game.js','styles.css','THREE-LICENSE.txt']) {
    const response=await fetch(`${server}/${file}`,{cache:'no-store'});assert.equal(response.status,200);
    const bytes=Buffer.from(await response.arrayBuffer());assert.deepEqual(bytes,await readFile(resolve(process.env.DIST_DIR,file)),`private staging exact ${file}`);
    evidence.assets[file]=createHash('sha256').update(bytes).digest('hex');
  }
  page=await f.attach();evidence.identity=await f.identity();
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  peer=await(await browser.newContext({viewport:{width:1280,height:720},hasTouch:true})).newPage();
  peer.on('pageerror',e=>errors.push(e.message));peer.on('console',m=>{if(m.type()==='error'&&!m.location().url?.endsWith('/favicon.ico'))errors.push(m.text());});
  peer.on('websocket',s=>s.on('framereceived',frame=>packets.push(JSON.parse(String(frame.payload)))));
  await peer.goto(server);await peer.waitForSelector('body[data-mode="home"]');
  for(const p of [page,peer]){await p.locator('#home-armory').click();await p.locator('[data-class="sidearm"]').click();await p.locator('[data-weapon="g17"]').click();await p.locator('#armory-home').click();}
  for(const scale of [1,1.3]) {
    await page.locator('#home-settings').click();await page.locator('#control-size').fill(String(scale));await page.locator('#settings-done').click();
    f.packets.length=0;packets.length=0;
    for(const [p,name]of [[page,'TallRoof Android'],[peer,'TallRoof Browser']]){
      await p.locator('#home-online').click();await p.locator('#player-name').fill(name);await p.locator('.server-settings').evaluate(e=>{e.open=true;});await p.locator('#server-address').fill(server);
    }
    await peer.locator('#create-room').click();await peer.locator('#room-lobby:not([hidden])').waitFor();await peer.locator('#room-map').selectOption('harbor');await peer.locator('#room-mode').selectOption('ffa');
    const code=await peer.locator('#room-code').textContent();await page.locator('#room-code-input').fill(code);await page.locator('#join-room').click();
    await until(async()=>await peer.locator('#room-roster .roster-player').count()===2,'owned native and browser ladder peers');await peer.locator('#start-online').click();await page.waitForSelector('body[data-mode="playing"]');
    const streams={packets:[f.packets,packets]};a=observer(streams,0);b=observer(streams,1);await until(()=>a.player&&b.player,'both authoritative peers');nativeId=a.id;
    nativeView=await observeGame(page);peerView=await observeGame(peer);
    const walk=(p,view,points)=>followRoute(p,async()=>({...view.player}),points,{map,online:true,touch:true,timeout:90000});
    const up=await walk(page,a,[roof.point]);assert.equal(a.player.supportId,roof.supportId);assert.ok(up.samples.some(s=>s.ladderId===ladder.id));
    await until(async()=>{const remote=(await peerView.read()).remotes.find(p=>p.id===nativeId);return remote&&Math.abs(remote.y-a.player.y)<.1;},'browser renders actual native original-roof height');
    const hold=await walk(page,a,[{...sampleLadder(ladder,1.5),ladderId:ladder.id}]);const before={...a.player};
    await aimAt(page,async()=>a.player,before.yaw+1,0);await page.waitForTimeout(400);assert.equal(a.player.ladderId,ladder.id);assert.ok(Math.abs(a.player.y-before.y)<.03);
    await walk(peer,b,[{x:ladder.bottom.point.x-2,y:0,z:ladder.bottom.point.z}]);
    const shot=async(shooter,from,to)=>{const dx=to.player.x-from.player.x,dz=to.player.z-from.player.z;await aimAt(shooter,async()=>from.player,Math.atan2(-dx,-dz),Math.atan2(to.player.y+.9-(from.player.y+1.6),Math.hypot(dx,dz)));await shooter.locator('#fire-button').click();};
    const health=a.player.health;await shot(peer,b,a);await until(()=>a.player.health<health,'real browser damages attached native body');assert.equal(a.player.ladderId,ladder.id);
    const peerHealth=b.player.health,ammo=a.player.ammo;await shot(page,a,b);await until(()=>b.player.health<peerHealth&&a.player.ammo<ammo,'native touch Fire hits from ladder');assert.equal(a.player.ladderId,ladder.id);
    await page.locator('#reload-button').click();await until(()=>a.player.ammo>ammo-1,'native reload while attached');assert.equal(a.player.ladderId,ladder.id);
    await assertRendered(page,nativeView,'native ladder combat');await page.screenshot({path:`${dir}/native-ladder-${scale}.png`});await peer.screenshot({path:`${dir}/browser-sees-native-${scale}.png`});
    const down=await walk(page,a,[ladder.bottom.point]);assert.equal(a.player.supportId,'ground');assert.equal(a.player.ladderId,null);
    evidence.scales.push({scale,code,up,hold,down,native:a.player,peer:b.player});await writeFile(`${dir}/messages-${scale}.json`,JSON.stringify(streams.packets));
    await nativeView.close();nativeView=null;await peerView.close();peerView=null;await goHome(page);await until(()=>!b.room.players.some(p=>p.id===nativeId),'browser verifies native UI departure');nativeId=null;await goHome(peer);
    console.log(`PASS native/browser Harbor original roof, held aim, reciprocal body damage and reload at scale${scale}`);
  }
  await until(async()=>(await(await fetch(`${server}/health`,{cache:'no-store'})).json()).rooms===0,'owned TLS staging has no remaining rooms');
  f.clean();assert.deepEqual(errors,[]);
}catch(error){originalError=error;evidence.errors.push(error.stack);evidence.lastPackets={native:f.packets.slice(-5),peer:packets.slice(-5)};await page?.screenshot({path:`${dir}/failure.png`}).catch(()=>{});throw error;}
finally{
  await nativeView?.close().catch(()=>{});await peerView?.close().catch(()=>{});
  await cleanupOwnedOnlineSession({originalError,stopApp:()=>f.close(),verifyDeparture:async()=>{if(nativeId)await until(()=>!b.room.players.some(p=>p.id===nativeId),'browser verifies native process departure');},closePeers:async()=>{await browser?.close();}});
  await writeFile(`${dir}/evidence.json`,JSON.stringify(evidence,null,2));
}

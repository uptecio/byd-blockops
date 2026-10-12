import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fixture,observer,until,moveTo,lookTo,equip} from './helpers/loot-browser.js';
import {goHome} from './helpers/progression-browser.js';
import {openPowers,choosePowers} from './helpers/solo-powers-browser.js';

// Catches solo state leaking into online prediction/authority, hidden controls
// becoming available online, and credential/config fields leaking onto sockets.
const artifacts=resolve(process.env.ARTIFACT_DIR||'artifacts/solo-powers-online','online');await mkdir(artifacts,{recursive:true});
const f=await fixture({width:1024,height:600},{legacy:process.env.LEGACY_WEBVIEW==='1'}),[host,guest]=f.pages;
const sent=[],received=[];const evidence={rounds:[],movement:[],damage:[]};
for(const [index,page] of f.pages.entries())page.on('websocket',socket=>{
  socket.on('framesent',frame=>sent.push({index,packet:JSON.parse(String(frame.payload))}));
  socket.on('framereceived',frame=>received.push({index,packet:JSON.parse(String(frame.payload))}));
});
function noSecretFields(value) {
  if(!value||typeof value!=='object')return;
  for(const [key,item] of Object.entries(value)) {
    assert.ok(!/pin|verifier|salt|powers|invincib|unlimitedAmmo|superSpeed|speedMultiplier/i.test(key),`no local credential/power field on wire: ${key}`);
    noSecretFields(item);
  }
}
async function normalRound(peers) {
  const [a,b]=peers;
  await until(()=>a.player&&b.player,'both authoritative players');
  assert.notEqual(await host.locator('#ammo-count').textContent(),'∞');
  await host.locator('#pause-button').click();assert.equal(await host.locator('#pause-secret-logo').isVisible(),false);
  assert.equal(await host.locator('#solo-powers-screen').isVisible(),false);await host.locator('#resume-button').click();
  const ammo=a.player.ammo;await lookTo(host,a,0,.5);await host.keyboard.press('KeyF',{delay:180});
  await until(()=>a.player.ammo<ammo,'online shots consume finite ammo');
  await lookTo(host,a,0,0);
  const before={...a.player},time=a.room.timeLeft;
  await host.keyboard.down('KeyW');try{await until(()=>time-a.room.timeLeft>=1,'one real server second of movement');}finally{await host.keyboard.up('KeyW');}
  await host.waitForTimeout(150);const after={...a.player},seconds=time-a.room.timeLeft,distance=Math.hypot(after.x-before.x,after.z-before.z);
  assert.ok(distance/seconds>3.8&&distance/seconds<6.4,'online movement stays normal, not 5x');evidence.movement.push({before,after,seconds,distance});
  await moveTo(host,a,0,6);await moveTo(guest,b,0,-6);await equip(guest,'sidearm','g17');
  const dx=a.player.x-b.player.x,dz=a.player.z-b.player.z;
  await lookTo(guest,b,Math.atan2(-dx,-dz),Math.atan2(a.player.y+.9-(b.player.y+1.65),Math.hypot(dx,dz)));
  const health=a.player.health;await guest.keyboard.press('KeyF',{delay:40});
  await until(()=>a.player.health<health,'former invincible solo player takes real online body damage');
  assert.ok(a.player.health>0,'body shot is nonfatal');
  await until(()=>b.room.players.find(p=>p.id===a.id)?.health===a.player.health,'both independent clients agree on damaged health');
  evidence.damage.push({before:health,after:a.player.health});
}
try {
  await host.goto(f.base);await openPowers(host,{pin:'0427',firstSetup:true});
  await choosePowers(host,{invincible:true,unlimitedAmmo:true,superSpeed:true,speedMultiplier:5});
  await host.locator('#home-solo').click();assert.equal(await host.locator('#ammo-count').textContent(),'∞');
  await goHome(host);
  // Prepare powers again to exercise online-entry reset, not only quit reset.
  await openPowers(host,{pin:'0427'});await choosePowers(host,{invincible:true,unlimitedAmmo:true,superSpeed:true,speedMultiplier:5});
  await guest.goto(f.base);
  for(const [index,page] of f.pages.entries()) {
    await page.locator('#home-online').click();await page.locator('#player-name').fill(`PowersPeer${index}`);
    await page.locator('.server-settings summary').click();await page.locator('#server-address').fill(f.base);
  }
  await host.locator('#create-room').click();await host.locator('#room-lobby:not([hidden])').waitFor();
  await host.locator('#room-mode').selectOption('ctf');const code=await host.locator('#room-code').textContent();
  await guest.locator('#room-code-input').fill(code);await guest.locator('#join-room').click();
  await until(async()=>await host.locator('#room-roster .roster-player').count()===2,'two independent peers');
  const peers=[observer(f,0),observer(f,1)],a=peers[0];
  for(let round=0;round<2;round++) {
    await host.locator('#start-online').click();await Promise.all(f.pages.map(page=>page.waitForSelector('body[data-mode="playing"]')));
    await until(()=>a.room?.phase==='playing'&&a.room.roundId!==evidence.rounds.at(-1),'fresh authoritative round');
    evidence.rounds.push(a.room.roundId);await normalRound(peers);
    if(round===0) {
      for(let capture=1;capture<=3;capture++) {
        await moveTo(host,a,0,-18);await until(()=>a.room.flags.blue.carrierId===a.id,'real enemy flag pickup');
        if(capture<3){await moveTo(host,a,0,18);await until(()=>a.room.teamScores.red===capture,'real capture');}
        else {await host.keyboard.down('KeyS');try{await until(()=>f.packets[0].at(-1)?.room?.phase==='ended','third capture ends round',15000);}finally{await host.keyboard.up('KeyS');}}
      }
      await Promise.all(f.pages.map(page=>page.waitForSelector('body[data-mode="results"]')));
      await host.locator('#again-button').click();await guest.locator('#again-button').click();
    }
  }
  const oldId=a.id;await goHome(host);await until(()=>peers[1].room.players.length===1,'departure removes old participant');
  await host.locator('#home-online').click();await host.locator('#room-code-input').fill(code);await host.locator('#join-room').click();
  await host.waitForSelector('body[data-mode="playing"]');
  const welcome=f.packets[0].findLastIndex(packet=>packet.type==='welcome');assert.ok(welcome>=0);f.packets[0].splice(0,welcome);
  await until(()=>a.player&&a.id!==oldId,'new participation after rejoin');
  assert.equal(a.player.health,100);assert.notEqual(await host.locator('#ammo-count').textContent(),'∞');
  const ammo=a.player.ammo;await host.keyboard.press('KeyF',{delay:180});await until(()=>a.player.ammo<ammo,'reconnected participant still consumes ammo');
  await goHome(host);await goHome(guest);
  await openPowers(host,{pin:'0427'});
  for(const id of ['invincible','ammo','speed'])assert.equal(await host.locator(`#solo-powers-${id}`).isChecked(),false);
  assert.equal(await host.locator('#solo-powers-speed-multiplier').inputValue(),'2');
  await host.locator('#solo-powers-cancel').click();await host.locator('#home-solo').click();assert.notEqual(await host.locator('#ammo-count').textContent(),'∞');
  assert.ok(sent.length&&received.length);for(const {packet} of [...sent,...received])noSecretFields(packet);
  evidence.sent=sent.length;evidence.received=received.length;await writeFile(`${artifacts}/evidence.json`,JSON.stringify(evidence,null,2));
  await host.screenshot({path:`${artifacts}/normal-solo-after-online.png`});f.clean();
  console.log('PASS two peers: normal damage/ammo/speed, real CTF rematch, departure/rejoin, no secret wire fields and solo reset');
} catch(error){await host.screenshot({path:`${artifacts}/failure.png`});await writeFile(`${artifacts}/evidence.json`,JSON.stringify(evidence,null,2));throw error;}
finally {await f.close();}

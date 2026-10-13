import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fixture, onlinePair, until, moveTo, lookTo, equip } from './helpers/loot-browser.js';
import { goHome } from './helpers/progression-browser.js';
import { enterRange, observeRange, fireRangeKill, assertLegacy } from './helpers/range-browser.js';
import { openPowers, choosePowers } from './helpers/solo-powers-browser.js';

// Catches private map/ammo/power/labels leaking into normal/Zombies/online,
// private wire fields, and visit-by-visit GPU/feedback resource growth.
const artifacts=resolve(process.env.ARTIFACT_DIR||'artifacts/shooting-range-online');await mkdir(artifacts,{recursive:true});
const legacy=process.env.LEGACY_WEBVIEW==='1',f=await fixture({width:1024,height:600},{legacy}),[host,guest]=f.pages,evidence={cycles:[],packets:[],damage:[]};let observation;
for(const [index,page]of f.pages.entries())page.on('websocket',socket=>{for(const event of ['framesent','framereceived'])socket.on(event,frame=>evidence.packets.push({index,event,packet:JSON.parse(String(frame.payload))}));});
function noPrivate(value){if(!value||typeof value!=='object')return;for(const [key,item]of Object.entries(value)){assert.ok(!/range|powers|invincib|unlimitedAmmo|superSpeed|speedMultiplier|verifier|salt|pin/i.test(key),`no private wire key ${key}`);assert.notEqual(item,'shooting-range');assert.notEqual(item,'range');noPrivate(item);}}
async function normalHud(page){assert.equal(await page.locator('#range-stats').isVisible(),false);assert.equal(await page.locator('#knife-button').isVisible(),true);assert.notEqual(await page.locator('#reserve-count').textContent(),'∞');assert.notEqual(await page.locator('#ammo-count').textContent(),'∞');assert.doesNotMatch(await page.locator('#hud-mode').textContent(),/range/i);}
try{
  await host.goto(f.base);await openPowers(host,{pin:'0427',firstSetup:true});await choosePowers(host,{invincible:true,unlimitedAmmo:true,superSpeed:true,speedMultiplier:5});
  await enterRange(host);observation=await observeRange(host);await host.keyboard.press('KeyF',{delay:300});await goHome(host);
  for(const mode of ['ffa','zombies']){await host.locator(`[data-mode-id="${mode}"]`).tap();await host.locator('#home-solo').tap();await host.waitForSelector('body[data-mode="playing"]');await normalHud(host);const state=await observation.read();assert.equal(state.rangeNodes,0);assert.equal(state.feedback,0);assert.deepEqual(state.powers,{invincible:false,unlimitedAmmo:false,superSpeed:false,speedMultiplier:2},'all powers reset before normal play');const ammo=state.ammo;await host.keyboard.press('KeyF',{delay:200});assert.ok((await observation.read()).ammo<ammo,'normal fire consumes ammo');await host.screenshot({path:`${artifacts}/range-to-${mode}.png`});await goHome(host);}
  // Warm renderer caches, then compare all later departures to a stable plateau.
  for(let i=0;i<20;i++){await enterRange(host);await fireRangeKill(host,'close-dummy','body',observation);const live=await observation.read();assert.equal(live.feedback,12,'bounded damage feedback pool after real kill');await goHome(host);await host.waitForTimeout(100);const state=await observation.read(),gpu=await host.evaluate(()=>window.__lootObservation.live);assert.equal(state.rangeNodes,0);assert.equal(state.feedback,0);evidence.cycles.push({i,memory:state.memory,gpu,liveFeedback:live.feedback});}
  const plateau=evidence.cycles.slice(3);for(const row of plateau){assert.deepEqual(row.memory,plateau[0].memory,'20 cycles plateau renderer resources');assert.deepEqual(row.gpu,plateau[0].gpu,'20 cycles plateau live GPU handles');}
  await observation.close();observation=null;await host.locator('[data-mode-id="ffa"]').tap();
  // Preserve the host's actual ArenaGame instance across all three modes.
  await guest.goto(f.base);
  const peers=await onlinePair(f,{navigate:false}),[a,b]=peers;
  for(const page of f.pages)await normalHud(page);
  assert.equal(await host.locator('#room-map option').count(),8);assert.equal(await host.locator('#room-mode option[value="range"]').count(),0);
  await until(()=>a.player&&b.player,'real authoritative peers');const ammo=a.player.ammo;await host.keyboard.press('KeyF',{delay:200});await until(()=>a.player.ammo<ammo,'online fire consumes finite ammo');
  await moveTo(host,a,0,6);await moveTo(guest,b,0,-6);await equip(guest,'sidearm','g17');
  const dx=a.player.x-b.player.x,dz=a.player.z-b.player.z;await lookTo(guest,b,Math.atan2(-dx,-dz),Math.atan2(a.player.y+.9-(b.player.y+1.65),Math.hypot(dx,dz)));
  const health=a.player.health;await guest.keyboard.press('KeyF',{delay:40});await until(()=>a.player.health<health,'former powered practice user takes real online damage');assert.equal(health-a.player.health,23,'ordinary G17 body damage, not practice precision damage');assert.ok(a.player.health>0);evidence.damage.push({before:health,after:a.player.health});
  await until(()=>evidence.packets.some(r=>r.packet.type==='welcome'),'protocol greeting observed');assert.ok(evidence.packets.some(r=>r.packet.protocol===8),'protocol 8 reaches real server');for(const {packet}of evidence.packets)noPrivate(packet);
  await host.screenshot({path:`${artifacts}/normal-online-after-range.png`});await assertLegacy(host,legacy);f.clean();console.log('PASS range→solo/Zombies/two peers: finite ammo/damage, 8 maps/protocol8, no private packets/labels/powers; 20 GPU plateaus');
}catch(error){await host.screenshot({path:`${artifacts}/failure.png`}).catch(()=>{});throw error;}
finally{await observation?.close();await writeFile(`${artifacts}/evidence.json`,JSON.stringify(evidence,null,2));await f.close();}

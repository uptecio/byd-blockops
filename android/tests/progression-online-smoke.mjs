import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {nativeProgressionFixture} from './helpers/progression-native.js';
import {observer,moveTo,lookAt,until} from '../../tests/helpers/loot-browser.js';
import {readProfile} from '../../tests/helpers/progression-browser.js';

const server=process.env.GAME_TEST_SERVER_URL;assert.ok(server,'Explicit owned TLS staging required');
const artifacts=process.env.ANDROID_TEST_ARTIFACTS||'artifacts/xp-native-online';await mkdir(artifacts,{recursive:true});
const f=await nativeProgressionFixture({artifactDir:artifacts,serverOrigin:server});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1200,height:700},hasTouch:true}),peer=await context.newPage(),peerPackets=[],errors=[];
peer.on('pageerror',e=>errors.push(e.message));peer.on('websocket',s=>s.on('framereceived',frame=>peerPackets.push(JSON.parse(String(frame.payload)))));
function observeModels(){
  const push=Array.prototype.push,models=new Set();
  window.__xpModelRead=()=>[...models].filter(o=>o.parent).map(o=>{
    const weaponColors=[];o.getObjectByName('weapon')?.traverse(c=>{if(c.material?.color)weaponColors.push(c.material.color.getHexString());});
    return {...o.userData,weaponColors,colors:o.children.filter(c=>c.material?.color).map(c=>c.material.color.getHexString())};
  });
  Array.prototype.push=function(...items){for(const o of items)if(o?.isObject3D&&o.userData?.skinId)models.add(o);return push.apply(this,items);};
}
let page;
try {
  page=await f.attach();await page.evaluate(observeModels);await peer.addInitScript(observeModels);
  const original=await readProfile(page);assert.ok(original.lifetimeXP>=350,'Run actual offline earning gate before online cosmetic gate');
  await page.locator('[data-map="courtyard"]').click();await page.locator('[data-mode-id="ffa"]').click();
  await page.locator('[data-skin="crimson-ninja"]').click();await page.locator('#home-armory').click();
  await page.locator('[data-finish="crimson-red"]').click();await page.locator('[data-class="sniper"]').click();await page.locator('[data-weapon="awp"]').click();await page.locator('#armory-home').click();
  await peer.goto(server);await peer.waitForSelector('body[data-mode="home"]');
  await peer.locator('[data-skin="robo-unit"]').click();await peer.locator('#home-armory').click();await peer.locator('[data-class="sniper"]').click();await peer.locator('[data-weapon="awp"]').click();await peer.locator('#armory-home').click();
  for(const [p,name]of [[page,'NativeXP'],[peer,'BrowserXP']]){
    await p.locator('#home-online').click();await p.locator('#player-name').fill(name);await p.locator('.server-settings').evaluate(e=>{e.open=true;});await p.locator('#server-address').fill(server);
  }
  await page.locator('#create-room').click();await page.waitForSelector('#room-lobby:not([hidden])');const code=await page.locator('#room-code').textContent();
  await peer.locator('#room-code-input').fill(code);await peer.locator('#join-room').click();
  await until(async()=>await page.evaluate(()=>document.querySelectorAll('#room-roster .roster-player').length)===2,'native and browser peers join owned TLS staging');
  await page.locator('#start-online').click();await peer.waitForSelector('body[data-mode="playing"]');
  const observations={packets:[f.packets,peerPackets]},a=observer(observations,0),b=observer(observations,1);
  await until(()=>a.player&&b.player,'real native/browser snapshots');
  await until(async()=>(await peer.evaluate(()=>window.__xpModelRead())).some(m=>m.skinId==='crimson-ninja'&&m.finishId==='crimson-red'&&m.colors.includes('8f2038')&&m.weaponColors.includes('ae2943')),'browser renders native earned skin palette and actual gun finish');
  await until(async()=>(await page.evaluate(()=>window.__xpModelRead())).some(m=>m.skinId==='robo-unit'&&m.colors.includes('7c94a6')),'native renders peer actual Robo palette');
  await moveTo(page,a,0,10);await moveTo(peer,b,0,0);await lookAt(page,a,b);
  const victimLife=b.player.lifeId;await page.keyboard.press('KeyF');await until(()=>b.player.lifeId>victimLife,'real native shot eliminates and peer respawns');
  await until(async()=>(await readProfile(page)).lifetimeXP===original.lifetimeXP+10,'native receives and saves its private10XP');
  assert.equal((await readProfile(peer)).lifetimeXP,0);
  await page.locator('#loadout-button').click();await page.locator('#armory-skin').selectOption('shadow-ninja');await page.locator('[data-finish="standard"]').click();
  await until(()=>a.player.pendingSkinId==='shadow-ninja'&&a.player.pendingFinishId==='standard','native menu sends pending choices');
  assert.equal(a.player.skinId,'crimson-ninja');assert.equal(a.player.finishId,'crimson-red');
  assert.match(await page.locator('#appearance-timing').textContent(),/Next respawn.*Shadow Ninja.*Wearing: Crimson Ninja/);
  await moveTo(peer,b,0,0);await lookAt(peer,b,a);const oldLife=a.player.lifeId;
  await peer.keyboard.press('KeyF',{delay:80});await until(()=>a.player.lifeId>oldLife,'native respawn applies pending appearance while menu remains open');
  assert.equal(await page.locator('body').getAttribute('data-mode'),'armory');
  assert.equal(a.player.skinId,'shadow-ninja');assert.equal(a.player.finishId,'standard');
  await until(async()=>(await peer.evaluate(()=>window.__xpModelRead())).some(m=>m.skinId==='shadow-ninja'&&!m.finishId&&m.colors.includes('303445')),'browser actual model updates after native respawn');
  const saved=await readProfile(page);assert.equal(saved.skinId,'shadow-ninja');assert.equal(saved.finishId,'standard');assert.equal(saved.lifetimeXP,original.lifetimeXP+10);
  await page.screenshot({path:`${artifacts}/native-online-pending-applied.png`});await peer.screenshot({path:`${artifacts}/browser-sees-native.png`});
  await page.locator('#armory-home').click();await page.locator('#confirm-home').click();
  page=await f.relaunch();assert.deepEqual(await readProfile(page),saved,'stable APK origin preserves online XP and preference after force-stop');
  await writeFile(`${artifacts}/native-online-evidence.json`,JSON.stringify({server,beforeXP:original.lifetimeXP,afterXP:saved.lifetimeXP,appearance:saved},null,2));
  f.clean();assert.deepEqual(errors,[]);console.log('PASS native TLS online: actual private XP, both rendered peer palettes, pending skin/finish through open menu/respawn, force-stop retention');
}finally{await browser.close();await f.close();}

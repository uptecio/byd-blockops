import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fixture, until } from './helpers/loot-browser.js';
import { goHome } from './helpers/progression-browser.js';
import { touchControls } from './helpers/traversal-browser.js';
import { openPowers, choosePowers } from './helpers/solo-powers-browser.js';
import { enterRange, observeRange, assertLegacy } from './helpers/range-browser.js';

// Catches clipped Home/HUD/modal controls, overlapping statistics, lost
// multitouch movement/jump/fire, and focus escaping the PIN modal.
const artifacts=resolve(process.env.ARTIFACT_DIR||'artifacts/shooting-range-layout');await mkdir(artifacts,{recursive:true});
const legacy=process.env.LEGACY_WEBVIEW==='1',f=await fixture({width:1024,height:600},{legacy}),page=f.pages[0],evidence=[];let observation;
async function reachable(selector,size){const control=page.locator(selector);await control.scrollIntoViewIfNeeded();const b=await control.boundingBox();assert.ok(b&&b.width>=44&&b.height>=44,`${selector} touch target`);assert.ok(b.x>=0&&b.y>=0&&b.x+b.width<=size.width+1&&b.y+b.height<=size.height+1,`${selector} reachable`);assert.equal(await control.evaluate(el=>{const b=el.getBoundingClientRect();return el.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));}),true,`${selector} unobscured`);}
async function homeFits(size,label){
  const boxes={};
  for(const id of ['home-solo','home-armory','home-online','home-range','character-preview','home-progression']){
    const control=page.locator(`#${id}`),b=await control.boundingBox();boxes[id]=b;
    assert.ok(b&&b.x>=0&&b.y>=0&&b.x+b.width<=size.width+1&&b.y+b.height<=size.height+1,`${id} fits ${label}`);
    if(id.startsWith('home-')&&id!=='home-progression'){
      assert.ok(b.width>=44&&b.height>=44,`${id} keeps 44px touch target`);
      assert.equal(await control.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,`${id} unobscured ${label}`);
    }
  }
  const footer=await page.locator('.home-screen .app-footer').boundingBox();assert.ok(footer.y>=0&&footer.y+footer.height<=size.height+1,`footer fits ${label}`);
  for(const id of ['home-solo','home-armory','home-online','home-range'])assert.ok(boxes[id].y+boxes[id].height<=footer.y+1,`${id} does not overlap footer ${label}`);
  evidence.push({homeLabel:label,homeBoxes:boxes,footer});
}
try{
  await page.goto(f.base);await openPowers(page,{pin:'0427',firstSetup:true});await choosePowers(page,{invincible:false,unlimitedAmmo:false,superSpeed:false,speedMultiplier:2});
  for(const size of [{width:854,height:480},{width:1024,height:600}])for(const scale of [.8,1.3]){
    await page.setViewportSize({width:size.width,height:600});await page.locator('#home-settings').tap();await page.locator('#control-size').fill(String(scale));await page.locator('#settings-done').tap();await page.setViewportSize(size);
    await homeFits(size,`ordinary ${size.width}/${scale}`);await reachable('#home-range',size);await enterRange(page);observation=await observeRange(page);
    for(const selector of ['#fire-button','#jump-button','#reload-button','#home-button','#pause-button','#loadout-button'])await reachable(selector,size);
    const boxes=await page.evaluate(()=>Object.fromEntries(['range-stats','fire-button','jump-button','joystick','hud-mode'].map(id=>{const b=document.getElementById(id).getBoundingClientRect();return [id,{x:b.x,y:b.y,w:b.width,h:b.height}];})));
    const stats=boxes['range-stats'];assert.ok(stats.x>=0&&stats.y>=0&&stats.x+stats.w<=size.width+1);
    for(const id of ['fire-button','jump-button','joystick']){const b=boxes[id];assert.ok(stats.x+stats.w<=b.x||b.x+b.w<=stats.x||stats.y+stats.h<=b.y||b.y+b.h<=stats.y,`statistics do not overlap ${id}`);}
    const touch=await touchControls(page),stick=await touch.point('#joystick',51),fire=await touch.point('#fire-button',52),jump=await touch.point('#jump-button',53),before=await observation.read();let jumping=false;
    try{await touch.send('touchStart',[stick,fire,jump]);await touch.send('touchMove',[{...stick,y:stick.y-45},fire,jump]);for(let i=0;i<8;i++){await page.waitForTimeout(100);jumping||=(await observation.read()).player.y>0;}await touch.send('touchEnd');}finally{await touch.close();}
    const after=await observation.read();assert.ok(after.ammo<before.ammo,'FIRE works alongside MOVE/JUMP');assert.ok(Math.hypot(after.player.x-before.player.x,after.player.z-before.player.z)>1,'MOVE works alongside FIRE/JUMP');assert.ok(jumping,'JUMP works alongside FIRE/MOVE');await page.waitForTimeout(350);assert.equal((await observation.read()).input.fire,false);
    await page.screenshot({path:`${artifacts}/${size.width}x${size.height}-${scale}-range.png`});
    await page.locator('#pause-button').tap();for(const selector of ['#resume-button','#pause-loadout','#pause-home'])await reachable(selector,size);
    await openPowers(page,{origin:'paused',pin:'0427'});for(const selector of ['#solo-powers-apply','#solo-powers-cancel'])await reachable(selector,size);
    await page.locator('#solo-powers-cancel').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'solo-powers-invincible');await page.locator('#resume-button').focus();assert.equal(await page.locator('#solo-powers-screen').evaluate(el=>el.contains(document.activeElement)),true);await page.keyboard.press('Escape');assert.equal(await page.locator('body').getAttribute('data-mode'),'paused');
    await page.locator('#pause-home').tap();for(const selector of ['#cancel-home','#confirm-home'])await reachable(selector,size);await page.screenshot({path:`${artifacts}/${size.width}x${size.height}-${scale}-confirm.png`});await page.locator('#cancel-home').tap();await page.locator('#resume-button').tap();await goHome(page);await observation.close();observation=null;evidence.push({size,scale,boxes,before,after});console.log(`PASS range layout ${size.width}x${size.height} scale ${scale}: real multitouch, geometry, modal reach/focus`);
  }
  // Catalogue geometry only: this synthetic profile never enters gameplay or
  // supplies evidence for earned XP/unlocks in shooting-range.browser.mjs.
  await assertLegacy(page,legacy);
  await page.evaluate(()=>localStorage.setItem('block-ops-progression-v1',JSON.stringify({schemaVersion:1,lifetimeXP:2147483647,skinId:'ranger',finishId:'standard',receipts:[]})));await page.reload();await page.waitForSelector('body[data-mode="home"]');
  for(const size of [{width:854,height:480},{width:1024,height:600}])for(const scale of [.8,1.3]){await page.setViewportSize(size);await page.locator('#home-settings').tap();await page.locator('#control-size').fill(String(scale));await page.locator('#settings-done').tap();await page.locator('[data-skin="void-guard"]').tap();await homeFits(size,`max-rank ${size.width}/${scale}`);await page.screenshot({path:`${artifacts}/${size.width}x${size.height}-${scale}-max-rank-home.png`});console.log(`PASS max-rank Home ${size.width}/${scale}: original entries, range, footer and 44px controls`);}
  f.clean();
}catch(error){await page.screenshot({path:`${artifacts}/failure.png`}).catch(()=>{});throw error;}
finally{await observation?.close();await writeFile(`${artifacts}/evidence.json`,JSON.stringify(evidence,null,2));await f.close();}

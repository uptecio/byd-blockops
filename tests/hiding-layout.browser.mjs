import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { MAPS } from '../src/maps.js';
import { fixture,until } from './helpers/loot-browser.js';
import { observeGame,followRoute,touchControls,assertRendered } from './helpers/traversal-browser.js';

const legacy=process.env.LEGACY_WEBVIEW==='1',dir=process.env.ARTIFACT_DIR||`artifacts/rooftops-hiding-zQylUE/layout-${legacy?'legacy':'modern'}`;
await mkdir(dir,{recursive:true});const evidence={distDir:process.env.DIST_DIR,legacy,profiles:[]};
const separated=(a,b)=>a.x+a.width<=b.x+1||b.x+b.width<=a.x+1||a.y+a.height<=b.y+1||b.y+b.height<=a.y+1;
for(const size of [{width:854,height:480},{width:1200,height:700},{width:1280,height:720}]) for(const scale of [1,1.3]) {
  const f=await fixture(size,{legacy}),page=f.pages[0],label=`${size.width}-${scale}`;let observation,controls;
  try {
    await page.goto(f.base);await page.locator('#home-settings').tap();await page.locator('#bots').fill('1');
    await page.locator('#difficulty').selectOption('easy');await page.locator('#sound').uncheck();await page.locator('#control-size').fill(String(scale));await page.locator('#settings-done').tap();
    await page.locator('#home-solo').tap();await page.waitForSelector('body[data-mode="playing"]');observation=await observeGame(page);
    const map=MAPS[0],spot=map.hideSpots[1];
    controls=await touchControls(page);const stick=await controls.point('#joystick',51),jump=await controls.point('#jump-button',52);
    const start=await observation.actor();await controls.send('touchStart',[stick,jump]);
    await controls.send('touchMove',[{...stick,x:stick.x+8},jump]);
    await until(async()=>(await observation.actor()).y>start.y+.1,'multitouch jump');
    await until(async()=>{const airborne=await observation.actor();return Math.hypot(airborne.x-start.x,airborne.z-start.z)>.01;},'multitouch movement');
    await controls.send('touchCancel');await until(async()=>(await observation.actor()).grounded,'landing after cancellation');
    assert.deepEqual((await observation.read()).input.move,{x:0,y:0},'cancel clears stick');
    await followRoute(page,observation.actor,[spot.entry],{map});
    const bounds={};
    for(const selector of ['#hide-button','#fire-button','#jump-button','#joystick','#loot-inventory','.health-panel']) {
      const box=await page.locator(selector).boundingBox();assert.ok(box,`${label} ${selector} visible`);
      assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=size.width+1&&box.y+box.height<=size.height+1,`${label} ${selector} on screen`);bounds[selector]=box;
    }
    for(const [selector,box] of Object.entries(bounds))if(selector!=='#hide-button')assert.ok(separated(bounds['#hide-button'],box),`${label}: Hide separate from ${selector}`);
    await page.locator('#hide-button').tap();await until(async()=>(await observation.actor()).hiddenSpotId===spot.id,'touch Hide');
    const hidden=await assertRendered(page,observation,label);await page.screenshot({path:`${dir}/${label}-hide.png`});
    const hide=await controls.point('#hide-button',53),fire=await controls.point('#fire-button',54);
    await controls.send('touchStart',[hide,fire]);await page.waitForTimeout(160);await controls.send('touchCancel');
    await until(async()=>(await observation.actor()).hiddenSpotId===null,'Hide/Fire exits, no stuck toggle');
    const ammo=await page.locator('#ammo-count').textContent();await page.waitForTimeout(500);assert.equal(await page.locator('#ammo-count').textContent(),ammo,'cancel stops firing');
    await page.keyboard.down('KeyH');await page.waitForTimeout(200);await page.keyboard.down('KeyH');await page.waitForTimeout(250);
    assert.equal((await observation.actor()).hiddenSpotId,spot.id,'held H enters once');await page.keyboard.up('KeyH');
    // Genuine focus/visibility lifecycle, not a call into game state.
    await controls.send('touchStart',[stick,fire]);await controls.send('touchMove',[{...stick,x:stick.x+10},fire]);
    const cdp=await page.context().newCDPSession(page);await cdp.send('Page.setWebLifecycleState',{state:'frozen'});await cdp.send('Page.setWebLifecycleState',{state:'active'});await cdp.detach();
    await f.pages[1].goto('about:blank');await f.pages[1].bringToFront();await page.waitForTimeout(100);await page.bringToFront();await controls.send('touchCancel');
    if(await page.locator('#resume-button').isVisible())await page.locator('#resume-button').tap();
    await page.waitForTimeout(100);const input=(await observation.read()).input;assert.equal(input.fire,false);assert.deepEqual(input.move,{x:0,y:0});
    evidence.profiles.push({label,bounds,hidden,legacy:await page.evaluate(()=>window.__legacyProbe||null)});f.clean();console.log(`PASS hide layout/multitouch ${label} ${legacy?'legacy':'modern'}`);
  }catch(error){await page.screenshot({path:`${dir}/${label}-failure.png`}).catch(()=>{});throw error;}
  finally {await controls?.close().catch(()=>{});await observation?.close().catch(()=>{});await f.close();await writeFile(`${dir}/evidence.json`,JSON.stringify(evidence,null,2));}
}

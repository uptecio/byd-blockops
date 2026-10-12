import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fixture} from './helpers/loot-browser.js';
import {touchControls} from './helpers/traversal-browser.js';

// Catches duplicate touch activation, clipped keyboard-sized dialogs, escape
// leaking through to gameplay, and a slider that cannot be operated by touch.
const artifacts=resolve(process.env.ARTIFACT_DIR||'artifacts/solo-powers-layout','layout');
await mkdir(artifacts,{recursive:true});
const f=await fixture({width:1280,height:720},{legacy:process.env.LEGACY_WEBVIEW==='1'}),page=f.pages[0];
let firstSetup=true;
async function reachable(selector,size) {
  const control=page.locator(selector);await control.scrollIntoViewIfNeeded();
  const box=await control.boundingBox();
  assert.ok(box&&box.width>=44&&box.height>=44,`${selector} has a 44px target`);
  assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=size.width+1&&box.y+box.height<=size.height+1,`${selector} can be scrolled fully into view`);
  assert.equal(await control.evaluate(el=>{const b=el.getBoundingClientRect();return el.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));}),true,`${selector} is not covered`);
}
try {
  await page.goto(f.base);
  for(const size of [{width:1280,height:720},{width:1024,height:600},{width:854,height:480},{width:854,height:300}])for(const scale of [.8,1.3]) {
    const label=`${size.width}x${size.height}-${scale}`;
    // Set preferences at a normal height, then reproduce a keyboard-reduced
    // viewport after opening Home; settings itself is not under test here.
    await page.setViewportSize({width:size.width,height:Math.max(600,size.height)});
    await page.locator('#home-settings').click();await page.locator('#control-size').fill(String(scale));await page.locator('#settings-done').click();
    await page.setViewportSize(size);
    const logo=page.locator('#home-secret-logo');await logo.scrollIntoViewIfNeeded();
    await reachable('#home-secret-logo',size);
    for(let i=0;i<4;i++){await logo.tap();assert.equal(await page.locator('#solo-powers-screen').isVisible(),false,'one touch counts only once');}
    await logo.tap();await page.waitForSelector('#solo-powers-screen:not([hidden])');
    const pinSelectors=['#solo-powers-pin',...(firstSetup?['#solo-powers-pin-confirm']:[]),'#solo-powers-pin-submit','#solo-powers-cancel'];
    for(const selector of pinSelectors)await reachable(selector,size);
    await page.locator('#solo-powers-cancel').focus();await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'solo-powers-pin');
    await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'solo-powers-cancel');
    await page.locator('#home-solo').focus();assert.equal(await page.locator('#solo-powers-screen').evaluate(el=>el.contains(document.activeElement)),true,'focus cannot leave modal');
    assert.equal(await page.locator('body').getAttribute('data-mode'),'home');
    await page.screenshot({path:`${artifacts}/${label}-pin-empty.png`});
    assert.equal(await page.locator('#solo-powers-pin').getAttribute('type'),'password');
    await page.locator('#solo-powers-pin').fill('0427');
    if(firstSetup)await page.locator('#solo-powers-pin-confirm').fill('0427');
    await page.locator('#solo-powers-pin-submit').click();await page.waitForSelector('#solo-powers-controls:not([hidden])');firstSetup=false;
    for(const selector of ['#solo-powers-invincible','#solo-powers-ammo','#solo-powers-speed','#solo-powers-speed-multiplier','#solo-powers-apply','#solo-powers-cancel'])await reachable(selector,size);
    await page.locator('#solo-powers-speed').tap();
    const slider=page.locator('#solo-powers-speed-multiplier');await slider.scrollIntoViewIfNeeded();
    const b=await slider.boundingBox(),touch=await touchControls(page),finger={id:91,x:b.x+9,y:b.y+b.height/2};
    try {
      await touch.send('touchStart',[finger]);
      for(const part of [.25,.5,.75,.9])await touch.send('touchMove',[{...finger,x:b.x+b.width*part}]);
      await touch.send('touchEnd');
    } finally {await touch.close();}
    assert.ok(Number(await slider.inputValue())>=4.5,'real drag changes speed toward 5x');
    assert.match(await page.locator('#solo-powers-speed-value').textContent(),/^[45]\.\d×$/);
    await page.locator('#solo-powers-cancel').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'solo-powers-invincible');
    await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'solo-powers-cancel');
    await reachable('#solo-powers-apply',size);await page.screenshot({path:`${artifacts}/${label}-controls.png`});
    await page.keyboard.press('Escape');assert.equal(await page.locator('body').getAttribute('data-mode'),'home');
    assert.equal(await page.locator('#solo-powers-screen').isVisible(),false);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'home-secret-logo');
    console.log(`PASS powers layout ${label}: touch gesture, masked gate, reachable controls, focus, slider and cancel`);
  }
  f.clean();
} catch(error){await page.screenshot({path:`${artifacts}/failure.png`});throw error;}
finally {await f.close();}

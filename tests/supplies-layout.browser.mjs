import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { fixture } from './helpers/loot-browser.js';
import { emulateLegacyWebView } from './helpers/legacy-webview.js';

const artifacts=process.env.SUPPLY_ARTIFACTS || 'artifacts/supplies-review';
const f=await fixture(),errors=[];
const bundle=await build({stdin:{contents:'import {EquipmentUI} from "./src/equipment-ui.js"; window.SupplyLayoutUI=EquipmentUI;',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',target:'es2017'});
const separate=(a,b)=>a.x+a.width<=b.x+1 || b.x+b.width<=a.x+1 || a.y+a.height<=b.y+1 || b.y+b.height<=a.y+1;
async function bounds(page,selector,size) {
  const b=await page.locator(selector).boundingBox(); assert.ok(b,`${selector} visible`);
  assert.ok(b.x>=0&&b.y>=0&&b.x+b.width<=size.width+1&&b.y+b.height<=size.height+1,`${selector} within viewport: ${JSON.stringify(b)}`);return b;
}
try {
  await mkdir(artifacts,{recursive:true});
  for(const size of [{width:854,height:480},{width:1200,height:700},{width:1280,height:720}]) for(const scale of [1,1.3]) for(const legacy of [false,true]) {
    const label=`${size.width}-${scale}-${legacy?'legacy':'modern'}`,context=await f.browser.newContext({viewport:size,hasTouch:true});
    if(legacy)await emulateLegacyWebView(context);
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    try {
      await page.goto(f.base);await page.locator('#home-settings').tap();await page.locator('#control-size').fill(String(scale));await page.locator('#settings-done').tap();
      await page.locator('#home-solo').tap();await page.waitForSelector('body[data-mode="playing"]');await page.locator('#pause-button').tap();
      await context.route('**/supply-layout-fixture.js',route=>route.fulfill({contentType:'application/javascript',body:bundle.outputFiles[0].text}));
      await page.addScriptTag({url:`${f.base}/supply-layout-fixture.js`});
      // Isolated UI renderer fixture, explicitly NOT pickup/gameplay evidence.
      await page.evaluate(()=>{
        document.getElementById('pause-screen').hidden=true;
        const view={owned:['m4a1','ak47','mp5','barrett'].map(weaponId=>({weaponId,ammo:20,reserve:480})),activeGunId:'m4a1',heldItem:'gun',knife:true,
          grenades:{frag:1,smoke:1,flash:1},selectedGrenade:'frag',supplies:{health:3,armour:3},supplyUse:{type:'armour',remaining:3.5},
          health:100,armour:50,lifeId:1,roundId:'fixture',alive:true};
        document.getElementById('inventory-slots').textContent='';
        window.__supplyLayout=new window.SupplyLayoutUI({getView:()=>view,canSelectInventory:()=>true,onAction(){throw new Error('Layout fixture must not issue gameplay actions');},onToast(){},onPicker(){}});
        window.__supplyLayout.render();document.getElementById('armour-count').textContent='50';document.getElementById('armour-bar').style.width='50%';
      });
      const inventory=await bounds(page,'#loot-inventory',size),progress=await bounds(page,'#supply-use-status',size),strip=await bounds(page,'#inventory-slots',size);
      assert.ok(separate(progress,strip),'progress must not cover swipe area');
      for(const selector of ['.health-panel','.score-panel','.hud-actions','.move-control','.combat-controls','.equipment-controls','.ammo-panel'])
        assert.ok(separate(inventory,await bounds(page,selector,size)),`${label}: inventory overlaps ${selector}`);
      await bounds(page,'#armour-count',size);await bounds(page,'#armour-bar',size);
      assert.ok(separate(await bounds(page,'.health-panel',size),await bounds(page,'.score-panel',size)),`${label}: vitals and score separated`);
      assert.ok(await page.locator('#inventory-slots').evaluate(el=>el.scrollWidth>el.clientWidth),'full inventory scrolls');
      await page.locator('#inventory-slots').evaluate(el=>{el.scrollLeft=el.scrollWidth;});
      const last=await bounds(page,'[data-inventory-key="supply:armour"]',size);assert.ok(last.x>=strip.x && last.x+last.width<=strip.x+strip.width+1);
      await page.screenshot({path:`${artifacts}/fixture-supply-layout-${label}.png`});console.log(`PASS isolated supply layout ${label}`);
    } catch(error){await page.screenshot({path:`${artifacts}/fixture-layout-failure-${label}.png`});throw error;}
    finally{await context.close();}
  }
  assert.deepEqual(errors,[]); f.clean();
} finally {await f.close();}

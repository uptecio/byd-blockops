import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { fixture } from './helpers/loot-browser.js';
import { emulateLegacyWebView } from './helpers/legacy-webview.js';

const artifacts=process.env.ZOMBIE_ARTIFACTS || 'artifacts/zombies-review';
const f=await fixture(), errors=[];
const bundle=await build({ stdin:{ contents:'import {renderMatchHud,renderMatchResults} from "./src/match-ui.js"; window.__zombieLayout={hud:renderMatchHud,results:renderMatchResults};',resolveDir:process.cwd() },bundle:true,write:false,format:'iife',target:'es2017' });
const separated=(a,b)=>a.x+a.width<=b.x+1 || b.x+b.width<=a.x+1 || a.y+a.height<=b.y+1 || b.y+b.height<=a.y+1;
async function bounds(page,selector,size) {
  const box=await page.locator(selector).boundingBox();
  assert.ok(box,`${selector} visible`);
  assert.ok(box.x>=0 && box.y>=0 && box.x+box.width<=size.width+1 && box.y+box.height<=size.height+1,`${selector} within ${size.width}x${size.height}: ${JSON.stringify(box)}`);
  return box;
}
try {
  await mkdir(artifacts,{recursive:true});
  for(const size of [{width:1280,height:720},{width:1200,height:700},{width:854,height:480}])
    for(const scale of [1,1.3]) for(const legacy of [false,true]) for(const safe of [false,true]) {
      const label=`${size.width}-${scale}-${legacy?'legacy':'modern'}-${safe?'safe':'ordinary'}`;
      const context=await f.browser.newContext({viewport:size,hasTouch:true});
      if(legacy) await emulateLegacyWebView(context);
      await context.route('**/styles.css',async route=>{
        const response=await route.fetch(); let css=await response.text();
        if(safe) css=css.replace(/env\(safe-area-inset-(top|left|right|bottom)(?:\s*,\s*[^)]+)?\)/g,(_,edge)=>({top:'18px',left:'24px',right:'24px',bottom:'12px'})[edge]);
        if(legacy) css=css.replace(/(^|[;{])\s*([-\w]+)\s*:\s*([^;{}]+)(?=;|})/g,(d,b,p,v)=>p==='inset'||/\b(?:min|max|clamp)\s*\(/.test(v)?b:d);
        await route.fulfill({response,body:css});
      });
      const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
      try {
        await page.goto(f.base);
        assert.equal(await page.locator('[data-mode-id]').count(),4,'Zombies Home option present');
        await page.locator('[data-mode-id="zombies"]').tap();
        for(const selector of ['#home-solo','#home-online','#home-settings','[data-mode-id="zombies"]']) await bounds(page,selector,size);
        await page.locator('#home-settings').tap(); await page.locator('#control-size').fill(String(scale)); await page.locator('#settings-done').tap();
        await page.locator('#home-solo').tap(); await page.waitForSelector('body[data-mode="playing"]');
        const inventory=await bounds(page,'#loot-inventory',size);
        for(const selector of ['#home-button','#pause-button','#fire-button','.score-panel','.health-panel','.ammo-panel'])
          assert.ok(separated(inventory,await bounds(page,selector,size)),`inventory separated from ${selector}: ${label}`);
        await page.evaluate(()=>{window.__inventoryAimMoves=0;document.getElementById('aim-zone').addEventListener('pointermove',()=>window.__inventoryAimMoves++);});
        const before=await page.locator('#ammo-count').textContent(), strip=await page.locator('#inventory-slots').boundingBox();
        const cdp=await context.newCDPSession(page),point={x:strip.x+80,y:strip.y+strip.height/2,id:9};
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,x:point.x-50}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await cdp.detach();
        assert.equal(await page.evaluate(()=>window.__inventoryAimMoves),0); assert.equal(await page.locator('#ammo-count').textContent(),before);
        await page.locator('#pause-button').click();
        await page.waitForSelector('body[data-mode="paused"]');
        await page.screenshot({path:`${artifacts}/layout-game-${label}.png`});
        // Isolated renderer fixtures, not evidence of playing/clearing waves.
        await context.route('**/zombie-layout-fixture.js',route=>route.fulfill({contentType:'application/javascript',body:bundle.outputFiles[0].text}));
        await page.addScriptTag({url:`${f.base}/zombie-layout-fixture.js`});
        const rendered=await page.evaluate(()=>{
          document.getElementById('pause-screen').hidden=true;
          const view={modeId:'zombies',mapId:'courtyard',players:[{id:'local',kills:12,deaths:1}],survival:{wave:3,completedWaves:2,kills:12,remaining:0,phase:'recovery',recoveryRemaining:10}};
          window.__zombieLayout.hud(view,'local'); window.__zombieFixtureView=view;
          return {mode:document.body.dataset.mode,timer:document.getElementById('timer').textContent,hidden:document.getElementById('objective-status').hidden};
        });
        console.log('FIXTURE',label,rendered);
        const score=await bounds(page,'.score-panel',size), actions=await bounds(page,'.hud-actions',size),health=await bounds(page,'.health-panel',size);
        assert.ok(separated(score,actions) && separated(score,health),`${label}: wave/recovery HUD separated`);
        assert.ok(separated(inventory,await bounds(page,'#objective-status',size)),`${label}: recovery message separated from inventory`);
        await page.screenshot({path:`${artifacts}/fixture-recovery-${label}.png`});
        await page.evaluate(()=>{
          document.getElementById('results-screen').hidden=false;
          window.__zombieLayout.results(window.__zombieFixtureView,'local',{best:{waves:2,kills:14}});
        });
        for(const selector of ['#again-button','#results-home','#zombie-best']) await bounds(page,selector,size);
        await page.screenshot({path:`${artifacts}/fixture-results-${label}.png`});
        await page.evaluate(()=>{
          const view={modeId:'ffa',timeLeft:180,winnerId:'local',winnerTeamId:null,players:[{id:'local',kills:15,deaths:2}]};
          window.__zombieLayout.hud(view,'local');window.__zombieLayout.results(view,'local');
        });
        assert.equal(await page.locator('#timer').textContent(),'03:00'); assert.equal(await page.locator('#result-deaths-label').textContent(),'DEATHS');
        assert.equal(await page.locator('#zombie-best').isHidden(),true);
        console.log(`PASS zombie layout ${label}`);
      } catch(error) {await page.screenshot({path:`${artifacts}/layout-failure-${label}.png`});throw error;}
      finally {await context.close();}
    }
  assert.deepEqual(errors,[]); f.clean(); console.log('PASS 24 zombie layout profiles; recovery/results images are renderer fixtures.');
} finally {await f.close();}

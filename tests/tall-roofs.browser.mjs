import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { MAPS } from '../src/maps.js';
import { fixture, until } from './helpers/loot-browser.js';
import { sampleLadder } from '../src/access-schema.js';
import {createSpatialWorld,supportBelow} from '../src/spatial.js';
import { goHome } from './helpers/progression-browser.js';
import { observeGame, followRoute, assertRendered, aimAt, defendAgainstVisibleEnemy, touchControls } from './helpers/traversal-browser.js';

const legacy=process.env.LEGACY_WEBVIEW==='1';
const dir=process.env.ARTIFACT_DIR||`artifacts/tall-roofs-${legacy?'legacy':'modern'}`;
await mkdir(dir,{recursive:true});
const f=await fixture({width:1200,height:700},{legacy}),page=f.pages[0];
const evidence={distDir:process.env.DIST_DIR,legacy,browser:f.browser.version(),routes:[],errors:[]};
let observation;
try {
  await page.goto(f.base);
  await page.locator('#home-settings').tap();
  await page.locator('#bots').fill('1'); await page.locator('#difficulty').selectOption('easy');
  await page.locator('#sound').uncheck(); await page.locator('#settings-done').tap();
  // Ladder first makes the missing vertical driver fail promptly on RED.
  const maps=[...MAPS].sort((a,b)=>Number(b.id==='harbor')-Number(a.id==='harbor'));
  for(const map of process.env.ROOF_LAYOUT_ONLY==='1'?[]:maps) for(const [index,roof] of map.traversal.roofs.entries()) {
    if(process.env.ROOF_FILTER && !roof.id.includes(process.env.ROOF_FILTER))continue;
    const touch=legacy?index%2!==0:index%2===0;
    await page.locator(`[data-map="${map.id}"]`).tap();
    await page.locator('[data-mode-id="ffa"]').tap(); await page.locator('#home-solo').tap();
    await page.waitForSelector('body[data-mode="playing"]'); observation=await observeGame(page);
    const initial=await observation.actor();
    assert.equal(initial.ladderId,null,'passive observer reports actual reset attachment');
    const links=map.traversal.links.filter(l=>l.routeId===roof.routeId);
    assert.ok(links.length,`${roof.id}: authored route`);
    const defend=()=>defendAgainstVisibleEnemy(page,observation,map);
    // Long switchbacks plus real digital-key settling can exceed one minute
    // under concurrent software rendering. Keep exact landing assertions;
    // allow wall-clock headroom without accelerating the game simulation.
    const options={map,touch,defend,timeout:120000};
    const approach=await followRoute(page,observation.actor,[links[0].from],options);
    const up=await followRoute(page,observation.actor,[roof.point],options);
    assert.equal(up.samples.at(-1).supportId,roof.supportId);
    assert.equal(up.inputs.some(i=>i.jump),roof.style==='jump',`${roof.id}: style-appropriate ascent inputs`);
    assert.equal(up.samples.some(s=>!!s.ladderId),roof.style==='ladder',`${roof.id}: actual attachment`);
    const rendered=await assertRendered(page,observation,roof.id);
    await aimAt(page,observation.actor,Math.atan2(rendered.player.x,rendered.player.z),-.3);
    await page.screenshot({path:`${dir}/${roof.id.replaceAll(':','-')}-${touch?'touch':'keys'}.png`});
    const world=createSpatialWorld(map);
    const down=await followRoute(page,observation.actor,[...links].reverse().map(l=>({...l.from,kind:l.kind,descending:true,supportId:l.fromSupportId??supportBelow(l.from,.34,world)?.id})),options);
    assert.equal(down.samples.at(-1).supportId,'ground');
    assert.equal(down.samples.at(-1).ladderId,null);
    assert.equal(down.samples.some(s=>!!s.ladderId),roof.style==='ladder',`${roof.id}: descent uses authored ladder, not a drop`);
    f.clean();
    evidence.routes.push({mapId:map.id,id:roof.id,source:roof.source,style:roof.style,touch,approach,up,down,rendered,errorsChecked:true});
    await writeFile(`${dir}/evidence.json`,JSON.stringify(evidence,null,2));
    await observation.close();observation=null; await goHome(page);
    console.log(`PASS ${roof.id}: ${touch?'touch':'keyboard'} ${roof.style} up/down`);
  }
  const expected=process.env.ROOF_LAYOUT_ONLY==='1'?[]:MAPS.flatMap(m=>m.traversal.roofs).filter(r=>!process.env.ROOF_FILTER||r.id.includes(process.env.ROOF_FILTER));
  if(process.env.ROOF_LAYOUT_ONLY!=='1')assert.ok(expected.length>0,'filter must select an actual roof');
  assert.deepEqual(new Set(evidence.routes.map(r=>r.id)),new Set(expected.map(r=>r.id)),'no omitted destinations');
  if(!process.env.ROOF_FILTER&&process.env.ROOF_LAYOUT_ONLY!=='1')assert.equal(evidence.routes.length,62,'all original and annex roofs');
  evidence.layouts=[];
  if(!process.env.ROOF_FILTER)for(const size of [{width:854,height:480},{width:1200,height:700},{width:1280,height:720}])for(const scale of [1,1.3]) {
    const label=`${size.width}-${scale}`,map=MAPS.find(m=>m.id==='harbor');
    const ladder=map.traversal.ladders.find(l=>l.routeId==='harbor:original:container-4:approach');
    await page.setViewportSize(size);await page.locator('#home-settings').tap();await page.locator('#control-size').fill(String(scale));await page.locator('#settings-done').tap();
    await page.locator('[data-map="harbor"]').tap();await page.locator('#home-solo').tap();await page.waitForSelector('body[data-mode="playing"]');
    observation=await observeGame(page);
    const trace=await followRoute(page,observation.actor,[{...sampleLadder(ladder,1.2),ladderId:ladder.id}],{map});
    const before=await observation.actor();assert.equal(before.ladderId,ladder.id);
    await page.waitForTimeout(300);assert.ok(Math.abs((await observation.actor()).y-before.y)<.01,'release holds ladder');
    await aimAt(page,observation.actor,before.yaw+1.2,-.3);
    assert.ok(Math.abs((await observation.actor()).y-before.y)<.01,'aim independent of climb');
    assert.equal(await page.locator('#climb-hint').textContent(),'Climbing · Jump to let go');
    const bounds={};
    for(const selector of ['#climb-hint','#fire-button','#jump-button','#joystick','#loot-inventory']) {
      const box=await page.locator(selector).boundingBox();assert.ok(box,`${label}: ${selector} visible`);
      assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=size.width+1&&box.y+box.height<=size.height+1,`${label}: ${selector} fits`);bounds[selector]=box;
    }
    const hint=bounds['#climb-hint'];
    for(const [selector,b] of Object.entries(bounds))if(selector!=='#climb-hint')assert.ok(hint.x+hint.width<=b.x||b.x+b.width<=hint.x||hint.y+hint.height<=b.y||b.y+b.height<=hint.y,`${label}: hint avoids ${selector}`);
    assert.equal(await page.locator('#climb-hint').evaluate(e=>getComputedStyle(e).pointerEvents),'none','hint cannot steal aim input');
    const controls=await touchControls(page),inputs=[];
    try {
      const stick=await controls.point('#joystick',71),fire=await controls.point('#fire-button',72),jump=await controls.point('#jump-button',73);
      const radius=(await page.locator('#joystick').boundingBox()).width*.34,moved={...stick,y:stick.y-radius};
      await controls.send('touchStart',[stick,fire]);inputs.push({type:'touchStart',move:0,fire:true});
      await controls.send('touchMove',[moved,fire]);inputs.push({type:'touchMove',move:1,fire:true});
      await until(async()=>(await observation.actor()).y>before.y+.2,'climb and Fire together');
      await controls.send('touchEnd',[moved]);inputs.push({type:'touchEnd',released:'joystick',move:0,fire:true});
      await until(async()=>{const s=await observation.read();return s.input.move.y===0&&s.input.fire;},'release only stick preserves Fire');
      const held=await observation.read();await page.waitForTimeout(250);const firing=await observation.read();
      assert.ok(Math.abs(firing.player.y-held.player.y)<.01);assert.ok(firing.ammo<held.ammo,'Fire continues after independent movement release');
      await controls.send('touchCancel');inputs.push({type:'touchCancel',move:0,fire:false});
      await until(async()=>(await observation.read()).input.fire===false,'cancel releases Fire');
      const ammo=(await observation.read()).ammo;await page.locator('#reload-button').tap();
      await until(async()=>(await observation.read()).ammo>ammo,'reload while holding ladder');
      assert.equal((await observation.actor()).ladderId,ladder.id);
      await page.screenshot({path:`${dir}/ladder-${label}.png`});
      await controls.send('touchStart',[jump]);inputs.push({type:'touchStart',jump:true});await controls.send('touchEnd');
      await until(async()=>(await observation.actor()).ladderId===null,'touch Jump detaches');
      await until(async()=>(await observation.actor()).grounded,'released climber lands normally');
      evidence.layouts.push({label,bounds,trace,inputs,held,firing,landed:await observation.actor()});
    }finally{await controls.send('touchCancel').catch(()=>{});await controls.close();}
    await observation.close();observation=null;await goHome(page);console.log(`PASS ladder hold/aim/Fire/reload/cancel/Jump ${label}`);
  }
  f.clean();
} catch(error) {
  evidence.errors.push(error.stack);evidence.failureTrace=error.routeTrace; await page.screenshot({path:`${dir}/failure.png`}).catch(()=>{}); throw error;
} finally {
  await writeFile(`${dir}/evidence.json`,JSON.stringify(evidence,null,2));
  await observation?.close().catch(()=>{}); await f.close();
}

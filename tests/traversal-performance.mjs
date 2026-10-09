import assert from 'node:assert/strict';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { fixture } from './helpers/loot-browser.js';
import { goHome } from './helpers/progression-browser.js';
import { observeGame,captureEightZombies } from './helpers/traversal-browser.js';

const dir=process.env.ARTIFACT_DIR||'artifacts/tall-roofs-performance';await mkdir(dir,{recursive:true});
assert.ok(process.env.DIST_DIR,'exact candidate DIST_DIR required');
const variants=[{label:'baseline',source:process.env.BASELINE_SOURCE_DIR||'artifacts/rooftops-hiding-zQylUE/release-source',dist:process.env.BASELINE_DIST_DIR||'artifacts/rooftops-hiding-zQylUE/reviewed-dist'},
  {label:'candidate',source:process.env.CANDIDATE_SOURCE_DIR||resolve(process.env.DIST_DIR,'..','release-source'),dist:process.env.DIST_DIR}];
const evidence={limitations:['SwiftShader software-renderer measurements on this host, not BYD FPS guarantees.','Baseline0.8 has no conservative roof audit or navigation.stats; unavailable fields are explicitly null.'],variants:[],errors:[]};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const imports=[];
for(const v of variants) {
  const start=performance.now(),load=file=>import(pathToFileURL(resolve(v.source,'src',file)));
  const maps=await load('maps.js'),coldImportMs=performance.now()-start;
  const navigation=await load('navigation.js'),traversal=await load('map-traversal.js'),spatial=await load('spatial.js');
  const version=JSON.parse(await readFile(resolve(v.source,'package.json'),'utf8')).version;
  assert.equal(version,v.label==='baseline'?'0.8.0':'0.9.0','matched true retained baseline and candidate');
  imports.push({...v,...maps,...navigation,...traversal,...spatial});
  const assets={};for(const file of ['index.html','game.js','styles.css','THREE-LICENSE.txt'])assets[file]=sha(await readFile(resolve(v.dist,file)));
  evidence.variants.push({...v,version,coldImportMs,assets,maps:[],rendering:{}});
}
try {
  for(const map of imports[1].MAPS) {
    const corresponding=imports.map(v=>v.MAPS.find(m=>m.id===map.id)),worlds=imports.map((v,i)=>v.createSpatialWorld(corresponding[i])),pool=[];
    for(let z=-21;z<=21;z+=.5)for(let x=-21;x<=21;x+=.5) {
      const point={x,y:0,z};if(imports.every((v,i)=>v.canOccupyBody(point,.42,1.84,worlds[i])))pool.push(point);
    }
    const goals=Array.from({length:64},(_,i)=>pool[Math.floor(i*pool.length/64)]);
    assert.equal(new Set(goals.map(g=>`${g.x}:${g.z}`)).size,64);
    for(const [index,v] of imports.entries()) {
      const trials=[],current=corresponding[index];
      for(let trial=0;trial<3;trial++) {
        let start=performance.now();const validation=v.validateTraversal(current),validationMs=performance.now()-start;assert.equal(validation.ok,true,JSON.stringify(validation.errors));
        start=performance.now();const nav=v.createNavigation(current,{radius:.42}),navigationMs=performance.now()-start;
        nav.clearCache();start=performance.now();
        for(const goal of goals)assert.ok(nav.nextWaypoint({...current.playerSpawn,y:0,grounded:true},goal),`${v.label} ${map.id} shared ground goal`);
        const coldQueriesMs=performance.now()-start,stats=nav.stats?.()||null;
        if(index===1){assert.ok(stats.nodes<=40000);assert.equal(stats.cachedFields,32);}
        start=performance.now();for(const goal of goals.slice(32))nav.nextWaypoint({...current.playerSpawn,y:0,grounded:true},goal);
        trials.push({validationMs,navigationMs,coldQueriesMs,hotQueriesMs:performance.now()-start,stats});
      }
      evidence.variants[index].maps.push({mapId:map.id,solids:worlds[index].solids.length,goals,goalsSha:sha(JSON.stringify(goals)),trials});
    }
  }
  for(const [index,v] of imports.entries()) {
    process.env.DIST_DIR=v.dist;const f=await fixture({width:1200,height:700}),page=f.pages[0],record=evidence.variants[index].rendering;
    let observation;
    try {
      await page.goto(f.base);await page.locator('#home-settings').tap();await page.locator('#bots').fill('8');await page.locator('#difficulty').selectOption('easy');await page.locator('#sound').uncheck();await page.locator('#settings-done').tap();
      record.cycles=[];
      for(let cycle=0;cycle<3;cycle++)for(const map of v.MAPS) {
        await page.locator(`[data-map="${map.id}"]`).tap();await page.locator('[data-mode-id="ffa"]').tap();await page.locator('#home-solo').tap();await page.waitForSelector('body[data-mode="playing"]');
        observation=await observeGame(page);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
        record.cycles.push({cycle,mapId:map.id,state:await observation.read(),gl:await page.evaluate(()=>window.__lootObservation)});
        await observation.close();observation=null;await goHome(page);
      }
      for(const map of v.MAPS) {
        const rows=record.cycles.filter(r=>r.mapId===map.id);
        for(const kind of ['Buffer','Texture','Program'])assert.ok((rows[2].gl.live[kind]||0)<=(rows[1].gl.live[kind]||0)+12,`${v.label} ${map.id} bounded ${kind}`);
        for(const kind of ['geometries','textures','materials'])assert.ok(rows[2].state.memory[kind]<=rows[1].state.memory[kind]+12,`${v.label} ${map.id} bounded ${kind}`);
      }
      record.botAttempts=[];
      for(let attempt=0;attempt<5&&!record.bots;attempt++) {
        await page.locator('[data-map="courtyard"]').tap();await page.locator('[data-mode-id="ffa"]').tap();await page.locator('#home-solo').tap();await page.waitForSelector('body[data-mode="playing"]');
        observation=await observeGame(page);const before=await observation.read(),frames=await observation.recordFrames(4),after=await observation.read();
        const sample={before,frames,after};record.botAttempts.push(sample);
        if(frames.rows.every(r=>r.alive===9&&r.health>0&&r.lifeId===before.player.lifeId))record.bots=sample;
        await observation.close();observation=null;await goHome(page);
      }
      assert.ok(record.bots,`${v.label}: maximum eight bots throughout sample`);
      record.zombieAttempts=[];
      for(let attempt=0;attempt<3&&!record.zombies;attempt++) {
        await page.locator('[data-mode-id="zombies"]').tap();await page.locator('#home-solo').tap();await page.waitForSelector('body[data-mode="playing"]');
        observation=await observeGame(page);const sample=await captureEightZombies(page,observation,v.MAPS.find(m=>m.id==='courtyard'));record.zombieAttempts.push(sample);
        if(sample.valid)record.zombies=sample;
        await page.screenshot({path:`${dir}/${v.label}-zombies-${attempt}.png`});await observation.close();observation=null;await goHome(page);
      }
      assert.ok(record.zombies,`${v.label}: eight zombies including runner and living player throughout sample`);f.clean();
      console.log(`PASS ${v.label}: matched map timings, bounded three-cycle resources, maximum bots/zombies`);
    }finally{await observation?.close().catch(()=>{});await f.close();await writeFile(`${dir}/evidence.json`,JSON.stringify(evidence,null,2));}
  }
}catch(error){evidence.errors.push(error.stack);throw error;}
finally{await writeFile(`${dir}/evidence.json`,JSON.stringify(evidence,null,2));process.env.DIST_DIR=variants[1].dist;}

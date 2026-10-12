import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fixture,walkSolo,until} from './loot-browser.js';
import {setupSolo,goHome,readProfile} from './progression-browser.js';
import {openPowers,choosePowers} from './solo-powers-browser.js';
import {observeGame,followRoute,aimAt,defendAgainstVisibleEnemy} from './traversal-browser.js';
import {MAPS} from '../../src/maps.js';
import {sampleLadder} from '../../src/access-schema.js';
import {createNavigation} from '../../src/navigation.js';
import {startServer} from '../../server/server.mjs';

const off={invincible:false,unlimitedAmmo:false,superSpeed:false,speedMultiplier:2};
const powered=speed=>({invincible:true,unlimitedAmmo:true,superSpeed:speed!==1,speedMultiplier:speed===1?2:speed});
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];

// Real controls plus read-only arena observations. Removing any solo gate,
// speed multiplier/collision path, reset, or wave reward breaks these checks.
export async function runArenaAcceptance({artifactDir,legacy=false,performance=true}={}) {
  const artifacts=resolve(artifactDir||'artifacts/solo-powers-browser','arena');await mkdir(artifacts,{recursive:true});
  const f=await fixture({width:1024,height:600},{legacy}),page=f.pages[0];let observation;
  const evidence={maps:[],movement:[],traversal:[],frames:[]};
  async function start(mapId,modeId,config) {
    await page.locator(`[data-map="${mapId}"]`).click();await page.locator(`[data-mode-id="${modeId}"]`).click();
    await openPowers(page,{pin:'0427'});await choosePowers(page,config);
    await page.locator('#home-solo').click();await page.waitForSelector('body[data-mode="playing"]');
    observation=await observeGame(page);
  }
  async function home() {await observation?.close();observation=null;await goHome(page);}
  try {
    await page.goto(f.base);await setupSolo(page);
    await openPowers(page,{pin:'0427',firstSetup:true});await choosePowers(page,off);
    const pinRecord=await page.evaluate(()=>localStorage.getItem('block-ops-solo-powers-pin-v1'));
    const other=await startServer({port:0,distDir:process.env.DIST_DIR||'dist'});
    try {
      await page.goto(`http://127.0.0.1:${other.port}`);
      assert.equal(await page.evaluate(()=>localStorage.getItem('block-ops-solo-powers-pin-v1')),null,'PIN is origin-local');
      await page.goto(f.base);assert.equal(await page.evaluate(()=>localStorage.getItem('block-ops-solo-powers-pin-v1')),pinRecord,'original verifier is preserved');
    } finally {await other.close();}
    for(const [index,map] of MAPS.entries())for(const enabled of [false,true]) {
      const modeId=['ffa','tdm','ctf','zombies'][index%4];
      await start(map.id,modeId,enabled?powered(5):off);
      const before=await observation.read();
      await page.keyboard.press('KeyF',{delay:180});
      const after=await observation.read();
      assert.equal(after.mapId,map.id);assert.equal(after.modeId,modeId);assert.ok(after.active&&after.drawCalls>0);
      assert.equal(await page.locator('#ammo-count').textContent()==='∞',enabled);
      if(enabled)assert.equal(after.ammo,before.ammo);else assert.ok(after.ammo<before.ammo,'normal shot consumes ammo');
      assert.equal(await page.locator('#fatal-screen').isVisible(),false);
      evidence.maps.push({map:map.id,modeId,enabled,ammoBefore:before.ammo,ammoAfter:after.ammo});
      await home();
    }
    console.log('PASS all 8 maps, all 4 solo modes, powered/unpowered real shots');
    for(const mapId of ['courtyard','harbor']) {
      const rows=[];
      for(const speed of [1,2,5]) {
        await start(mapId,'ffa',powered(speed));
        const before=await observation.read();await walkSolo(page,'KeyW',.75*5.3*speed,5.3*speed);const after=await observation.read();
        const distance=Math.hypot(after.player.x-before.player.x,after.player.z-before.player.z),seconds=after.simulationTime-before.simulationTime;
        assert.ok(distance>0&&seconds>0);rows.push({speed,distance,seconds,rate:distance/seconds});await home();
      }
      for(const row of rows.slice(1))assert.ok(Math.abs(row.rate/rows[0].rate-row.speed)<.5,`${mapId}: actual ${row.speed}x speed follows simulation time`);
      evidence.movement.push({mapId,rows});console.log(`PASS ${mapId} measured movement ${JSON.stringify(rows)}`);
      await start(mapId,'ffa',powered(5));
      await walkSolo(page,'KeyW',100,26.5);let actor=await observation.actor();
      assert.ok(actor.z>=-21.661&&actor.z<-21.5,'5x stops at north outer wall');
      evidence.traversal.push({mapId,kind:'outer-wall',actor});await home();
    }
    const courtyard=MAPS.find(map=>map.id==='courtyard');await start('courtyard','ffa',powered(5));
    await followRoute(page,observation.actor,[{x:6,y:0,z:10}],{map:courtyard,speed:26.5});
    await aimAt(page,observation.actor,0);await walkSolo(page,'KeyW',15,26.5);
    let actor=await observation.actor();assert.ok(actor.z>=7.889&&actor.z<8.1,'5x cannot cross low wall');
    evidence.traversal.push({mapId:'courtyard',kind:'low-wall',actor});await home();
    await start('courtyard','ffa',powered(5));
    const roofRoute=await followRoute(page,observation.actor,[{x:19,y:2.2,z:-7}],{map:courtyard,speed:26.5});
    await aimAt(page,observation.actor,0);await walkSolo(page,'KeyW',15,26.5);
    actor=await observation.actor();assert.ok(actor.z>=-8.311&&actor.z<-8.1&&Math.abs(actor.y-2.2)<.01,'roof parapet retains powered player');
    evidence.traversal.push({mapId:'courtyard',kind:'stairs-roof',actor,trace:roofRoute});await home();
    const harbor=MAPS.find(map=>map.id==='harbor'),ladder=harbor.traversal.ladders.find(l=>l.id==='harbor:original:container-4:approach:ladder');
    const climbs=[];
    for(const speed of [1,5]) {
      await start('harbor','ffa',powered(speed));
      const trace=await followRoute(page,observation.actor,[{...sampleLadder(ladder,1.2),ladderId:ladder.id}],{map:harbor,speed:5.3*speed});
      const held=await observation.actor();await page.waitForTimeout(200);assert.ok(Math.abs((await observation.actor()).y-held.y)<.01,'neutral holds ladder');
      const before=await observation.read();await walkSolo(page,'KeyW',.4*5.3,5.3);const after=await observation.read();
      assert.equal(after.player.ladderId,ladder.id);const rate=(after.player.y-before.player.y)/(after.simulationTime-before.simulationTime);
      assert.ok(Math.abs(rate-2.4)<.4,'horizontal power does not multiply ladder climb');climbs.push({speed,rate,trace});await home();
    }
    evidence.traversal.push({kind:'ladder-normal-vs-5x',climbs});
    await start('neon-city','zombies',powered(1));const previousXP=(await readProfile(page)).lifetimeXP;
    const map=MAPS.find(m=>m.id==='neon-city'),navigation=createNavigation(map,{radius:.34}),deadline=Date.now()+180000;
    while(Date.now()<deadline) {
      const state=await observation.read();if(state.phase==='recovery')break;
      const inputs=await defendAgainstVisibleEnemy(page,observation,map);
      if(!inputs.length) {
        const enemy=state.actors.filter(a=>a.enemy&&a.alive).sort((a,b)=>Math.hypot(a.x-state.player.x,a.z-state.player.z)-Math.hypot(b.x-state.player.x,b.z-state.player.z))[0];
        const next=enemy&&navigation.nextWaypoint(state.player,enemy);
        if(next)await followRoute(page,observation.actor,[next],{map,timeout:10000});else await page.waitForTimeout(150);
      }
    }
    const cleared=await observation.read();assert.equal(cleared.phase,'recovery');assert.equal(cleared.wave,1);
    assert.equal((await readProfile(page)).lifetimeXP-previousXP,35,'5 kills at 2 XP + 25 wave XP, no completion bonus');
    const record=await page.evaluate(()=>JSON.parse(localStorage.getItem('block-ops-zombies-v1')));
    assert.deepEqual(record['neon-city'],{waves:1,kills:5});
    evidence.zombies={cleared,record,xpDelta:35};await home();
    assert.equal((await readProfile(page)).lifetimeXP-previousXP,35,'early departure keeps action XP only');
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('block-ops-zombies-v1'))),record,'ordinary best record survives quit');
    console.log('PASS genuine assisted Zombie wave earns 35 XP and saves ordinary map record');
    if(performance)for(const mapId of ['courtyard','harbor']) {
      const pairs=[];
      for(let trial=0;trial<3;trial++) {
        const pair={trial,mapId};
        for(const speed of trial%2?[5,1]:[1,5]) {
          await start(mapId,'ffa',powered(speed));
          await walkSolo(page,'KeyW',60,5.3*speed); // reach wall and warm the actual movement/collision/render path
          await page.keyboard.down('KeyW');let frames;
          try {frames=await observation.recordFrames(30);}finally{await page.keyboard.up('KeyW');}
          assert.ok(frames.count>=30&&frames.rows.every(row=>row.health===100),'live player through full 30-second sample');
          pair[speed]=frames;console.log(`FRAMES ${mapId} trial${trial+1} ${speed}x median=${frames.medianMs.toFixed(2)}ms p95=${frames.p95Ms.toFixed(2)}ms`);await home();
        }
        pair.ratio=pair[5].p95Ms/pair[1].p95Ms;pairs.push(pair);
        evidence.frames.push(pair);await writeFile(`${artifacts}/evidence.json`,JSON.stringify(evidence,null,2));
      }
      const ratio=median(pairs.map(p=>p.ratio));console.log(`PAIRED ${mapId} median p95 ratio=${ratio.toFixed(3)}`);
      assert.ok(ratio<=1.25,`${mapId} paired p95 ratio ${ratio} requires investigation (>1.25)`);
    }
    await writeFile(`${artifacts}/evidence.json`,JSON.stringify(evidence,null,2));f.clean();
  } catch(error){await writeFile(`${artifacts}/evidence.json`,JSON.stringify(evidence,null,2));await page.screenshot({path:`${artifacts}/failure.png`});throw error;}
  finally {await observation?.close();await f.close();}
}

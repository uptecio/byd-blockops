import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fixture, freshSolo, walkSolo, onlinePair, moveTo, lookTo, lookAt, until, equip } from './helpers/loot-browser.js';
import { MAPS } from '../src/maps.js';
import { LOOT_SPAWNS } from '../src/loot-spawns.js';
import { followRoute,observeGame,aimAt } from './helpers/traversal-browser.js';
import { createSpatialWorld,segmentClear } from '../src/spatial.js';

const legacy = process.env.LEGACY_WEBVIEW === '1';
const artifacts = process.env.SUPPLY_ARTIFACTS || 'artifacts/supplies-review';
const f = await fixture({ width:1200,height:700 }, { legacy }), page = f.pages[0], otherPage = f.pages[1];
const slot = (p,type) => p.locator(`[data-inventory-key="supply:${type}"]`);
const count = async (p,type) => Number((await slot(p,type).locator('.inventory-count').textContent()).slice(1));
const seconds = () => page.evaluate(() => window.__lootObservation.seconds);
async function home(p = page) { await p.locator('#home-button').tap(); await p.locator('#confirm-home').tap(); }
async function leavePair() { for (const p of f.pages) await home(p); }
async function collectOnline(p, peer) {
  for (const [x,z] of [[0,17],[-5,17],[5,17],[0,17]]) await moveTo(p,peer,x,z);
  await until(() => peer.equipment.supplies.health > 0 && peer.equipment.supplies.armour > 0, 'real walk collects both authored supplies');
}
async function bodyShot(p, shooter, victim) {
  const a=shooter.player,b=victim.player,dx=b.x-a.x,dz=b.z-a.z;
  await lookTo(p,shooter,Math.atan2(-dx,-dz),Math.atan2(b.y+1-(a.y+1.65),Math.hypot(dx,dz)));
  const before=victim.player.health+victim.player.armour;
  await p.keyboard.press('KeyF', { delay:25 });
  await until(() => victim.player.health+victim.player.armour < before, 'real body shot hits armour/health');
  assert.equal(victim.player.health+victim.player.armour,before-23,'G17 single body shot is exactly 23, never a lethal headshot');
  await p.waitForTimeout(250);
}
async function visibleHead() {
  const screenshot=(await page.screenshot()).toString('base64');
  await page.locator('#pause-button').tap();
  const target=await page.evaluate(async data=>{
    const image=new Image(); image.src=`data:image/png;base64,${data}`; await image.decode();
    const canvas=document.createElement('canvas'); canvas.width=image.width; canvas.height=image.height;
    const ctx=canvas.getContext('2d'); ctx.drawImage(image,0,0);
    const { width,height }=canvas,pixels=ctx.getImageData(0,0,width,height).data;
    const columns=[];
    for(let x=75;x<width-75;x++) {
      let count=0;
      for(let y=Math.floor(height/2)-8;y<height/2+10;y++) {
        const i=(y*width+x)*4,r=pixels[i],g=pixels[i+1],b=pixels[i+2];
        if(r>60 && g>100 && g>r*1.1 && g>b*1.25 && b>35) count++;
      }
      if(count>=2) columns.push({x,count});
    }
    const clusters=[];
    for(const p of columns) {
      let c=clusters[clusters.length-1];
      if(!c || p.x-c.last>4) {c={sum:0,weight:0,last:p.x}; clusters.push(c);}
      c.sum+=p.x*p.count; c.weight+=p.count; c.last=p.x;
    }
    clusters.sort((a,b)=>b.weight-a.weight);
    return clusters[0] ? { x:clusters[0].sum/clusters[0].weight,width,height } : null;
  },screenshot);
  await page.locator('#resume-button').tap();return target;
}
async function aim(dx) {
  const segments=Math.ceil(Math.abs(dx)/180);
  for(let i=0;i<segments;i++) {
    await page.mouse.move(600,240); await page.mouse.down();
    await page.mouse.move(600+dx/segments,240,{steps:2}); await page.mouse.up();
  }
}
async function aimDown(pixels) {
  const segments=Math.ceil(Math.abs(pixels)/150);
  for(let i=0;i<segments;i++) {
    await page.mouse.move(600,210);await page.mouse.down();await page.mouse.move(600,210+pixels/segments,{steps:2});await page.mouse.up();
  }
}
async function simulated(duration) {
  const started=await seconds();
  await page.waitForFunction(({started,duration})=>window.__lootObservation.seconds-started>=duration,{started,duration},{timeout:30000});
}
async function zombieRecovery() {
  await page.goto(f.base);await page.locator('[data-map="neon-city"]').tap();await page.locator('[data-mode-id="zombies"]').tap();
  await page.locator('#home-solo').tap();await page.waitForSelector('body[data-mode="playing"]');
  // Route around visible fire-escape supports rather than assuming timed
  // straight-line keys crossed them. Every pickup still uses real movement.
  const map=MAPS.find(m=>m.id==='neon-city'),view=await observeGame(page),spawns=LOOT_SPAWNS[map.id],setupTrace={combat:[],routes:[]};
  try {
    // New exterior geometry makes the observed pickup tour take longer than
    // the former timed key chord. Earn the same four real kills first; retain
    // one living walker for the unchanged contact/recovery scenario below.
    const deadline=Date.now()+120000,world=createSpatialWorld(map);
    while(true) {
      const state=await view.read(),actor=state.player;setupTrace.combat.push({at:Date.now(),...state});assert.ok(actor.health>0,'survive real preparation combat');
      if(state.queued===0&&state.activeIds===1)break;
      assert.ok(Date.now()<deadline,'real shots leave one wave-one walker');assert.equal(state.wave,1);
      const target=state.actors.filter(a=>a.enemy&&a.alive&&segmentClear({...actor,y:actor.y+1.6},{...a,y:a.y+1.58},world)).sort((a,b)=>Math.hypot(a.x-actor.x,a.z-actor.z)-Math.hypot(b.x-actor.x,b.z-actor.z))[0];
      if(target){const dx=target.x-actor.x,dz=target.z-actor.z;await aimAt(page,view.actor,Math.atan2(-dx,-dz),Math.atan2(target.y+1.58-(actor.y+1.6),Math.hypot(dx,dz)));
        if(Number(await page.locator('#ammo-count').textContent())===0)await page.keyboard.press('KeyR');else await page.keyboard.press('KeyF',{delay:25});}
      await page.waitForTimeout(80);
    }
    setupTrace.routes.push({item:'health',trace:await followRoute(page,view.actor,[{...spawns.find(p=>p.supplyType==='health'),y:0}],{map})});
    assert.equal(await count(page,'health'),1);
    setupTrace.routes.push({item:'armour',trace:await followRoute(page,view.actor,[{...spawns.find(p=>p.supplyType==='armour'),y:0}],{map})});
    assert.equal(await count(page,'armour'),1);await slot(page,'armour').tap();
    setupTrace.routes.push({item:'frag',trace:await followRoute(page,view.actor,[{...spawns.find(p=>p.grenadeType==='frag'&&p.z>0),y:0}],{map})});
    await aimAt(page,view.actor,0,0);
  }finally{setupTrace.last=await view.read();await writeFile(`${artifacts}/zombie-setup-trace.json`,JSON.stringify(setupTrace,null,2));await view.close();}
  assert.equal(await count(page,'health'),1);await page.locator('[data-inventory-key="grenade:frag"]').waitFor();
  // Stay in the clear west lane: returning toward the rear spawn walks into
  // the pursuing horde before the setup has finished.
  await until(async()=>await page.locator('#supply-use-status').isHidden(),'armour setup completes');
  console.log('ZOMBIE setup collected health/frag and used armour');
  const deadline=Date.now()+150000;await aim(Math.PI/.0026);
  try {
    while(!/1 LEFT/.test(await page.locator('.score-target').textContent())) {
      assert.ok(Date.now()<deadline,'visual controls reach final wave-one zombie');
      assert.equal(await page.locator('body').getAttribute('data-mode'),'playing');
      const target=await visibleHead();
      if(target) {
        const angle=Math.atan((target.x-target.width/2)/(target.height/(2*Math.tan(75*Math.PI/360))));
        if(Math.abs(angle)>.007)await aim(angle/.0026);
        await page.keyboard.down('KeyS');await page.keyboard.press('KeyF',{delay:25});
      } else {await page.keyboard.up('KeyS');await aim(220);}
      await page.waitForTimeout(75);
    }
  } finally {await page.keyboard.up('KeyS');await page.keyboard.up('KeyF');}
  await equip(page,'marksman','mk14');
  // Align with the sole survivor using visible pixels and wait for a genuine close-range hit.
  const beforeHealth=Number(await page.locator('#health-count').textContent());
  assert.ok(beforeHealth>=40,'enough real health remains for the last-zombie setup');
  const approachDeadline=Date.now()+30000;
  while(Number(await page.locator('#health-count').textContent())===beforeHealth) {
    assert.ok(Date.now()<approachDeadline,'final walker approaches');
    const target=await visibleHead();
    if(target) {const angle=Math.atan((target.x-target.width/2)/(target.height/(2*Math.tan(75*Math.PI/360))));if(Math.abs(angle)>.007)await aim(angle/.0026);}
    else await aim(180);
    await page.waitForTimeout(80);
  }
  await aimDown(.75/.0026);
  for(let i=0;i<2;i++) {
    const ammo=Number(await page.locator('#ammo-count').textContent());
    await page.keyboard.press('KeyF',{delay:25});
    await until(async()=>Number(await page.locator('#ammo-count').textContent())===ammo-1,'one controlled body shot');
    assert.equal(await page.locator('.score-target').textContent(),'1 LEFT','body shots must not end the wave');
    await simulated(.28);
  }
  await page.screenshot({path:`${artifacts}/zombie-injured-last.png`});
  await aimDown(.5/.0026);await page.locator('[data-inventory-key="grenade:frag"]').tap();await page.locator('#throw-button').tap();
  await simulated(.32);await slot(page,'health').tap();
  await page.locator('#supply-use-status').waitFor();assert.match(await page.locator('#supply-use-label').textContent(),/HEALING/);
  assert.equal(await count(page,'health'),1);assert.ok(Number(await page.locator('#health-count').textContent())<100);
  await page.screenshot({path:`${artifacts}/zombie-healing-before-recovery.png`});
  await until(async()=>/NEXT WAVE/.test(await page.locator('#timer').textContent()),'thrown frag kills last wounded walker before pending heal',12000);
  assert.equal(await count(page,'health'),1);assert.equal(await page.locator('#supply-use-status').isHidden(),true);
  assert.equal(await page.locator('#health-count').textContent(),'100');
  assert.equal(Number(await page.locator('#ammo-count').textContent())+Number(await page.locator('#reserve-count').textContent()),500);
  await simulated(5.1);assert.equal(await count(page,'health'),1);
  await page.screenshot({path:`${artifacts}/zombie-recovery-preserved-pack.png`});
  console.log('PASS zombie recovery preserves pending health pack');
  await page.waitForSelector('body[data-mode="results"]',{timeout:120000});await page.locator('#again-button').tap();await page.waitForSelector('body[data-mode="playing"]');
  assert.equal(await page.locator('#health-count').textContent(),'100');assert.equal(await page.locator('#armour-count').textContent(),'0');
  assert.equal(await page.locator('[data-inventory-kind="supply"]').count(),0);assert.equal(await page.locator('#supply-use-status').isHidden(),true);
  console.log('PASS zombie death/replay clears supply state');await home();
}
try {
  await mkdir(artifacts,{recursive:true});
  if(process.env.SUPPLY_SCENARIO!=='zombies') {
  await freshSolo(page,f.base);
  await page.evaluate(()=>{
    // Passive HUD boundaries exclude automation command latency from use time.
    const raf=window.requestAnimationFrame.bind(window);let using=false,started=0;
    window.__supplyDurations=[];
    window.requestAnimationFrame=callback=>raf(now=>{
      callback(now);const next=!document.getElementById('supply-use-status').hidden;
      if(next&&!using)started=window.__lootObservation.seconds;
      if(!next&&using)window.__supplyDurations.push(window.__lootObservation.seconds-started);
      using=next;
    });
  });
  await walkSolo(page,'KeyS',2); await walkSolo(page,'KeyA',5); await walkSolo(page,'KeyD',10); await walkSolo(page,'KeyA',5);
  assert.equal(await count(page,'health'),1); assert.equal(await count(page,'armour'),1);
  await slot(page,'armour').tap(); await page.locator('#supply-use-status').waitFor();
  await page.waitForTimeout(500); await slot(page,'armour').tap();
  assert.equal(await count(page,'armour'),1); assert.equal(await page.locator('#supply-use-status').isHidden(),true);
  await slot(page,'armour').tap(); await page.locator('[data-inventory-key="gun:m4a1"]').tap();
  assert.equal(await count(page,'armour'),1); assert.equal(await page.locator('#supply-use-status').isHidden(),true);
  console.log('PASS tap cancel and gun-switch cancel preserve stock');
  await slot(page,'armour').tap();
  await page.waitForFunction(() => document.getElementById('supply-use-label').textContent.includes('3.'));
  await page.locator('#pause-button').tap(); const frozen=await page.locator('#supply-use-label').textContent();
  await page.waitForTimeout(750); assert.equal(await page.locator('#supply-use-label').textContent(),frozen);
  assert.equal(await page.locator('#armour-count').textContent(),'0');
  await page.locator('#resume-button').tap(); await until(async()=>await page.locator('#armour-count').textContent()==='50','five-second offline armour effect');
  const elapsed=await page.evaluate(()=>window.__supplyDurations.at(-1)); assert.ok(elapsed>=4.85 && elapsed<=5.15,`passive simulation use duration ${elapsed}`);
  assert.equal(await slot(page,'armour').count(),0); await page.screenshot({path:`${artifacts}/solo-armour.png`}); await home();
  for (const map of ['courtyard','dust-town','neon-city','snow-base','jungle-ruins','harbor','desert-fort','space-station']) {
    await page.locator(`[data-map="${map}"]`).tap(); await page.locator('#home-solo').tap(); await page.waitForSelector('body[data-mode="playing"]');
    assert.equal(await page.locator('#armour-count').textContent(),'0'); assert.equal(await page.locator('#fatal-screen').isHidden(),true);
    await page.screenshot({path:`${artifacts}/start-${map}.png`}); await home();
  }
  await page.locator('[data-map="courtyard"]').tap();
  const peers=await onlinePair(f),victim=peers[0],shooter=peers[1];
  await equip(otherPage,'sidearm','g17');await until(()=>shooter.player.weaponId==='g17','single-fire control weapon acknowledged');
  await collectOnline(page,victim); await moveTo(otherPage,shooter,0,15);
  assert.equal(victim.player.health,100); const fullHealthStock=victim.equipment.supplies.health;
  await slot(page,'health').tap(); await until(async()=>/not needed/i.test(await page.locator('#toast').textContent()),'full health is rejected explicitly');
  assert.equal(victim.equipment.supplies.health,fullHealthStock); assert.equal(victim.equipment.supplyUse,null); console.log('PASS full resource cannot spend');
  await bodyShot(otherPage,shooter,victim); assert.equal(victim.player.health,77);
  await slot(page,'health').tap(); await until(()=>victim.equipment.supplyUse?.type==='health','server acknowledges health use');
  const started={...victim.player};
  await page.keyboard.down('KeyD');
  try {
    await until(()=>victim.equipment.supplyUse?.remaining<4,'health use advances while moving');
  } finally {await page.keyboard.up('KeyD');}
  assert.ok(victim.player.x>started.x+2); assert.equal(victim.player.health,77); assert.equal(victim.equipment.supplies.health,1);
  await until(()=>victim.player.health===100,'acknowledged heal completes',12000);
  assert.equal(victim.equipment.supplies.health,0); assert.equal(victim.equipment.supplyUse,null);
  console.log('PASS real five-second heal while moving (authoritative remaining/count/effect)');
  await moveTo(page,victim,0,17); const armourStock=victim.equipment.supplies.armour;
  await slot(page,'armour').tap(); await until(()=>victim.equipment.supplyUse?.type==='armour','armour started');
  await page.locator('#pause-button').tap();
  await until(()=>victim.player.armour===50,'active online use continues through menu',12000);
  assert.equal(await page.locator('body').getAttribute('data-mode'),'paused'); assert.equal(victim.equipment.supplies.armour,armourStock-1);
  await page.locator('#resume-button').tap(); console.log('PASS active online use continues through menu');
  await moveTo(page,victim,0,17); await moveTo(otherPage,shooter,0,15);
  for (const [armour,health] of [[27,100],[4,100],[0,81]]) {
    await bodyShot(otherPage,shooter,victim);
    await until(()=>peers.every(p=>p.room.players.some(actor=>actor.id===victim.id && actor.armour===armour && actor.health===health)),'both peers agree armour absorption and spillover');
  }
  await page.screenshot({path:`${artifacts}/online-armour-damage.png`});
  // Wait for a genuine authored respawn, collect an unused pack, then kill with a real headshot.
  await moveTo(page,victim,-5,17);
  await until(()=>victim.equipment.supplies.health===1,'health map pickup respawns',24000);
  await moveTo(page,victim,0,17); await moveTo(otherPage,shooter,0,15); await lookAt(otherPage,shooter,victim);
  const life=victim.player.lifeId; await otherPage.keyboard.press('KeyF',{delay:25});
  await until(()=>peers.every(p=>p.room.gear.loot.some(item=>item.source==='drop' && item.item.kind==='supply' && item.item.supplyType==='health')),'both peers see unused death supply');
  await until(()=>victim.player.lifeId>life,'victim respawns'); assert.equal(victim.player.armour,0);
  assert.deepEqual(victim.equipment.supplies,{health:0,armour:0}); assert.equal(victim.equipment.supplyUse,null);
  console.log('PASS two players observe same armour damage and drop; death/replay clears supply state');
  await writeFile(`${artifacts}/online-packets.json`,JSON.stringify(f.packets,null,2)); await leavePair();

  // A separate 3-minute room keeps capacity waits independent of combat timing.
  for (const packets of f.packets) packets.length=0;
  const [holder,peer]=await onlinePair(f);
  await moveTo(page,holder,0,17); await moveTo(page,holder,-5,17);
  await until(()=>holder.equipment.supplies.health===3,'three-item capacity from real twenty-second respawns',48000);
  await until(()=>holder.room.gear.loot.some(l=>l.source==='map' && l.item.supplyType==='health' && l.x===-5 && l.z===17),'fourth pack stays on ground at capacity',24000);
  assert.equal(holder.equipment.supplies.health,3);
  await moveTo(otherPage,peer,0,17); await moveTo(otherPage,peer,-5,17);
  await until(()=>peer.equipment.supplies.health===1,'peer collects fourth pack');
  assert.equal(holder.equipment.supplies.health,3); console.log('PASS three-item capacity leaves fourth for peer'); await leavePair();
  for(const modeId of ['tdm','ctf']) {
    for(const packets of f.packets)packets.length=0;
    await page.locator('[data-map="space-station"]').tap();await page.locator(`[data-mode-id="${modeId}"]`).tap();
    const [host]=await onlinePair(f);assert.equal(host.room.modeId,modeId);assert.equal(host.room.mapId,'space-station');
    const map=MAPS.find(m=>m.id==='space-station'),armour=LOOT_SPAWNS[map.id].find(p=>p.supplyType==='armour'&&p.z>0);
    await followRoute(page,async()=>({...host.player}),[{...armour,y:0},{...map.teamSpawns.red[0],y:0}],{map,online:true});
    await slot(page,'armour').tap();await until(()=>host.player.armour===50,`${modeId} authoritative armour use`);
    assert.equal(await page.locator('#fatal-screen').isHidden(),true);console.log(`PASS space-station ${modeId} supplies`);await leavePair();
  }
  }
  await zombieRecovery();
  f.clean(); console.log(`PASS supplies browser ${legacy?'legacy':'modern'}`);
} catch(error) {await page.screenshot({path:`${artifacts}/failure.png`});throw error;}
finally {await f.close();}

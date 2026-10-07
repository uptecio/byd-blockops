import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {fixture,observer,moveTo,lookAt,until} from './helpers/loot-browser.js';
import {readProfile,goHome} from './helpers/progression-browser.js';
import {startServer} from '../server/server.mjs';

const artifacts=process.env.ARTIFACT_DIR||'artifacts/xp-progression-online';
await mkdir(artifacts,{recursive:true});
const f=await fixture(),[host,guest]=f.pages;let replacement;
try {
  // Passive scene observations verify actual constructed palettes as well as
  // server DTOs. Never mutate models, actor state, receipts or network packets.
  for(const page of f.pages)await page.addInitScript(()=>{
    const objects=new Set(),push=Array.prototype.push;
    window.__xpModels=()=>[...objects].filter(o=>o.parent?.parent?.isScene||o.parent?.parent?.parent?.isScene).map(o=>{
      const weaponColors=[];o.getObjectByName('weapon')?.traverse(c=>{if(c.material?.color)weaponColors.push(c.material.color.getHexString());});
      return {...o.userData,name:o.name,visible:o.visible,weaponColors,colors:o.children.filter(c=>c.material?.color).map(c=>c.material.color.getHexString())};
    });
    Array.prototype.push=function(...items){for(const o of items)if(o?.isObject3D&&o.userData?.skinId)objects.add(o);return push.apply(this,items);};
  });
  for(let i=0;i<2;i++){
    const page=f.pages[i];await page.goto(f.base);
    await page.locator('#home-armory').click();await page.locator('[data-class="sniper"]').click();await page.locator('[data-weapon="awp"]').click();await page.locator('#armory-home').click();
    await page.locator('#home-online').click();await page.locator('#player-name').fill(`XP${i}`);
    await page.locator('.server-settings').evaluate(e=>{e.open=true;});await page.locator('#server-address').fill(f.base);
  }
  await host.locator('#create-room').click();await host.locator('#room-lobby:not([hidden])').waitFor();
  await host.locator('#room-mode').selectOption('ctf');const code=await host.locator('#room-code').textContent();
  await guest.locator('#room-code-input').fill(code);await guest.locator('#join-room').click();
  await until(async()=>await host.locator('#room-roster .roster-player').count()===2,'two XP peers joined');
  const a=observer(f,0),b=observer(f,1),rounds=[];
  for(let round=0;round<2;round++){
    await host.locator('#start-online').click();await Promise.all(f.pages.map(p=>p.waitForSelector('body[data-mode="playing"]')));
    await until(()=>a.room?.phase==='playing'&&a.room.roundId!==rounds.at(-1),'new authoritative round');rounds.push(a.room.roundId);
    for(let capture=1;capture<=3;capture++){
      await moveTo(host,a,0,-18);await until(()=>a.room.flags.blue.carrierId===a.id,'genuine flag pickup');
      if(capture<3){await moveTo(host,a,0,18);await until(()=>a.room.teamScores.red===capture,'genuine capture');}
      else {await host.keyboard.down('KeyS');try{await until(()=>f.packets[0].at(-1)?.room?.phase==='ended','third real capture ends match',15000);}finally{await host.keyboard.up('KeyS');}}
    }
    await Promise.all(f.pages.map(p=>p.waitForSelector('body[data-mode="results"]')));
    console.log(`REAL ONLINE CTF round${round+1}: host XP=${(await readProfile(host)).lifetimeXP}, idle peer XP=${(await readProfile(guest)).lifetimeXP}`);
    assert.equal((await readProfile(host)).lifetimeXP,225*(round+1));assert.equal((await readProfile(guest)).lifetimeXP,0,'idle peer does not inherit actions or bonuses');
    assert.match(await host.locator('#results-progression').textContent(),/225 XP.*Captures \+150.*Match finish \+50.*Win \+25/s);
    await host.locator('#again-button').click();await guest.locator('#again-button').click();
    await host.waitForTimeout(250);assert.equal((await readProfile(host)).lifetimeXP,225*(round+1),'results reopen cannot duplicate XP');
  }
  assert.notEqual(rounds[0],rounds[1]);
  await host.locator('#start-online').click();await Promise.all(f.pages.map(p=>p.waitForSelector('body[data-mode="playing"]')));
  await host.locator('#loadout-button').click();
  await host.locator('#armory-skin').selectOption('crimson-ninja');await host.locator('[data-finish="crimson-red"]').click();
  await until(()=>a.player.pendingSkinId==='crimson-ninja'&&a.player.pendingFinishId==='crimson-red','pending appearance reaches authority while menu open');
  assert.equal(a.player.skinId,'ranger');assert.equal(a.player.finishId,'standard');
  assert.match(await host.locator('#appearance-timing').textContent(),/Next respawn.*Crimson Ninja.*Crimson Red.*Wearing: Ranger/);
  const beforeModels=await guest.evaluate(()=>window.__xpModels());assert.ok(beforeModels.some(m=>m.teamId==='red'&&m.skinId==='ranger'&&!m.finishId),'peer still renders current original appearance');
  await host.locator('#play-button').click();await moveTo(host,a,0,6);await moveTo(guest,b,0,-6);
  await lookAt(guest,b,a);const life=a.player.lifeId;
  await guest.keyboard.press('KeyF',{delay:80});await until(()=>a.player.lifeId>life,'real elimination and respawn');
  assert.equal((await readProfile(guest)).lifetimeXP,10);
  assert.equal(a.player.skinId,'crimson-ninja');assert.equal(a.player.finishId,'crimson-red');
  await until(async()=>(await guest.evaluate(()=>window.__xpModels())).some(m=>m.teamId==='red'&&m.skinId==='crimson-ninja'&&m.finishId==='crimson-red'&&m.colors.includes('8f2038')&&m.weaponColors.includes('ae2943')),'actual peer skin and gun palettes rebuilt with both earned cosmetics');
  assert.equal((await readProfile(host)).skinId,'crimson-ninja');assert.equal((await readProfile(host)).finishId,'crimson-red');
  await guest.screenshot({path:`${artifacts}/peer-earned-appearance.png`});
  await host.locator('#loadout-button').click();
  const hostXP=(await readProfile(host)).lifetimeXP;await host.waitForTimeout(350);
  assert.equal((await readProfile(host)).lifetimeXP,hostXP,'open online menu does not rewrite or duplicate progress');
  const oldParticipation=b.id;await goHome(guest);await guest.locator('#home-online').click();await guest.locator('#room-code-input').fill(code);await guest.locator('#join-room').click();
  await guest.waitForSelector('body[data-mode="playing"]');
  const latestWelcome=f.packets[1].filter(p=>p.type==='welcome').at(-1);
  assert.notEqual(latestWelcome.id,oldParticipation);assert.equal(latestWelcome.progression.tally.earnedTotal,0);
  assert.equal((await readProfile(guest)).lifetimeXP,10,'rejoin preserves only previously earned local XP');
  await f.server.close();await until(async()=>/Connection lost/.test(await host.locator('#connection-status').textContent()),'owned server restart disconnects old participation');
  replacement=await startServer({port:f.server.port,distDir:process.env.DIST_DIR||'dist'});
  await host.locator('#create-room').click();await host.locator('#room-lobby:not([hidden])').waitFor();
  const restartedCode=await host.locator('#room-code').textContent();
  await guest.locator('#room-code-input').fill(restartedCode);await guest.locator('#join-room').click();
  await until(async()=>await host.locator('#room-roster .roster-player').count()===2,'new server room has two new participations');
  await host.locator('#start-online').click();
  await host.waitForSelector('body[data-mode="playing"]');
  const newWelcome=f.packets[0].filter(p=>p.type==='welcome').at(-1);
  assert.notEqual(newWelcome.id,a.id);assert.equal((await readProfile(host)).lifetimeXP,hostXP);
  assert.equal(newWelcome.progression,null,'new lobby has no prior-round receipt');
  f.clean();console.log('PASS online genuine450XP, earned cosmetics current/pending/model replication, private receipts, rematches, rejoin and owned server restart');
} catch(error){await host.screenshot({path:`${artifacts}/failure-host.png`});await guest.screenshot({path:`${artifacts}/failure-guest.png`});throw error;}
finally {await replacement?.close();await f.close();}

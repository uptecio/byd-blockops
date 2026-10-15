import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {MAPS} from '../../src/maps.js';
import {REWARDS,ownsCosmetic} from '../../src/progression.js';
import {sampleLadder} from '../../src/access-schema.js';
import {nativeProgressionFixture} from './helpers/progression-native.js';
import {setupSolo,fightSolo,goHome,readProfile} from '../../tests/helpers/progression-browser.js';
import {observeGame,followRoute,assertRendered,defendAgainstVisibleEnemy,aimAt} from '../../tests/helpers/traversal-browser.js';

const dir=process.env.ANDROID_TEST_ARTIFACTS,apk=process.env.ANDROID_APK_PATH;
assert.ok(dir&&apk,'Explicit owned evidence directory and candidate APK required');await mkdir(dir,{recursive:true});
const f=await nativeProgressionFixture({artifactDir:dir}),evidence={apk,maps:[],lifecycle:[],errors:[]};
let page,observation;
const storage=()=>page.evaluate(()=>Object.fromEntries(Object.entries(localStorage)));
try {
  evidence.beforeVersion=await f.version();
  if(process.env.ANDROID_BASELINE_ASSERT==='1')assert.deepEqual(evidence.beforeVersion,{code:11,name:'0.9.0'},'retained baseline must fail the candidate feature gate');
  page=await f.attach();
  if(process.env.ANDROID_RESUME_CODE11==='1') {
    assert.deepEqual(evidence.beforeVersion,{code:11,name:'0.9.0'});
    evidence.migration={performed:false,reason:'explicit candidate resume, not migration evidence'};
  }else {
    assert.deepEqual(evidence.beforeVersion,{code:10,name:'0.8.0'},'genuine retained baseline, never clear or downgrade data');
    const initial=await readProfile(page),targets=['skin','finish'].map(kind=>REWARDS.find(r=>r.kind===kind&&!ownsCosmetic(initial.lifetimeXP,kind,r.id)));
    assert.ok(targets.every(Boolean),'baseline must still have genuine locked rewards to earn');
    await setupSolo(page);
    assert.equal(await page.locator(`[data-skin="${targets[0].id}"]`).isDisabled(),true);
    await page.locator('#home-armory').click();assert.equal(await page.locator(`[data-finish="${targets[1].id}"]`).isDisabled(),true);await page.locator('#armory-home').click();
    const rounds=[];
    for(let round=0;!targets.every(r=>ownsCosmetic((rounds.at(-1)?.afterXP??initial.lifetimeXP),r.kind,r.id));round++) {
      assert.ok(round<9,'bounded genuine earning, no injected XP');
      const beforeXP=(await readProfile(page)).lifetimeXP;await page.locator('#home-solo').click();
      await fightSolo(page,15,{artifactDir:dir,label:`baseline10-win-${round+1}`});await page.waitForSelector('body[data-mode="results"]');
      const afterXP=(await readProfile(page)).lifetimeXP;assert.equal(afterXP,beforeXP+225);rounds.push({beforeXP,afterXP});await goHome(page);
    }
    await page.locator(`[data-skin="${targets[0].id}"]`).click();await page.locator('#home-armory').click();
    await page.locator(`[data-finish="${targets[1].id}"]`).click();await page.locator('#armory-home').click();
    await page.locator('#home-settings').click();await page.locator('#control-size').fill('1.3');await page.locator('#settings-done').click();
    const beforeUpgradeProfile=await readProfile(page),beforeUpgrade=await storage();
    assert.equal(beforeUpgradeProfile.skinId,targets[0].id);assert.equal(beforeUpgradeProfile.finishId,targets[1].id);
    await page.screenshot({path:`${dir}/baseline10-earned-selected.png`});
    evidence.migration={performed:true,initial,targets,rounds,beforeUpgradeProfile,beforeUpgrade};
    await writeFile(`${dir}/before-upgrade.json`,JSON.stringify(evidence.migration,null,2));
    await f.install(apk);page=await f.attach();assert.deepEqual(await f.version(),{code:11,name:'0.9.0'});
    evidence.migration.afterUpgrade=await storage();evidence.migration.afterUpgradeProfile=await readProfile(page);
    assert.deepEqual(evidence.migration.afterUpgrade,beforeUpgrade,'10→11 retains every raw saved key');
    assert.deepEqual(evidence.migration.afterUpgradeProfile,beforeUpgradeProfile);
    await page.screenshot({path:`${dir}/candidate11-retained.png`});console.log('PASS genuine signed10→11: fresh XP, newly unlocked skin/finish, selected cosmetics and raw saves');
  }
  evidence.identity=await f.identity();
  await page.locator('#home-settings').click();await page.locator('#bots').fill('1');await page.locator('#difficulty').selectOption('easy');await page.locator('#sound').uncheck();await page.locator('#settings-done').click();
  await page.locator('#home-armory').click();await page.locator('[data-class="assault"]').click();await page.locator('[data-weapon="m4a1"]').click();await page.locator('#armory-home').click();
  for(const scale of [1,1.3]) {
    await page.locator('#home-settings').click();await page.locator('#control-size').fill(String(scale));await page.locator('#settings-done').click();
    for(const map of MAPS) {
      const roof=map.id==='harbor'?map.traversal.roofs.find(r=>r.id==='harbor:original:container-4'):map.traversal.roofs.filter(r=>r.source==='original').sort((a,b)=>Math.hypot(a.point.x-map.playerSpawn.x,a.point.z-map.playerSpawn.z)-Math.hypot(b.point.x-map.playerSpawn.x,b.point.z-map.playerSpawn.z))[0];
      const links=map.traversal.links.filter(l=>l.routeId===roof.routeId),defend=()=>defendAgainstVisibleEnemy(page,observation,map);
      await page.locator(`[data-map="${map.id}"]`).click();await page.locator('[data-mode-id="ffa"]').click();await page.locator('#home-solo').click();await page.waitForSelector('body[data-mode="playing"]');
      observation=await observeGame(page);assert.equal((await observation.actor()).ladderId,null);
      const approach=await followRoute(page,observation.actor,[links[0].from],{map,defend,timeout:90000});
      const up=await followRoute(page,observation.actor,[roof.point],{map,defend,timeout:90000});
      const top=await assertRendered(page,observation,`${map.id} native original roof`);
      assert.equal(top.player.supportId,roof.supportId);assert.equal(up.inputs.some(i=>i.jump),roof.style==='jump');
      assert.equal(up.samples.some(s=>!!s.ladderId),roof.style==='ladder');
      await page.screenshot({path:`${dir}/${map.id}-${scale}-original-roof.png`});
      const down=await followRoute(page,observation.actor,[...links].reverse().map(l=>l.from),{map,defend,timeout:90000});
      assert.equal((await observation.actor()).supportId,'ground');assert.equal((await observation.actor()).ladderId,null);
      evidence.maps.push({mapId:map.id,roofId:roof.id,scale,approach,up,down,top});await observation.close();observation=null;await goHome(page);
      await writeFile(`${dir}/evidence.json`,JSON.stringify(evidence,null,2));console.log(`PASS native ${map.id} original ${roof.style} up/down at scale${scale}`);
    }
    const map=MAPS.find(m=>m.id==='harbor'),ladder=map.traversal.ladders.find(l=>l.routeId===map.traversal.roofs.find(r=>r.id==='harbor:original:container-4').routeId);
    await page.locator('[data-map="harbor"]').click();await page.locator('#home-solo').click();observation=await observeGame(page);
    const climb=await followRoute(page,observation.actor,[{...sampleLadder(ladder,1.5),ladderId:ladder.id}],{map,defend:()=>defendAgainstVisibleEnemy(page,observation,map),timeout:90000});
    const before=await observation.actor();await aimAt(page,observation.actor,before.yaw+1,0);await page.waitForTimeout(400);
    assert.equal((await observation.actor()).ladderId,ladder.id);assert.ok(Math.abs((await observation.actor()).y-before.y)<.03);
    const beforeBackground=await storage();await f.background();await f.foreground();await page.waitForSelector('body[data-mode="paused"]');
    assert.deepEqual(await storage(),beforeBackground);const paused=await observation.read();assert.equal(paused.player.ladderId,ladder.id);assert.equal(paused.input.fire,false);
    await page.screenshot({path:`${dir}/ladder-paused-${scale}.png`});await observation.close();observation=null;
    page=await f.relaunch();assert.deepEqual(await storage(),beforeBackground);await page.locator('#home-solo').click();observation=await observeGame(page);
    const fresh=await observation.actor();assert.equal(fresh.ladderId,null);assert.equal(fresh.ladderDistance,0);assert.equal(fresh.ladderBlockedId,null);
    evidence.lifecycle.push({scale,climb,before,paused,fresh,beforeBackground});await observation.close();observation=null;await goHome(page);
  }
  evidence.beforeReplacement=await storage();await f.install(apk);page=await f.attach();assert.deepEqual(await f.version(),{code:11,name:'0.9.0'});
  evidence.afterReplacement=await storage();assert.deepEqual(evidence.afterReplacement,evidence.beforeReplacement,'11→11 same-signed replacement retains complete saves');
  assert.equal(evidence.maps.length,16);f.clean();console.log('PASS native all8 originals ×2 scales, ladder lifecycle and signed11→11 replacement');
}catch(error){evidence.errors.push(error.stack);evidence.failureState=await observation?.read().catch(()=>null);await page?.screenshot({path:`${dir}/failure.png`}).catch(()=>{});throw error;}
finally{await observation?.close().catch(()=>{});await writeFile(`${dir}/evidence.json`,JSON.stringify(evidence,null,2));await f.close();}

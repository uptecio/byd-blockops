import assert from 'node:assert/strict';
import { RANGE_TARGETS } from '../../src/range-map.js';
import { aimAt } from './traversal-browser.js';
import { until } from './loot-browser.js';

// Passive heap inspection follows the existing traversal observer. No methods
// that change gameplay are called through this handle; every action uses input.
export async function observeRange(page) {
  const cdp = await page.context().newCDPSession(page), group = 'range-observation';
  const proto = await cdp.send('Runtime.evaluate', { expression: 'Object.prototype', objectGroup: group });
  const objects = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId, objectGroup: group });
  const found = await cdp.send('Runtime.callFunctionOn', { objectId: objects.objects.objectId, objectGroup: group,
    functionDeclaration: 'function(){return this.find(o=>typeof o?.getActors==="function"&&Array.isArray(o.bots)&&o.player&&o.hasRound);}' });
  assert.ok(found.result.objectId, 'passive range observer finds actual arena');
  return { async read() {
    const result = await cdp.send('Runtime.callFunctionOn', { objectId: found.result.objectId, returnByValue: true,
      functionDeclaration: `function(){const r=this.rangeRuntime;return {active:this.active,time:this.simulationTime,
        kind:this.modeState.kind,mapId:this.settings.mapId,modeId:this.settings.modeId,
        player:{x:this.player.x,y:this.player.jump,z:this.player.z,yaw:this.yaw,pitch:this.pitch},camera:this.camera.position.toArray(),
        weaponId:this.weapon.id,ammo:this.weaponState.ammo,reserve:this.weaponState.reserve,reload:this.weaponState.reloadRemaining,
        powers:{...this.soloPowers},targets:r?.state.targets.map(t=>({...t})),stats:{...this.matchView.range},
        memory:{...this.renderer.info.memory},feedback:this.scene.getObjectByName('Range damage labels')?.children.length||0,
        rangeNodes:this.scene.getObjectByName('Range view')?1:0,input:{fire:this.input.fire,move:{...this.input.move}},
        equipment:[...this.player.equipment.owned.values()].map(g=>({weaponId:g.weaponId,ammo:g.ammo,reserve:g.reserve,cooldown:g.cooldown,reload:g.reloadRemaining}))};}` });
    assert.equal(result.exceptionDetails, undefined, 'passive range read succeeds');
    return result.result.value;
  }, async close() { await cdp.send('Runtime.releaseObjectGroup', { objectGroup: group }); await cdp.detach(); } };
}
export async function enterRange(page) {
  await page.locator('#home-range').tap();
  await page.waitForSelector('body[data-mode="playing"]');
  assert.equal(await page.locator('#hud-mode').textContent(), 'Shooting Range');
}
export async function aimAtRangeTarget(page, targetId, region = 'body', observation) {
  const own = !observation, view = observation || await observeRange(page);
  try {
    const target = RANGE_TARGETS.find(t => t.id === targetId);
    assert.ok(target, `authored target ${targetId}`);
    const state = await view.read(), [x,y,z] = state.camera;
    const height = region === 'head' ? 1.68 : region === 'centre' ? 1.35 : .95;
    const dx=target.x-x,dz=target.z-z;
    await aimAt(page, async () => (await view.read()).player, Math.atan2(-dx,-dz), Math.atan2(height-y, Math.hypot(dx,dz)));
  } finally { if(own)await view.close(); }
}
export async function fireRangeKill(page, targetId, region = 'body', observation) {
  const own = !observation, view = observation || await observeRange(page);
  try {
    await until(async () => (await view.read()).targets.find(t=>t.id===targetId).health===100, `${targetId} naturally respawns`, 30000);
    const before = await view.read();
    await aimAtRangeTarget(page,targetId,region,view);
    const deadline=Date.now()+30000;
    while(Date.now()<deadline) {
      if((await view.read()).stats.targetKills>before.stats.targetKills)break;
      if(Number(await page.locator('#ammo-count').textContent())===0){await page.locator('#reload-button').tap();await page.waitForTimeout(3500);}
      await page.keyboard.press('KeyF',{delay:70});
      if((await view.read()).stats.targetKills>before.stats.targetKills)break;
      await page.waitForTimeout(180);
      await aimAtRangeTarget(page,targetId,region,view);
    }
    const after=await view.read();
    assert.equal(after.stats.targetKills,before.stats.targetKills+1,`real ${region} fire kills ${targetId}`);
    assert.equal(after.targets.find(t=>t.id===targetId).health,0);
    const xp=region==='body'?10:20;
    assert.equal(after.stats.earnedXP-before.stats.earnedXP,xp,`${region} kill earns ${xp} total XP`);
    return {before,after};
  } finally { if(own)await view.close(); }
}
export async function assertLegacy(page, legacy) {
  if(!legacy)return;
  const probe=await page.evaluate(()=>window.__legacyProbe);
  assert.ok(probe.arenaDraws>0,'actual WebGL1 arena draw calls');
  assert.ok(probe.contexts.some(c=>c.id==='arena'&&c.type==='webgl'&&c.available));
  assert.deepEqual(probe.lost,[],'no lost contexts');
}

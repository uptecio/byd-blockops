import assert from 'node:assert/strict';
import { createNavigation } from '../../src/navigation.js';
import { until } from './loot-browser.js';
import { createSpatialWorld,segmentClear } from '../../src/spatial.js';

// Read-only heap observations: no exported game hook, setters, teleports or
// resource grants. Controls below use Chromium's real pointer/key delivery.
export async function observeGame(page) {
  const cdp = await page.context().newCDPSession(page), group = 'traversal-observation';
  const proto = await cdp.send('Runtime.evaluate', { expression: 'Object.prototype', objectGroup: group });
  const objects = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId, objectGroup: group });
  const found = await cdp.send('Runtime.callFunctionOn', { objectId: objects.objects.objectId, objectGroup: group,
    functionDeclaration: 'function(){return this.find(o=>typeof o?.getActors==="function"&&Array.isArray(o.bots)&&o.player&&o.hasRound);}' });
  assert.ok(found.result.objectId, 'passive observer finds actual arena instance');
  const read = async () => {
    const result = await cdp.send('Runtime.callFunctionOn', { objectId: found.result.objectId, returnByValue: true,
      functionDeclaration: `function(){return {
        active:this.active, modeId:this.settings.modeId, mapId:this.settings.mapId,
        player:{x:this.player.x,y:this.player.jump,z:this.player.z,yaw:this.yaw,pitch:this.pitch,
          lifeId:this.player.lifeId,health:this.player.health,armour:this.player.armour,grounded:this.player.grounded,supportId:this.player.supportId,hiddenSpotId:this.player.hiddenSpotId},
        camera:this.camera.position.toArray(),actors:this.getActors().map(a=>({id:a.id,kind:a.kind,alive:a.alive,x:a.x,y:a.y,z:a.z,health:a.health,enemy:this.isEnemy('local',a.id)})),
        bots:this.bots.map(b=>({id:b.id,targetId:b.brain?.targetId,visible:b.model.visible})),
        wave:this.zombieRuntime?.state.wave,queued:this.zombieRuntime?.state.queued,phase:this.zombieRuntime?.state.phase,
        activeIds:this.zombieRuntime?.state.activeIds.size,
        drawCalls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,
        memory:{...this.renderer.info.memory},weaponVisible:this.weaponModel.visible,ammo:this.weaponState.ammo,
        input:{move:{...this.input.move},fire:this.input.fire,hidePressed:this.input.hidePressed,keys:[...this.input.keys]},
        flags:this.objectives?.flags?Object.fromEntries(Object.entries(this.objectives.flags).map(([k,v])=>[k,v.visible])):null,
        models:this.world.botGroup.children.map(m=>({name:m.name,visible:m.visible,labelVisible:m.getObjectByName('name-label')?.visible,skinId:m.userData.skinId}))
      };}` });
    assert.equal(result.exceptionDetails, undefined, 'passive read does not throw'); return result.result.value;
  };
  return { read, actor: async () => (await read()).player,
    async close() { await cdp.send('Runtime.releaseObjectGroup', { objectGroup: group }); await cdp.detach(); } };
}

export async function touchControls(page) {
  const cdp = await page.context().newCDPSession(page);
  const point = async (selector, id) => { const b = await page.locator(selector).boundingBox(); assert.ok(b, `${selector} visible`); return { x:b.x+b.width/2,y:b.y+b.height/2,id }; };
  return { point, send: (type, touchPoints = []) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints }), close: () => cdp.detach() };
}

export async function aimAt(page, readActor, yaw, pitch = 0) {
  const size = page.viewportSize();
  for (let attempt = 0; attempt < 4; attempt++) {
    const actor = await readActor(), delta = Math.atan2(Math.sin(yaw-actor.yaw), Math.cos(yaw-actor.yaw));
    const dx = -delta/.0026, dy = -(pitch-actor.pitch)/.0026;
    if (Math.abs(dx)<2 && Math.abs(dy)<2) return;
    const count = Math.max(1,Math.ceil(Math.max(Math.abs(dx),Math.abs(dy))/110));
    for (let i=0;i<count;i++) {
      await page.mouse.move(size.width*.52,size.height*.43); await page.mouse.down();
      await page.mouse.move(size.width*.52+dx/count,size.height*.43+dy/count,{steps:2}); await page.mouse.up();
    }
    await page.waitForTimeout(65);
  }
}

export async function followRoute(page, readActor, route, { speed = 5.3, touch = true, map, timeout = 60000, online = false, defend } = {}) {
  assert.ok(map, 'route traversal needs authored map metadata');
  const navigation = createNavigation(map, { radius:online?.4:.34 }), controls = await touchControls(page);
  const stick = await controls.point('#joystick',31), jump = await controls.point('#jump-button',32);
  const box = await page.locator('#joystick').boundingBox(), radius = box.width*.34;
  let jumping=false,lastDefence=0; const samples=[];
  try {
    await controls.send('touchStart',[stick]);
    for (const destination of route) {
      const deadline=Date.now()+timeout;
      let reached=false;
      while(Date.now()<deadline) {
        let actor=await readActor(); samples.push({...actor});
        assert.ok(actor.health>0,'route actor is alive');
        if(defend&&actor.health<95&&actor.y===0&&actor.grounded&&Date.now()-lastDefence>2500) {
          await controls.send('touchEnd');await defend();await controls.send('touchStart',[stick]);
          lastDefence=Date.now();
          actor=await readActor();
        }
        if(Math.hypot(actor.x-destination.x,actor.z-destination.z)<.08 && Math.abs(actor.y-destination.y)<.01 && actor.grounded) { reached=true;break; }
        let next=destination.direct && actor.y>destination.y+.01 ? {...destination,kind:'drop'} : navigation.nextWaypoint(actor,destination);
        assert.ok(next,`reachable waypoint ${JSON.stringify({actor,destination})}`);
        // Look ahead along the same verified straight ground corridor. Braking
        // at every half-unit nav cell is not how a person uses the joystick.
        if(next.kind==='walk')for(let look=0;look<7;look++) {
          const further=navigation.nextWaypoint({...next,grounded:true},destination);
          if(!further||further.kind!=='walk'||further.y!==next.y)break;
          const ax=next.x-actor.x,az=next.z-actor.z,bx=further.x-next.x,bz=further.z-next.z;
          if(Math.hypot(bx,bz)<.001||ax*bx+az*bz<=0||Math.abs(ax*bz-az*bx)>.015)break;
          next=further;
        }
        if(process.env.TRAVERSAL_DEBUG && samples.length%30===0)console.log('ROUTE',JSON.stringify({actor,next,jumping,knob:await page.locator('#joystick-knob').getAttribute('style')}));
        const dx=next.x-actor.x,dz=next.z-actor.z,length=Math.hypot(dx,dz);
        const jumpingNow=actor.grounded && next.kind==='jump' && next.y>actor.y+.01 && length<=1.8;
        // A short landing approach is slow enough to settle inside authored
        // take-off tolerance; during a jump keep its normal travel speed.
        // Subpixel joystick offsets can quantize to the centre, leaving a
        // route stalled millimetres short of a corner/step. Keep a real touch
        // displacement; destination/landing tolerances still stop the stick.
        const magnitude=Math.min(1,Math.max(online?.025:.035,length/(speed*(online?.55:.18))));
        const x=(dx*Math.cos(actor.yaw)-dz*Math.sin(actor.yaw))/Math.max(.001,length)*magnitude;
        const y=(-dx*Math.sin(actor.yaw)-dz*Math.cos(actor.yaw))/Math.max(.001,length)*magnitude;
        const moved={...stick,x:stick.x+x*radius,y:stick.y-y*radius};
        await controls.send('touchMove',[moved]);
        if(jumpingNow && !jumping) {
          if(touch) {
            await controls.send('touchStart',[moved,jump]);
            await page.waitForTimeout(25);await controls.send('touchEnd');
            await controls.send('touchStart',[moved]);jumping=true;
          }
          else await page.keyboard.press('Space');
        }
        if(!actor.grounded)jumping=false;
        await page.waitForTimeout(45);
        if(online&&actor.grounded&&next.kind==='walk'&&length<.25) {
          // Settle an authoritative snapshot between small corner/arrival
          // corrections instead of continuously chasing delayed positions.
          await controls.send('touchEnd');await page.waitForTimeout(150);await controls.send('touchStart',[stick]);
        }
      }
      assert.ok(reached,`real controls landed at ${JSON.stringify(destination)}; last=${JSON.stringify(samples.at(-1))}; next=${JSON.stringify(navigation.nextWaypoint(samples.at(-1),destination))}`);
    }
  } finally {await controls.send('touchEnd');await controls.close();}
  return samples;
}

export async function recordFrames(page, seconds) {
  return page.evaluate(seconds=>new Promise(resolve=>{
    const rows=[],start=performance.now();let previous=start;
    function frame(timestamp){const now=performance.now();rows.push({now,deltaMs:now-previous,rafTimestamp:timestamp});previous=now;
      if(now-start<seconds*1000)requestAnimationFrame(frame);
      else {const sorted=rows.map(r=>r.deltaMs).sort((a,b)=>a-b);resolve({rows,count:rows.length,elapsedMs:now-start,medianMs:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)]});}}
    requestAnimationFrame(frame);
  }),seconds);
}

export async function assertRendered(page, observation, label) {
  const state=await observation.read(); assert.ok(state.drawCalls>0 && state.triangles>0,`${label}: world geometry drawn`);
  const legacy=await page.evaluate(()=>window.__legacyProbe || null);
  if(legacy){assert.ok(legacy.arenaDraws>0,`${label}: WebGL1 arena draws`);assert.deepEqual(legacy.lost,[]);}
  return state;
}

export async function hideAt(page, observation, map, spot=map.hideSpots[0],options={}) {
  await followRoute(page,observation.actor,[spot.entry],{map,...options});
  await page.locator('#hide-button').tap();
  await until(async()=>(await observation.actor()).hiddenSpotId===spot.id,'Hide enters actual prop');
  assert.deepEqual((await observation.read()).camera,[spot.view.x,spot.view.y,spot.view.z]);
}

export async function defendAgainstVisibleEnemy(page,observation,map) {
  const state=await observation.read(),actor=state.player,world=createSpatialWorld(map);
  const enemies=state.actors.filter(a=>a.enemy&&a.alive&&segmentClear({...actor,y:actor.y+1.6},{...a,y:a.y+1.58},world));
  enemies.sort((a,b)=>Math.hypot(a.x-actor.x,a.z-actor.z)-Math.hypot(b.x-actor.x,b.z-actor.z));
  if(!enemies.length)return;
  const targetId=enemies[0].id,deadline=Date.now()+2500;
  try {
    while(Date.now()<deadline) {
      const current=await observation.read(),target=current.actors.find(a=>a.id===targetId&&a.alive),own=current.player;
      if(!target||own.health<=0)return;
      const dx=target.x-own.x,dz=target.z-own.z;
      await aimAt(page,observation.actor,Math.atan2(-dx,-dz),Math.atan2(target.y+1.58-(own.y+1.6),Math.hypot(dx,dz)));
      if(Number(await page.locator('#ammo-count').textContent())===0)await page.keyboard.press('KeyR');
      else {await page.keyboard.up('KeyF');await page.keyboard.down('KeyF');}
      await page.waitForTimeout(100);
    }
  }finally{await page.keyboard.up('KeyF');}
}

export async function captureEightZombies(page, observation, map) {
  const world=createSpatialWorld(map),deadline=Date.now()+180000;
  try {
    while(Date.now()<deadline) {
      const state=await observation.read(),actor=state.player;
      assert.ok(state.active&&actor.health>0,'natural survival until wave-three timing window');
      await page.keyboard.up('KeyF');
      if(state.wave>=3) {
        // Keep the same north-facing movement as the recorded baseline.
        // Reversing at z=-15 steers back into the following pack just as the
        // eighth staggered enemy spawns, invalidating the live-player window.
        await aimAt(page,observation.actor,0);
        await page.keyboard.down('KeyW');
        if(state.activeIds===8) {
          const before=await observation.read(),frames=await recordFrames(page,4),after=await observation.read();
          return {before,after,frames,valid:before.activeIds===8&&after.activeIds===8&&after.player.health>0&&before.actors.some(a=>a.alive&&a.kind==='runner')};
        }
        await page.waitForTimeout(120);continue;
      }
      if(state.phase==='recovery'){await page.waitForTimeout(150);continue;}
      if(Number(await page.locator('#ammo-count').textContent())===0){await page.keyboard.press('KeyR');await page.waitForTimeout(150);continue;}
      const visible=state.actors.filter(a=>a.id!=='local'&&a.alive&&segmentClear({...actor,y:actor.y+1.6},{...a,y:a.y+1.58},world));
      visible.sort((a,b)=>Math.hypot(a.x-actor.x,a.z-actor.z)-Math.hypot(b.x-actor.x,b.z-actor.z));
      if(visible.length) {
        const target=visible[0],dx=target.x-actor.x,dz=target.z-actor.z;
        await aimAt(page,observation.actor,Math.atan2(-dx,-dz),Math.atan2(target.y+1.58-(actor.y+1.6),Math.hypot(dx,dz)));
        await page.keyboard.down('KeyF');await page.waitForTimeout(180);
      }else await page.waitForTimeout(100);
    }
    assert.fail('real controls did not reach eight-zombie sample');
  }finally{await page.keyboard.up('KeyF');await page.keyboard.up('KeyW');}
}

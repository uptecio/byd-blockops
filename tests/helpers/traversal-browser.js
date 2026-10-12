import assert from 'node:assert/strict';
import { createNavigation } from '../../src/navigation.js';
import { until } from './loot-browser.js';
import { createSpatialWorld,segmentClear,supportBelow } from '../../src/spatial.js';
import { projectLadder } from '../../src/access-schema.js';

// Read-only heap observations: no exported game hook, setters, teleports or
// resource grants. Controls below use Chromium's real pointer/key delivery.
export async function observeGame(page) {
  const cdp = await page.context().newCDPSession(page), group = 'traversal-observation';
  const proto = await cdp.send('Runtime.evaluate', { expression: 'Object.prototype', objectGroup: group });
  const objects = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId, objectGroup: group });
  const found = await cdp.send('Runtime.callFunctionOn', { objectId: objects.objects.objectId, objectGroup: group,
    functionDeclaration: 'function(){return this.find(o=>typeof o?.getActors==="function"&&Array.isArray(o.bots)&&o.player&&o.hasRound);}' });
  assert.ok(found.result.objectId, 'passive observer finds actual arena instance');
  const online=await cdp.send('Runtime.callFunctionOn',{objectId:objects.objects.objectId,objectGroup:group,
    functionDeclaration:'function(){return this.find(o=>o?.remotes instanceof Map&&o.game&&o.running&&typeof o.sync==="function");}'});
  const read = async () => {
    const result = await cdp.send('Runtime.callFunctionOn', { objectId: found.result.objectId, returnByValue: true,
      functionDeclaration: `function(){const materials=new Set();this.scene.traverse(o=>{for(const m of (Array.isArray(o.material)?o.material:[o.material]))if(m)materials.add(m);});return {
        active:this.active, modeId:this.settings.modeId, mapId:this.settings.mapId, simulationTime:this.simulationTime,
        player:{x:this.player.x,y:this.player.jump,z:this.player.z,yaw:this.yaw,pitch:this.pitch,
          lifeId:this.player.lifeId,health:this.player.health,armour:this.player.armour,grounded:this.player.grounded,supportId:this.player.supportId,hiddenSpotId:this.player.hiddenSpotId,
          velocityY:this.player.velocityY,ladderId:this.player.ladderId,ladderDistance:this.player.ladderDistance,ladderBlockedId:this.player.ladderBlockedId},
        camera:this.camera.position.toArray(),actors:this.getActors().map(a=>({id:a.id,kind:a.kind,alive:a.alive,x:a.x,y:a.y,z:a.z,health:a.health,ladderId:a.ladderId,enemy:this.isEnemy('local',a.id)})),
        bots:this.bots.map(b=>({id:b.id,targetId:b.brain?.targetId,visible:b.model.visible})),
        wave:this.zombieRuntime?.state.wave,queued:this.zombieRuntime?.state.queued,phase:this.zombieRuntime?.state.phase,
        activeIds:this.zombieRuntime?.state.activeIds.size,
        drawCalls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,
        memory:{...this.renderer.info.memory,materials:materials.size},navigation:this.navigation?.stats?.()||null,weaponVisible:this.weaponModel.visible,ammo:this.weaponState.ammo,
        input:{move:{...this.input.move},fire:this.input.fire,hidePressed:this.input.hidePressed,keys:[...this.input.keys]},
        flags:this.objectives?.flags?Object.fromEntries(Object.entries(this.objectives.flags).map(([k,v])=>[k,v.visible])):null,
        models:this.world.botGroup.children.map(m=>({name:m.name,visible:m.visible,labelVisible:m.getObjectByName('name-label')?.visible,skinId:m.userData.skinId}))
      };}` });
    assert.equal(result.exceptionDetails, undefined, 'passive read does not throw');
    if(online.result.objectId) {
      const remote=await cdp.send('Runtime.callFunctionOn',{objectId:online.result.objectId,returnByValue:true,
        functionDeclaration:'function(){return {active:this.running&&!this.suspended&&this.room.phase==="playing",actors:[...this.remotes].map(([id,r])=>({id,x:r.model.position.x,y:r.model.position.y,z:r.model.position.z,ladderId:r.player.ladderId,lifeId:r.player.lifeId,visible:r.model.visible}))};}'});
      assert.equal(remote.exceptionDetails,undefined);result.result.value.remotes=remote.result.value.actors;
      // Online play deliberately disables Arena's solo simulation; its own
      // participant lifecycle, not that flag, determines live input activity.
      result.result.value.active=remote.result.value.active;
    }
    return result.result.value;
  };
  return { read, actor: async () => {const state=await read();return {...state.player,active:state.active};},
    async recordFrames(seconds) {
      const result=await cdp.send('Runtime.callFunctionOn',{objectId:found.result.objectId,returnByValue:true,awaitPromise:true,arguments:[{value:seconds}],
        functionDeclaration:`function(seconds){return new Promise(resolve=>{const rows=[],start=performance.now();let previous=start;
          const frame=timestamp=>{const now=performance.now(),actors=this.getActors();rows.push({now,deltaMs:now-previous,rafTimestamp:timestamp,alive:actors.filter(a=>a.alive).length,enemyAlive:actors.filter(a=>a.id!=='local'&&a.alive).length,runner:actors.some(a=>a.alive&&a.kind==='runner'),health:this.player.health,lifeId:this.player.lifeId});previous=now;
            if(now-start<seconds*1000)requestAnimationFrame(frame);else{const sorted=rows.map(r=>r.deltaMs).sort((a,b)=>a-b);resolve({rows,count:rows.length,elapsedMs:now-start,medianMs:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)]});}};requestAnimationFrame(frame);});}`});
      assert.equal(result.exceptionDetails,undefined);return result.result.value;
    },
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
  const bodyRadius=online?.4:.34,world=createSpatialWorld(map);
  const navigation = createNavigation(map, { radius:bodyRadius }), controls = await touchControls(page);
  const stick = await controls.point('#joystick',31), jump = await controls.point('#jump-button',32);
  const box = await page.locator('#joystick').boundingBox(), radius = box.width*.34;
  let lastDefence=0; const samples=[],inputs=[];
  let stickHeld=false,heldKeys=new Set();
  const deliver=async(x,y,jumpNow=false)=>{
    if(touch) {
      const moved={...stick,x:stick.x+x*radius,y:stick.y-y*radius};
      await controls.send(stickHeld?'touchMove':'touchStart',[moved]);stickHeld=true;
      inputs.push({at:Date.now(),device:'touch',x,y,jump:false,fire:false});
      if(jumpNow){await controls.send('touchStart',[moved,jump]);inputs.push({at:Date.now(),device:'touch',x,y,jump:true,fire:false});
        // Chromium's CDP TouchEnd point list identifies the fingers to lift;
        // passive pointerup traces verify that the stick stays captured.
        await page.waitForTimeout(25);await controls.send('touchEnd',[jump]);}
    } else {
      const desired=new Set();
      if(x>0)desired.add('KeyD');if(x<0)desired.add('KeyA');
      if(y>0)desired.add('KeyW');if(y<0)desired.add('KeyS');
      for(const key of heldKeys)if(!desired.has(key))await page.keyboard.up(key);
      for(const key of desired)if(!heldKeys.has(key))await page.keyboard.down(key);
      heldKeys=desired;inputs.push({at:Date.now(),device:'keyboard',keys:[...desired],x:Math.sign(x),y:Math.sign(y),jump:false,fire:false});
      if(jumpNow){await page.keyboard.press('Space');inputs.push({at:Date.now(),device:'keyboard',jump:true,fire:false});}
    }
  };
  const release=async()=>{
    if(stickHeld){await controls.send('touchEnd');stickHeld=false;}
    for(const key of heldKeys)await page.keyboard.up(key);heldKeys.clear();
    inputs.push({at:Date.now(),device:touch?'touch':'keyboard',x:0,y:0,jump:false,fire:false,release:true});
  };
  try {
    for (const destination of route) {
      const deadline=Date.now()+timeout;
      let reached=false;
      while(Date.now()<deadline) {
        let actor=await readActor(); samples.push({...actor});
        assert.ok(actor.health>0,'route actor is alive');
        assert.notEqual(actor.active,false,'route match remains active');
        const sameAttachment=destination.ladderId?actor.ladderId===destination.ladderId:actor.grounded&&!actor.ladderId;
        // Digital input moves up to .265 per clamped frame. Requiring an
        // intermediate stair centre within .08 can oscillate forever between
        // adjacent treads. Accept .16 only on the explicitly named tread or
        // descending jump platform at exact supported height. Ground, ascent,
        // final roof and ladder goals retain their original criteria.
        const intermediate=destination.kind==='stair'||(destination.descending&&destination.kind==='jump'&&destination.supportId!=='ground');
        const exactIntermediate=intermediate&&!!destination.supportId&&destination.supportId===actor.supportId;
        const arrival=online&&!touch?.25:!touch&&exactIntermediate?.16:.08;
        if(Math.hypot(actor.x-destination.x,actor.z-destination.z)<arrival && Math.abs(actor.y-destination.y)<(destination.ladderId?(online&&!touch?.14:.06):.01) && sameAttachment) { reached=true;break; }
        if(defend&&actor.health<95&&(actor.grounded||actor.ladderId)&&Date.now()-lastDefence>2500) {
          await release();const defence=await defend();if(Array.isArray(defence))inputs.push(...defence);
          lastDefence=Date.now();
          // Combat can move or kill the body. Re-observe all lifecycle and
          // arrival conditions before planning another movement input.
          continue;
        }
        let next=destination.direct && actor.y>destination.y+.01 ? {...destination,kind:'drop'} : navigation.nextWaypoint(actor,destination);
        assert.ok(next,`reachable waypoint ${JSON.stringify({actor,destination})}`);
        // Keyboard movement cannot throttle below a full frame. A real player
        // can launch from nearby on the same supported take-off surface instead
        // of oscillating across navigation's .06-centre gate. This lookahead
        // only chooses the next real input; it never changes the observed body.
        if(!touch&&actor.grounded&&!actor.ladderId&&next.kind==='walk'
          &&Math.abs(next.y-actor.y)<1e-7&&Math.hypot(next.x-actor.x,next.z-actor.z)<=.18
          &&supportBelow(next,bodyRadius,world)?.id===actor.supportId) {
          const launch=navigation.nextWaypoint({...actor,...next},destination);
          if(launch?.kind==='jump'&&launch.y>actor.y+.01&&Math.hypot(launch.x-actor.x,launch.z-actor.z)<=1.8)next=launch;
        }
        // Look ahead along the same verified straight ground corridor. Braking
        // at every half-unit nav cell is not how a person uses the joystick.
        if(next.kind==='walk')for(let look=0;look<7;look++) {
          const further=navigation.nextWaypoint({...next,grounded:true},destination);
          if(!further||further.kind!=='walk'||further.y!==next.y)break;
          const ax=next.x-actor.x,az=next.z-actor.z,bx=further.x-next.x,bz=further.z-next.z;
          if(Math.hypot(bx,bz)<.001||ax*bx+az*bz<=0||Math.abs(ax*bz-az*bx)>.015)break;
          next=further;
        }
        if(process.env.TRAVERSAL_DEBUG && samples.length%30===0)console.log('ROUTE',JSON.stringify({actor,next,knob:await page.locator('#joystick-knob').getAttribute('style')}));
        if(next.kind==='ladder') {
          const ladder=map.traversal.ladders.find(l=>l.id===next.ladderId);
          const remaining=next.ladderDistance-projectLadder(ladder,actor).distance;
          // A genuine approach can grab at distance zero just as the last
          // alignment frame ends. For a supported endpoint goal, keep the
          // outward key held to step off; neutral intentionally keeps holding.
          const direction=Math.abs(remaining)>1e-8?Math.sign(remaining):destination.ladderId?0:next.ladderDistance===0?-1:1;
          const climb=direction*Math.max(actor.ladderId?.12:.3,Math.min(1,Math.abs(remaining)/(2.4*(online?.5:.2))));
          if(!actor.ladderId) {
            const end=direction>0?ladder.bottom.point:ladder.top.point;
            const dx=end.x-actor.x,dz=end.z-actor.z;
            if(Math.hypot(dx,dz)>.0001) {
              await release();await aimAt(page,readActor,Math.atan2(-dx,-dz)+(direction<0?Math.PI:0));
            }
          }
          await deliver(0,climb);await page.waitForTimeout(45);continue;
        }
        const dx=next.x-actor.x,dz=next.z-actor.z,length=Math.hypot(dx,dz);
        const jumpingNow=actor.grounded && next.kind==='jump' && next.y>actor.y+.01 && length<=1.8;
        // A short landing approach is slow enough to settle inside authored
        // take-off tolerance; during a jump keep its normal travel speed.
        // Subpixel joystick offsets can quantize to the centre, leaving a
        // route stalled millimetres short of a corner/step. Keep a real touch
        // displacement; destination/landing tolerances still stop the stick.
        const magnitude=Math.min(1,Math.max(online?.025:.035,length/(speed*(online?.55:.18))));
        let x=(dx*Math.cos(actor.yaw)-dz*Math.sin(actor.yaw))/Math.max(.001,length)*magnitude;
        let y=(-dx*Math.sin(actor.yaw)-dz*Math.cos(actor.yaw))/Math.max(.001,length)*magnitude;
        const passingLadder=next.kind==='walk'&&actor.grounded&&!actor.ladderId&&world.ladders.some(ladder=>[ladder.bottom,ladder.top].some(end=>
          Math.abs(actor.y-end.point.y)<1e-7&&actor.x>=end.zone.minX-.8&&actor.x<=end.zone.maxX+.8&&actor.z>=end.zone.minZ-.8&&actor.z<=end.zone.maxZ+.8));
        if(passingLadder) {
          // Ordinary forward movement inside a ladder's entry zone means
          // climb. Walk sideways past an unrelated entry so raw y remains
          // zero; the intentional ladder branch above keeps its real up/down.
          await release();await aimAt(page,readActor,Math.atan2(-dz,dx));x=touch?magnitude:1;y=0;
        } else if(!touch) {
          await release();await aimAt(page,readActor,Math.atan2(-dx,-dz));x=0;y=1;
        }
        // Input already treats Jump as a one-shot press. A browser observer
        // can miss a whole flight (or a refused launch); never latch the
        // driver until it happens to sample an airborne frame. Retry only
        // from an actually supported body whose next route step is higher.
        await deliver(x,y,jumpingNow);
        if(!touch&&actor.grounded&&!jumpingNow&&length<.5) {
          // A full-frame wait plus the input round trip can advance two
          // clamped frames on a busy renderer and oscillate across a small
          // take-off target. Short genuine key taps allow a single frame (or
          // no frame, in which case the next observed iteration retries).
          await page.waitForTimeout(1);await release();
        } else await page.waitForTimeout(45);
        if(online&&actor.grounded&&next.kind==='walk'&&length<(touch?.25:.75)) {
          // Settle an authoritative snapshot between small corner/arrival
          // corrections instead of continuously chasing delayed positions.
          await release();await page.waitForTimeout(150);
        }
      }
      assert.ok(reached,`real controls landed at ${JSON.stringify(destination)}; last=${JSON.stringify(samples.at(-1))}; next=${JSON.stringify(navigation.nextWaypoint(samples.at(-1),destination))}`);
    }
  } catch(error) {error.routeTrace={samples,inputs};throw error;}
  finally {await release();await controls.close();}
  // Inputs and authoritative snapshots travel on separate schedules. Observe
  // the stopped server body after the release has crossed that boundary.
  if(online)await page.waitForTimeout(200);
  samples.push({...await readActor()});
  return {samples,inputs};
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
  if(!enemies.length)return [];
  const targetId=enemies[0].id,deadline=Date.now()+2500,inputs=[];
  try {
    while(Date.now()<deadline) {
      const current=await observation.read(),target=current.actors.find(a=>a.id===targetId&&a.alive),own=current.player;
      if(!target||own.health<=0)break;
      const dx=target.x-own.x,dz=target.z-own.z;
      await aimAt(page,observation.actor,Math.atan2(-dx,-dz),Math.atan2(target.y+1.58-(own.y+1.6),Math.hypot(dx,dz)));
      if(Number(await page.locator('#ammo-count').textContent())===0){await page.keyboard.press('KeyR');inputs.push({at:Date.now(),device:'keyboard',reload:true});}
      else {await page.keyboard.up('KeyF');inputs.push({at:Date.now(),device:'keyboard',fire:false});await page.keyboard.down('KeyF');inputs.push({at:Date.now(),device:'keyboard',fire:true});}
      await page.waitForTimeout(100);
    }
  }finally{await page.keyboard.up('KeyF');inputs.push({at:Date.now(),device:'keyboard',fire:false});}
  return inputs;
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
          const before=await observation.read(),frames=await observation.recordFrames(4),after=await observation.read();
          return {before,after,frames,valid:before.activeIds===8&&after.activeIds===8&&after.player.health>0&&frames.rows.every(r=>r.enemyAlive===8&&r.runner&&r.health>0&&r.lifeId===before.player.lifeId)};
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

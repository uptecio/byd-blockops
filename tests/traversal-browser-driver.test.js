import test from 'node:test';
import assert from 'node:assert/strict';
import {followRoute,observeGame} from './helpers/traversal-browser.js';
import {MAPS} from '../src/maps.js';

// Unit tests for automation edge bookkeeping only. These do not count as
// physical-route acceptance; the real-browser suites still prove movement.
for(const missFirst of [false,true])test(`keyboard driver retries supported jump without requiring an observed airborne frame (missFirst=${missFirst})`,async()=>{
  const points=[{x:0,y:0,z:1.8},{x:0,y:.5,z:.6},{x:0,y:1,z:-.6}];
  const map={id:'driver-fixture',bounds:{min:-4,max:4},solids:[
    {id:'step1',x:0,z:.6,w:1.6,d:1.2,minY:0,maxY:.5},
    {id:'step2',x:0,z:-.6,w:1.6,d:1.2,minY:0,maxY:1}],
    traversal:{roofs:[],stairs:[],ladders:[],links:points.slice(1).map((to,i)=>({id:`jump${i}`,from:points[i],to,kind:'jump',width:1.6,depth:1.2}))}};
  let index=0,jumps=0;const actor=()=>({...points[index],yaw:0,pitch:0,health:100,lifeId:1,velocityY:0,grounded:true,supportId:index?`step${index}`:'ground',ladderId:null});
  const page={context:()=>({newCDPSession:async()=>({send:async()=>({}),detach:async()=>{}})}),
    locator:()=>({boundingBox:async()=>({x:0,y:0,width:100,height:100})}),viewportSize:()=>({width:1200,height:700}),
    waitForTimeout:async()=>{},keyboard:{down:async()=>{},up:async()=>{},press:async key=>{if(key==='Space'){jumps++;if(!missFirst||jumps>1)index++;}}}};
  const trace=await followRoute(page,async()=>actor(),[points[2]],{map,touch:false,timeout:150});
  assert.equal(trace.samples.at(-1).supportId,'step2');assert.equal(jumps,missFirst?3:2);
  assert.equal(trace.inputs.filter(i=>i.jump).length,jumps);
});

test('digital endpoint arrival accepts a supported body within one clamped movement frame',async()=>{
  const map=MAPS[0],link=map.traversal.links.find(l=>l.id==='courtyard:original:building-2:approach:link:27');
  const actor={...link.from,z:link.from.z-.1034,yaw:Math.PI,pitch:0,health:100,grounded:true,supportId:link.fromSupportId,ladderId:null};
  const page={context:()=>({newCDPSession:async()=>({send:async()=>({}),detach:async()=>{}})}),
    locator:()=>({boundingBox:async()=>({x:0,y:0,width:100,height:100})}),viewportSize:()=>({width:1200,height:700}),
    waitForTimeout:async()=>{},keyboard:{down:async()=>{assert.fail('unnecessary full-speed key step overshoots the supported stair target');},up:async()=>{},press:async()=>{}}};
  const trace=await followRoute(page,async()=>({...actor}),[{...link.from,kind:'stair',supportId:link.fromSupportId}],{map,touch:false,timeout:100});
  assert.equal(trace.samples.at(-1).supportId,link.fromSupportId);
  assert.equal(trace.samples.at(-1).y,link.from.y);
  assert.equal(trace.inputs.some(i=>i.keys?.length),false);
});

test('digital descent accepts the exact lower jump platform without oscillating across its centre',async()=>{
  const map=MAPS.find(m=>m.id==='dust-town'),goal={x:13,y:4.909091,z:16.3,kind:'jump',descending:true,supportId:'dust-town:original:south-east:approach:step:10'};
  const actor={...goal,z:16.381477,yaw:0,pitch:0,health:40,grounded:true,ladderId:null};
  const page={context:()=>({newCDPSession:async()=>({send:async()=>({}),detach:async()=>{}})}),
    locator:()=>({boundingBox:async()=>({x:0,y:0,width:100,height:100})}),viewportSize:()=>({width:1200,height:700}),waitForTimeout:async()=>{},
    keyboard:{down:async()=>{assert.fail('unnecessary digital correction off the correct descent platform');},up:async()=>{},press:async()=>{}}};
  const trace=await followRoute(page,async()=>({...actor}),[goal],{map,touch:false,timeout:150});
  assert.equal(trace.samples.at(-1).supportId,goal.supportId);assert.equal(trace.samples.at(-1).y,goal.y);
});

test('driver recognises a reached descent platform before stopping to defend',async()=>{
  const map=MAPS.find(m=>m.id==='snow-base'),goal={x:-18.25,y:.9,z:-13.75,kind:'jump',descending:true,supportId:'snow-base:original:hut-1:approach:step:2'};
  const actor={...goal,x:-18.246247,z:-13.618912,yaw:0,pitch:0,health:82,grounded:true,ladderId:null};
  const page={context:()=>({newCDPSession:async()=>({send:async()=>({}),detach:async()=>{}})}),
    locator:()=>({boundingBox:async()=>({x:0,y:0,width:100,height:100})}),viewportSize:()=>({width:1200,height:700}),waitForTimeout:async()=>{},
    keyboard:{down:async()=>{assert.fail('already arrived');},up:async()=>{},press:async()=>{}}};
  const trace=await followRoute(page,async()=>({...actor}),[goal],{map,touch:false,timeout:150,
    defend:async()=>{assert.fail('defence must not interrupt a completed route goal');}});
  assert.equal(trace.samples.at(-1).supportId,goal.supportId);
  assert.equal(trace.samples.at(-1).health,82);
});

test('keyboard launches a nearby supported jump instead of chasing an unreachable six-centimetre centre',async()=>{
  const from={x:0,y:0,z:1.8},to={x:0,y:.5,z:.6};
  const map={id:'jump-offset',bounds:{min:-4,max:4},solids:[{id:'step',x:0,z:.6,w:1.6,d:1.2,minY:0,maxY:.5}],
    traversal:{roofs:[],stairs:[],ladders:[],links:[{id:'jump',from,to,kind:'jump',width:1.6,depth:1.2}]}};
  let landed=false,jumps=0;const actor=()=>({...landed?to:{...from,z:from.z+.17},yaw:0,pitch:0,health:100,grounded:true,supportId:landed?'step':'ground',ladderId:null});
  const page={context:()=>({newCDPSession:async()=>({send:async()=>({}),detach:async()=>{}})}),
    locator:()=>({boundingBox:async()=>({x:0,y:0,width:100,height:100})}),viewportSize:()=>({width:1200,height:700}),
    waitForTimeout:async()=>{},keyboard:{down:async()=>{},up:async()=>{},press:async key=>{if(key==='Space'){landed=true;jumps++;}}}};
  const trace=await followRoute(page,async()=>actor(),[to],{map,touch:false,timeout:150});
  assert.equal(jumps,1);assert.equal(trace.samples.at(-1).supportId,'step');assert.equal(trace.samples.at(-1).y,.5);
});

for(const touch of [true,false])test(`driver walks sideways past an unrelated Harbor ladder (touch=${touch})`,async()=>{
  const map=MAPS.find(m=>m.id==='harbor'),goal={x:-8,y:0,z:4.5};
  let actor={x:-8.249372932989552,y:0,z:5.0564991513209625,yaw:.0110982421875,pitch:0,health:100,grounded:true,supportId:'ground',ladderId:null};
  let pointer={x:0,y:0,held:false};
  const cdp={detach:async()=>{},send:async(name,args)=>{
    if(name==='Input.dispatchTouchEvent'&&['touchStart','touchMove'].includes(args.type)) {
      const point=args.touchPoints[0];assert.ok(Math.abs(point.y-50)<1e-8,'raw forward axis must remain zero beside the unrelated ladder');
      assert.ok(point.x>50);actor={...actor,...goal};
    }
  }};
  const page={context:()=>({newCDPSession:async()=>cdp}),locator:()=>({boundingBox:async()=>({x:0,y:0,width:100,height:100})}),viewportSize:()=>({width:1200,height:700}),waitForTimeout:async()=>{},
    mouse:{move:async(x,y)=>{if(pointer.held){actor.yaw-=(x-pointer.x)*.0026;actor.pitch-=(y-pointer.y)*.0026;}pointer={...pointer,x,y};},down:async()=>{pointer.held=true;},up:async()=>{pointer.held=false;}},
    keyboard:{down:async key=>{assert.equal(key,'KeyD','keyboard must strafe, not engage the incidental ladder');actor={...actor,...goal};},up:async()=>{},press:async()=>{}}};
  const trace=await followRoute(page,async()=>({...actor}),[goal],{map,touch,timeout:500});
  assert.equal(trace.samples.at(-1).supportId,'ground');assert.equal(trace.samples.some(s=>s.ladderId),false);
});

test('route fails immediately on Results even if the surviving actor still has health',async()=>{
  const map=MAPS[0],actor={...map.playerSpawn,y:0,yaw:0,pitch:0,health:40,grounded:true,supportId:'ground',ladderId:null,active:false};
  const page={context:()=>({newCDPSession:async()=>({send:async()=>({}),detach:async()=>{}})}),
    locator:()=>({boundingBox:async()=>({x:0,y:0,width:100,height:100})}),keyboard:{up:async()=>{}}};
  await assert.rejects(followRoute(page,async()=>actor,[actor],{map}),/route match remains active/);
});

for(const [phase,suspended,expected] of [['playing',false,true],['playing',true,false],['results',false,false]])test(`observer uses online input lifecycle, not disabled solo simulation (${phase}, suspended=${suspended})`,async()=>{
  const online={remotes:new Map(),running:true,suspended,room:{phase}};
  const cdp={detach:async()=>{},send:async(name,args)=>{
    if(name==='Runtime.evaluate'||name==='Runtime.queryObjects')return {result:{objectId:'objects'},objects:{objectId:'objects'}};
    if(name==='Runtime.releaseObjectGroup')return {};
    if(args.objectId==='objects')return {result:{objectId:args.functionDeclaration.includes('o?.remotes')?'online':'game'}};
    if(args.objectId==='game')return {result:{value:{active:false,player:{health:40}}}};
    if(args.objectId==='online')return {result:{value:Function(`return (${args.functionDeclaration})`)().call(online)}};
    assert.fail(`unexpected observer request ${name}`);
  }};
  const view=await observeGame({context:()=>({newCDPSession:async()=>cdp})});
  assert.equal((await view.actor()).active,expected);await view.close();
});

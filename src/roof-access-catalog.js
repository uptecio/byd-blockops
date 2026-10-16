import { entriesObject } from './entries-object.js';
// Authored roof identities and geometry are shared by the renderer, simulation,
// navigation and acceptance tests. No invisible collision-only surfaces.
const unit = { N:{x:0,z:-1}, E:{x:1,z:0}, S:{x:0,z:1}, W:{x:-1,z:0} };
const paint = { 'dust-town':'#a97446', 'snow-base':'#a9dfed', 'jungle-ruins':'#7c8769', 'space-station':'#354b63',
  courtyard:'#ba8854','neon-city':'#657189','desert-fort':'#d1a276',harbor:'#edb756' };
const round = n => Math.round(n*1e6)/1e6;

function stairRoute({mapId,routeId,local,point,supportId,span,normal,y,source,reverse,gateAlong}) {
  const count=Math.ceil(y/.24),a=span/2+1.15,b=normal/2+1.15,sign=reverse?-1:1;
  const corners=[[gateAlong,b],[sign*a,b],[sign*a,-b],[-sign*a,-b],[-sign*a,b],[gateAlong,b]];
  const shapes=[{p:local(gateAlong,b,0),run:1.6,landing:true,dx:0,dz:0}];
  if(source==='annex') {
    for(let i=0;shapes.length<count-1;i++) {
      const p=local(gateAlong,b+.8+.175+i*.35,0),q=local(gateAlong,b,0),length=Math.hypot(p.x-q.x,p.z-q.z);
      shapes.push({p,run:.35,landing:false,dx:(p.x-q.x)/length,dz:(p.z-q.z)/length});
    }
  } else for(let k=1;shapes.length<count-1;k++) {
    const p=local(...corners[(k-1)%5],0),q=local(...corners[k%5],0),length=Math.hypot(q.x-p.x,q.z-p.z);
    const dx=(q.x-p.x)/length,dz=(q.z-p.z)/length,n=Math.max(1,Math.floor((length-1.6)/.35)),run=(length-1.6)/n;
    for(let i=0;i<n && shapes.length<count-1;i++) shapes.push({p:{x:p.x+dx*(.8+run*(i+.5)),y:0,z:p.z+dz*(.8+run*(i+.5))},run,landing:false,dx,dz});
    if(shapes.length<count-1) shapes.push({p:q,run:1.6,landing:true,dx,dz});
  }
  shapes.reverse();
  const solids=[],treads=[];
  const first=shapes[0],back=first.run/2+.43;
  const start={x:round(first.p.x+first.dx*back),y:0,z:round(first.p.z+first.dz*back)};
  treads.push({supportId:'ground',point:start,clearWidth:1.6,run:1.2,landing:true});
  for(const [i,shape] of shapes.entries()) {
    const top=round(y*(i+1)/count),id=`${routeId}:tread:${i+1}`,alongX=Math.abs(shape.dx)>Math.abs(shape.dz);
    const s={id,x:round(shape.p.x),z:round(shape.p.z),w:round(shape.landing?1.6:alongX?shape.run:1.6),d:round(shape.landing?1.6:alongX?1.6:shape.run),
      minY:mapId==='neon-city'?round(Math.max(0,top-.18)):0,maxY:top,colour:paint[mapId]};
    solids.push(s);
    const offset=shape.landing?0:.421-shape.run/2;
    treads.push({supportId:id,point:{x:round(shape.p.x+shape.dx*offset),y:top,z:round(shape.p.z+shape.dz*offset)},clearWidth:1.6,run:shape.run,landing:shape.landing});
    // Spaced columns keep the ground lane walkable beneath fire escapes.
    if(s.minY>0 && (shape.landing || (i+1)%4===0)) for(const sign of [-1,1]) solids.push({id:`${id}:post:${sign}`,x:round(s.x+(alongX?0:sign*.7)),z:round(s.z+(alongX?sign*.7:0)),w:.12,d:.12,minY:0,maxY:s.minY,colour:paint[mapId]});
  }
  treads.push({supportId,point,clearWidth:1.6,run:1.2,landing:true});
  const links=treads.slice(1).map((t,i)=>{
    const a=treads[i].point,b=t.point,alongX=Math.abs(b.x-a.x)>Math.abs(b.z-a.z);
    return {fromSupportId:treads[i].supportId,toSupportId:t.supportId,
      corridor:{minX:Math.min(a.x,b.x)-(alongX?.1:.8),maxX:Math.max(a.x,b.x)+(alongX?.1:.8),
        minZ:Math.min(a.z,b.z)-(alongX?.8:.1),maxZ:Math.max(a.z,b.z)+(alongX?.8:.1)}};
  });
  return {kind:'stair',access:{id:`${routeId}:stairs`,routeId,treads,links},solids};
}

function ladderRoute({routeId,local,point,supportId,normal,y,gateAlong}) {
  const bottom=local(gateAlong,normal/2+.75,0),high={...bottom,y},ladderId=`${routeId}:ladder`;
  const zone=p=>({minX:p.x-.3,maxX:p.x+.3,minZ:p.z-.3,maxZ:p.z+.3}),solids=[];
  const near=local(gateAlong,normal/2+.1,0),alongX=Math.abs(near.x-bottom.x)<.01;
  for(const sign of [-1,1]) {
    const p=local(gateAlong+sign*.88,normal/2+.1,0);
    solids.push({id:`${ladderId}:rail:${sign}`,x:p.x,z:p.z,w:.16,d:.16,minY:0,maxY:y,colour:paint.harbor});
  }
  for(let n=1;n*.28<y;n++) solids.push({id:`${ladderId}:rung:${n}`,x:near.x,z:near.z,w:alongX?1.6:.12,d:alongX?.12:1.6,minY:round(n*.28-.05),maxY:round(n*.28+.05),colour:paint.harbor});
  return {kind:'ladder',access:{id:ladderId,routeId,width:1.6,path:[bottom,high,point],
    bottom:{point:bottom,supportId:'ground',zone:zone(bottom)},top:{point,supportId,zone:zone(point)}},solids};
}

function destination(mapId, {name,x,z,w,d,y,side,style='jump',source='original',capMin=y-.3,guardMin=capMin,colour,obstacles,screens=[],reverse=false,gateAlong=0,gateWidth=2.4,approach}) {
  const id=source==='annex'?`${mapId}:annex:${name}:position`:`${mapId}:original:${name}`;
  const supportId=source==='annex'?`${mapId}:annex:${name}:roof`:`${id}:cap`,routeId=`${id}:approach`;
  const u=unit[side],v={x:-u.z,z:u.x},span=u.x?d:w,normal=u.x?w:d;
  const local=(along,out,yValue)=>({x:round(x+v.x*along+u.x*out),y:round(yValue),z:round(z+v.z*along+u.z*out)});
  const point=local(gateAlong,normal/2-.6,y),solids=[],guardSolidIds=[];
  if(!obstacles) {
    obstacles=[];
    if(source==='original' && mapId==='dust-town') obstacles=[{x:side==='W'?1.5:-1.5,z:side==='S'?-1:1,w:2,d:2,h:1.2,colour:'#d5a86b'}];
    if(source==='original' && mapId==='snow-base' && name.startsWith('hut')) obstacles=[{x:side==='W'?.7:-.7,z:.8,w:1,d:1,h:1}];
    if(source==='original' && mapId==='jungle-ruins') obstacles=[{x:w>d?-2.75:0,z:d>w?-3:0,w:1.5,d:1.5,h:.76}];
    if(source==='original' && mapId==='courtyard') obstacles=[{x:side==='E'?-1.5:1.5,z:side==='S'?-1:1,w:2.5,d:2.5,h:1.2},{x:side==='E'?-1.5:1.5,z:side==='S'?-1:1,w:2.7,d:2.7,minY:1.17,h:1.33,colour:'#fff2d1'}];
    if(source==='original' && mapId==='desert-fort' && name.startsWith('tower')) obstacles=[-2,2].flatMap(x=>[-2,2].map(z=>({x,z,w:1,d:1,h:1,colour:'#bc8055'})));
  }
  const prism=(suffix,cx,cz,sw,sd,minY,maxY,c)=>{const s={id:`${id}:${suffix}`,x:round(cx),z:round(cz),w:round(sw),d:round(sd),minY:round(minY),maxY:round(maxY),colour:c};solids.push(s);return s.id;};
  if(source==='original') solids.push({id:supportId,x,z,w,d,minY:capMin,maxY:y,colour});
  for(const [i,o] of obstacles.entries()) prism(`cover:${i}`,x+o.x,z+o.z,o.w,o.d,y+(o.minY||0),y+o.h,o.colour||paint[mapId]);
  for(const [i,s] of screens.entries()) guardSolidIds.push(prism(`screen:${i}`,s.x,s.z,s.w,s.d,s.minY,s.maxY,colour));
  // Thick, low parapets cover the edge support band as well as the roof itself.
  // The one gate is a full-width, visible final landing, not an invisible lock.
  for(const face of ['N','E','S','W']) {
    const a=unit[face],horizontal=!a.x,length=(horizontal?w:d)+.7,offset=(horizontal?d:w)/2;
    const add=(suffix,along,len)=>guardSolidIds.push(prism(`guard:${face}:${suffix}`,x+a.x*offset+(horizontal?along:0),z+a.z*offset+(horizontal?0:along),horizontal?len:.7,horizontal?.7:len,source==='annex'?y:guardMin,y+.9,colour));
    if(face===side) {const gate=gateWidth,offset=gateAlong*(horizontal?v.x:v.z),left=length/2+offset-gate/2,right=length/2-offset-gate/2;add('a',-length/2+left/2,left);add('b',length/2-right/2,right);}
    else add('wall',0,length);
  }
  const standingCenter=local(gateAlong,normal/2-1.15,y),standingArea={minX:standingCenter.x-.8,maxX:standingCenter.x+.8,minZ:standingCenter.z-.8,maxZ:standingCenter.z+.8};
  if(style!=='jump') {
    const parameters={mapId,routeId,local,point,supportId,span,normal,y,source,reverse,gateAlong};
    const route=style==='stair'?stairRoute(parameters):ladderRoute(parameters),last=style==='stair'?route.access.links.length:1;
    return {id,source,supportId,standingArea,point,routeId,entryLinkId:`${routeId}:link:${last}`,
      routeSolidIds:route.solids.map(s=>s.id),guardSolidIds,solids,route};
  }
  const count=approach?approach.length:Math.ceil(y/.5),a=span/2+1.15,b=normal/2+1.15,sign=reverse?-1:1;
  const corners=[[gateAlong,b],[sign*a,b],[sign*a,-b],[-sign*a,-b],[-sign*a,b],[gateAlong,b]];
  const outside=[local(gateAlong,b,0)];
  for(let k=1;outside.length<count;k++) {
    const p=corners[(k-1)%5],q=corners[k%5],length=Math.hypot(q[0]-p[0],q[1]-p[1]),steps=Math.max(1,Math.ceil(length/1.65));
    for(let n=1;n<=steps && outside.length<count;n++) outside.push(local(p[0]+(q[0]-p[0])*n/steps,p[1]+(q[1]-p[1])*n/steps,0));
  }
  const points=source==='annex'?[8.3,6.9,5.5,4.1,2.7,1.3].map((offset,i)=>local(gateAlong,offset,i*.44)):(approach||outside.reverse()).map((p,i)=>({...p,y:round(y*i/count)}));
  if(source==='annex') Object.assign(point,points[points.length-1]); else points.push(point);
  const routeSolidIds=points.slice(1,-1).flatMap((_,i)=>{const id=`${routeId}:step:${i+1}`;return mapId==='space-station'?[id,`${id}:post:-1`,`${id}:post:1`]:[id];});
  return {id,source,supportId,standingArea,point,routeId,entryLinkId:`${routeId}:link:${points.length-1}`,routeSolidIds,guardSolidIds,solids,
    route:{kind:'jump',points,width:1.6,depth:1.4,colour:paint[mapId],slabThickness:mapId==='space-station'?.18:0}};
}

const annex=(name,x,z,side,colour,reverse=false)=>({name,x,z,w:4,d:4,y:2.2,side,source:'annex',colour,reverse});
const definitions={
  courtyard:{style:'stair',theme:'brick stairs',colour:'#fff2d1',destinations:[
    ...[[-15,-14,6.7],[15,-14,7.5],[-15,14,5.7],[15,14,6.3]].map(([x,z,y],i)=>({name:`building-${i+1}`,x,z,w:8.4,d:8.4,y,capMin:y-.5,guardMin:0,side:x<0?(z>0?'S':'E'):'W',reverse:x<0})),
    annex(1,19,-7,'W','#fff2d1'),annex(2,-15,6.5,'E','#fff2d1')
  ]},
  'neon-city':{style:'stair',theme:'fire escape',colour:'#49e0db',destinations:[
    ...[[-11,-11,8.2],[11,-11,10.2],[-11,11,10.2],[11,11,8.2]].map(([x,z,y],i)=>({name:`tower-${i+1}`,x,z,w:10.2,d:10.2,y,capMin:y-.2,guardMin:0,side:x<0?'E':'W'})),
    ...[[-18,-1],[18,1]].map(([x,z],i)=>({name:`service-${i+1}`,x,z,w:3.2,d:5.2,y:3.3,capMin:3,side:x<0?'S':'N',colour:'#ddbc5c'})),
    annex(1,-19,-8.5,'N','#49e0db'),annex(2,19,8.5,'S','#49e0db')
  ]},
  'desert-fort':{style:'stair',theme:'stone stairs',colour:'#edd0a2',destinations:[
    ...[[-17,-12,'N',true],[17,-12,'W',false],[-17,12,'E',false],[17,12,'S',true]].map(([x,z,side,reverse],i)=>({name:`tower-${i+1}`,x,z,w:5.4,d:5.4,y:6.6,capMin:6.2,guardMin:0,side,reverse})),
    ...[-9,9].map((x,i)=>({name:`gate-${i+1}`,x,z:0,w:10.4,d:3.4,y:4.7,capMin:4.5,guardMin:3.8,side:x<0?'S':'N'})),
    annex(1,-15,-6.5,'E','#edd0a2'),annex(2,15,6.5,'W','#edd0a2')
  ]},
  harbor:{style:'ladder',theme:'cargo ladders',colour:'#d0d8d8',destinations:[
    ...[[-12,-11,5,10],[-5,-11,5,10],[12,11,5,10],[5,11,5,10],[-13,5,8,4],[13,-5,8,4]].map(([x,z,w,d],i)=>({name:`container-${i+1}`,x,z,w,d,y:3.6,capMin:3.4,guardMin:0,side:x<0?'E':'W'})),
    annex(1,-17.5,-11,'N','#d0d8d8'),annex(2,17.5,11,'S','#d0d8d8')
  ]},
  'dust-town':{style:'jump',theme:'wooden crates',colour:'#f1d5a0',destinations:[
    {name:'north-west',x:-13,z:-11,w:8.3,d:7.3,y:5.4,guardMin:0,side:'E'},
    {name:'north-east',x:12,z:-7,w:8.3,d:8.3,y:5.4,guardMin:0,side:'W'},
    {name:'south-west',x:-12,z:9,w:9.3,d:7.3,y:5.4,guardMin:0,side:'E'},
    {name:'south-east',x:13,z:12,w:8.3,d:6.3,y:5.4,guardMin:0,side:'S'},
    annex(1,19,-8,'N','#f1d5a0'),annex(2,12,6,'E','#f1d5a0')
  ]},
  'snow-base':{style:'jump',theme:'ice blocks',colour:'#ffffff',destinations:[
    {name:'research',x:0,z:0,w:11.5,d:8.5,y:4.5,guardMin:0,side:'S',gateAlong:2},
    ...[[-15,-10,'W'],[15,-10,'E'],[-15,10,'W'],[15,10,'E']].map(([x,z,side],i)=>({name:`hut-${i+1}`,x,z,w:4.2,d:5.2,y:2.7,side})),
    ...[-15,15].map((x,i)=>({name:`side-${i+1}`,x,z:0,w:4.3,d:4.3,y:3.6,side:x<0?'W':'E'})),
    annex(1,-8.5,-8,'N','#ffffff'),annex(2,8.5,8,'S','#ffffff')
  ]},
  'jungle-ruins':{style:'jump',theme:'broken stone',colour:'#b1b491',destinations:[
    {name:'north',x:-7,z:-10,w:11,d:3.4,y:3.24,side:'N'},
    {name:'east',x:8,z:-5,w:3.4,d:11,y:3.74,side:'E'},
    {name:'west',x:-8,z:4,w:3.4,d:11,y:3.04,side:'W'},
    {name:'south',x:7,z:10,w:11,d:3.4,y:3.24,side:'S'},
    {...annex(1,-16,-7.25,'E','#b1b491'),gateAlong:.2},{...annex(2,16,7.25,'W','#b1b491'),gateAlong:.2}
  ]},
  'space-station':{style:'jump',theme:'metal platforms',colour:'#6de3cc',destinations:[
    ...[-8,8].flatMap(z=>[-11,11].map(x=>({name:`horizontal-${x<0?'w':'e'}-${z<0?'n':'s'}`,x,z,w:12,d:3.4,y:4,side:z<0?'S':'N',gateAlong:-Math.sign(x)*Math.sign(z)*3.2,
      approach:Array.from({length:8},(_,i)=>({x:Math.sign(x)*(17.6-1.4*i),z:z-Math.sign(z)*2.85}))}))),
    ...[-8,8].flatMap(x=>[-13,13].map(z=>({name:`vertical-${x<0?'w':'e'}-${z<0?'n':'s'}`,x,z,w:3.4,d:5,y:4,side:x<0?'E':'W',reverse:x*z>0}))),
    {name:'reactor',x:0,z:0,w:7.8,d:7.8,y:5.2,capMin:4.8,side:'W',gateWidth:1.6,
      screens:[-1.25,1.25].map(z=>({x:-5.6,z,w:4,d:.9,minY:4,maxY:6.1})),
      approach:[{x:-20.1,z:-2.6},{x:-20.1,z:-1.3},{x:-20.1,z:0},{x:-18.9,z:0},...Array.from({length:9},(_,i)=>({x:-17.3+12.25*i/8,z:0}))],
      obstacles:[{x:0,z:0,w:3.2,d:3.2,h:2.2,colour:'#6de3cc'},{x:0,z:0,w:4.5,d:4.5,minY:2.2,h:2.6,colour:'#aab8c3'}]},
    annex(1,-16,-12,'N','#6de3cc'),annex(2,16,12,'S','#6de3cc')
  ]}
};
export const ROOF_ACCESS=entriesObject(Object.entries(definitions).map(([id,record])=>[id,{style:record.style,theme:record.theme,
  destinations:record.destinations.map(d=>destination(id,{colour:record.colour,style:record.style,...d}))}]));

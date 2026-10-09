// Authored roof identities and geometry are shared by the renderer, simulation,
// navigation and acceptance tests. No invisible collision-only surfaces.
const unit = { N:{x:0,z:-1}, E:{x:1,z:0}, S:{x:0,z:1}, W:{x:-1,z:0} };
const paint = { 'dust-town':'#a97446', 'snow-base':'#a9dfed', 'jungle-ruins':'#7c8769', 'space-station':'#354b63' };
const round = n => Math.round(n*1e6)/1e6;

function jumpDestination(mapId, {name,x,z,w,d,y,side,source='original',capMin=y-.3,guardMin=capMin,colour,obstacles,screens=[],reverse=false,gateAlong=0,gateWidth=2.4,approach}) {
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
  const standingCenter=local(gateAlong,normal/2-1.15,y),standingArea={minX:standingCenter.x-(u.x?.6:.8),maxX:standingCenter.x+(u.x?.6:.8),minZ:standingCenter.z-(u.z?.6:.8),maxZ:standingCenter.z+(u.z?.6:.8)};
  // Standing rectangles describe the usable deck, including room for a body.
  if(u.x){standingArea.minX-=.2;standingArea.maxX+=.2;}else{standingArea.minZ-=.2;standingArea.maxZ+=.2;}
  return {id,source,supportId,standingArea,point,routeId,entryLinkId:`${routeId}:link:${points.length-1}`,routeSolidIds,guardSolidIds,solids,
    route:{kind:'jump',points,width:1.6,depth:1.4,colour:paint[mapId],slabThickness:mapId==='space-station'?.18:0}};
}

const annex=(name,x,z,side,colour,reverse=false)=>({name,x,z,w:4,d:4,y:2.2,side,source:'annex',colour,reverse});
const definitions={
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
export const ROOF_ACCESS=Object.fromEntries(Object.entries(definitions).map(([id,record])=>[id,{style:record.style,theme:record.theme,
  destinations:record.destinations.map(d=>jumpDestination(id,{colour:record.colour,...d}))}]));

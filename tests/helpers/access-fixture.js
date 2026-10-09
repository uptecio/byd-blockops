import { createSpatialWorld } from '../../src/spatial.js';
import { addRoom, addHideSpot } from '../../src/map-traversal.js';

// Hand-authored isolated geometry, never based on a production access builder.
export function accessFixture({ kind = 'ladder', blocked = false } = {}) {
  const map = { id: 'access-fixture', bounds: { min: -20, max: 20 }, solids: [], blocks: [],
    traversal: { roofs: [], shelters: [], links: [], patrolPoints: [], stairs: [], ladders: [] }, hideSpots: [] };
  const builder = { traversal: map.traversal, hideSpots: map.hideSpots,
    prism(shape, colour) {
      map.solids.push({ ...shape, height: shape.maxY - shape.minY });
      map.blocks.push({ solidId: shape.id, x: shape.x, y: (shape.minY + shape.maxY) / 2,
        z: shape.z, w: shape.w, h: shape.maxY - shape.minY, d: shape.d, colour });
    } };
  for (const x of [-10, 10]) {
    const id = `room:${x}`;
    addRoom(builder, { id, x, z: 10, w: 4, d: 4, roofY: 2.2, doorSide: 'S', colour: '#999', trim: '#aaa' });
    map.traversal.roofs.push({ id: `${id}:position`, point: { x, y: 2.2, z: 10 }, supportId: `${id}:roof`, singleEntrance: false });
    addHideSpot(builder, { id: `${id}:hide`, kind: 'locker', facing: 'S', occupant: {x,y:0,z:9},
      entry: {x,y:0,z:10.3}, exit: {x,y:0,z:10.3}, recovery: {x,y:0,z:10.6}, view: {x,y:1.65,z:9.35},
      proxy: { min: {x:x-.62,y:0,z:8.38}, max: {x:x+.62,y:2,z:9.62} } }, {colour:'#777',trim:'#888'});
  }
  let start, goal;
  const ladderId = 'fixture:ladder';
  if (kind === 'ladder') {
    start = {x:0,y:0,z:-1.5}; goal = {x:0,y:2.4,z:-2.7};
    builder.prism({id:'deck',x:0,z:-4,w:4,d:4,minY:0,maxY:2.4}, '#abc');
    const zone = p => ({ minX:p.x-.3,maxX:p.x+.3,minZ:p.z-.3,maxZ:p.z+.3 });
    map.traversal.ladders.push({id:ladderId,routeId:'ladder-route',width:1.6,
      path:[start,{x:0,y:2.4,z:-1.5},goal],
      bottom:{point:start,supportId:'ground',zone:zone(start)},top:{point:goal,supportId:'deck',zone:zone(goal)} });
    map.traversal.links.push({id:'ladder-link',from:start,to:goal,kind:'ladder',ladderId,width:1.6,depth:1.2,routeId:'ladder-route'});
    if (blocked) builder.prism({id:'shaft-block',x:.35,z:-1.5,w:.1,d:.1,minY:1.9,maxY:2.1},'#f00');
  } else {
    start = {x:0,y:0,z:1.2}; goal = {x:0,y:.8,z:-1.075};
    const treads = [{supportId:'ground',point:start,clearWidth:1.6,run:1.2,landing:true}];
    for (let i = 0; i < 3; i++) {
      const z = .4 - i * .35, y = (i + 1) * .2, id = `tread:${i}`;
      builder.prism({id,x:0,z,w:1.6,d:.35,minY:0,maxY:y},'#aaa');
      treads.push({supportId:id,point:{x:0,y,z:z+.246},clearWidth:1.6,run:.35,landing:false});
    }
    builder.prism({id:'landing',x:0,z:goal.z,w:1.6,d:1.2,minY:0,maxY:.8},'#ccc');
    treads.push({supportId:'landing',point:goal,clearWidth:1.6,run:1.2,landing:true});
    const links = treads.slice(1).map((t,i) => ({fromSupportId:treads[i].supportId,toSupportId:t.supportId,
      corridor:{minX:-.8,maxX:.8,minZ:t.point.z-.1,maxZ:treads[i].point.z+.1}}));
    if (kind === 'stair') map.traversal.stairs.push({id:'fixture:stairs',routeId:'stair-route',treads,links});
    if (kind === 'stair') treads.slice(1).forEach((t,i) => map.traversal.links.push({id:`stair-link:${i}`,
      from:treads[i].point,to:t.point,kind:'stair',width:1.6,depth:t.run,routeId:'stair-route',
      fromSupportId:treads[i].supportId,toSupportId:t.supportId}));
    if (blocked) builder.prism({id:'stair-ceiling',x:0,z:.3,w:2,d:2,minY:1.95,maxY:2.1},'#f00');
  }
  return { map, world:createSpatialWorld(map), start:{...start}, goal:{...goal}, ladderId };
}

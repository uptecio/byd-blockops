import { ROOF_ACCESS } from './roof-access-catalog.js';
import { addStepRoute } from './map-traversal.js';

export function addRoofAccess(builder,mapId) {
  const catalog=ROOF_ACCESS[mapId]; if(!catalog) return;
  for(const destination of catalog.destinations) {
    for(const solid of destination.solids) builder.prism(solid,solid.colour);
    let route;
    const authored=destination.route;
    if(authored.kind==='jump') route=addStepRoute(builder,{id:destination.routeId,...authored});
    else {
      for(const s of authored.solids) builder.prism(s,s.colour);
      if(authored.kind==='stair') {
        (builder.traversal.stairs||=[]).push(authored.access);
        const treads=authored.access.treads;
        treads.slice(1).forEach((t,i)=>builder.traversal.links.push({id:`${destination.routeId}:link:${i+1}`,routeId:destination.routeId,
          from:treads[i].point,to:t.point,kind:'stair',width:1.6,depth:t.run,fromSupportId:treads[i].supportId,toSupportId:t.supportId}));
      } else {
        (builder.traversal.ladders||=[]).push(authored.access);
        builder.traversal.links.push({id:destination.entryLinkId,routeId:destination.routeId,from:authored.access.bottom.point,to:authored.access.top.point,
          kind:'ladder',ladderId:authored.access.id,width:1.6,depth:1.2});
      }
      route={entryLinkId:destination.entryLinkId,solidIds:destination.routeSolidIds};
    }
    builder.traversal.roofs.push({...destination,style:catalog.style,theme:catalog.theme,singleEntrance:true,
      entryLinkId:route.entryLinkId,routeSolidIds:route.solidIds});
    builder.traversal.patrolPoints.push(authored.kind==='jump'?authored.points[0]:authored.kind==='stair'?authored.access.treads[0].point:authored.access.bottom.point);
  }
}

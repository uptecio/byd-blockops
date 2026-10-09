import { ROOF_ACCESS } from './roof-access-catalog.js';
import { addStepRoute } from './map-traversal.js';

export function addRoofAccess(builder,mapId) {
  const catalog=ROOF_ACCESS[mapId]; if(!catalog) return;
  for(const destination of catalog.destinations) {
    for(const solid of destination.solids) builder.prism(solid,solid.colour);
    const route=addStepRoute(builder,{id:destination.routeId,...destination.route});
    builder.traversal.roofs.push({...destination,style:catalog.style,theme:catalog.theme,singleEntrance:true,
      entryLinkId:route.entryLinkId,routeSolidIds:route.solidIds});
    builder.traversal.patrolPoints.push(destination.route.points[0]);
  }
}

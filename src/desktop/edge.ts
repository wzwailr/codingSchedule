import type {FoldGeometry,WidgetRect} from '../shared/ui-contract.js';
export type DockEdge='left'|'right'|'top'|'bottom';
export function dockEdge(layout:FoldGeometry,area:WidgetRect):DockEdge|null{
 const {screen:s,bounds:b}=layout,distances:{edge:DockEdge;distance:number}[]=[{edge:'left',distance:b.x+s.x-area.x},{edge:'right',distance:area.x+area.width-b.x-s.x-s.width},{edge:'top',distance:b.y+s.y-area.y},{edge:'bottom',distance:area.y+area.height-b.y-s.y-s.height}];
 const nearest=distances.sort((a,b)=>a.distance-b.distance)[0]!;return nearest.distance<=24?nearest.edge:null;
}
export function edgeBounds(layout:FoldGeometry,area:WidgetRect,edge:DockEdge):WidgetRect{
 const vertical=edge==='left'||edge==='right',width=vertical?32:Math.min(64,area.width),height=vertical?Math.min(64,area.height):40;
 return {x:Math.round(vertical?(edge==='left'?area.x:area.x+area.width-width):Math.max(area.x,Math.min(layout.anchor.x-width/2,area.x+area.width-width))),y:Math.round(vertical?Math.max(area.y,Math.min(layout.anchor.y-height/2,area.y+area.height-height)):(edge==='top'?area.y:area.y+area.height-height)),width,height};
}
// Match the CSS capsule; Windows needs at least 32 DIP width and 39 DIP height.
// Horizontal tabs use 40 DIP so their actual bounds stay inside the work area.
export function edgeShape(bounds:WidgetRect):WidgetRect[]{
 const {width,height}=bounds,radius=Math.min(width,height)/2,rects:WidgetRect[]=[];
 for(let y=0;y<height;y++){
  const dy=Math.max(radius-y-.5,y+.5-height+radius,0),inset=Math.floor(radius-Math.sqrt(Math.max(0,radius*radius-dy*dy)));
  const row={x:inset,y,width:width-2*inset,height:1},previous=rects.at(-1);
  if(previous&&previous.x===row.x&&previous.width===row.width)previous.height++;else rects.push(row);
 }
 return rects;
}

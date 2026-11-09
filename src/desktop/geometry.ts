import type {FoldGeometry,FoldSurface,WidgetRect} from '../shared/ui-contract.js';
import {MIN_SCALE,MAX_SCALE,normalizeAppearance,screenMetrics} from '../shared/appearance.js';
export type Rect=WidgetRect;
export const FOLD_CLOSED={width:148,height:272};
export const FOLD_OPEN={width:456,height:416};
export function clampBounds(bounds:Rect,area:Rect):Rect {
  const width=Math.min(bounds.width,area.width),height=Math.min(bounds.height,area.height);
  return {x:Math.max(area.x,Math.min(bounds.x,area.x+area.width-width)),y:Math.max(area.y,Math.min(bounds.y,area.y+area.height-height)),width,height};
}
export function scaleLimit(area:Rect):number{return Math.min(MAX_SCALE,Math.max(MIN_SCALE,Math.min(area.width/FOLD_OPEN.width,area.height/FOLD_OPEN.height)));}
export function foldLayout(point:{x:number;y:number},area:Rect,expanded:boolean,requestedScale=1):FoldGeometry {
  const scale=Math.min(normalizeAppearance({scale:requestedScale}).scale,scaleLimit(area)),px=(n:number)=>Math.max(1,Math.round(n*scale)),metrics=screenMetrics(scale),margin=metrics.margin;
  const wingScale=Math.max(1,scale),wp=(n:number)=>Math.max(1,Math.round(n*wingScale));
  const fullWidth=metrics.width+2*margin,fullHeight=metrics.height+2*margin;
  const swingWidth=Math.min(scale>=1?px(FOLD_OPEN.width):margin+metrics.width+wp(320),area.width);
  const width=Math.min(expanded?swingWidth:fullWidth,area.width),height=Math.min(expanded?wp(FOLD_OPEN.height):fullHeight,area.height);
  const screenWidth=Math.max(1,Math.min(metrics.width,width-2*margin)),screenHeight=Math.max(1,Math.min(metrics.height,height-2*margin));
  const closed=clampBounds({x:Math.round(point.x-screenWidth/2-margin),y:Math.round(point.y-screenHeight/2-margin),width:Math.min(fullWidth,area.width),height:Math.min(fullHeight,area.height)},area);
  const anchor={x:closed.x+margin+screenWidth/2,y:closed.y+margin+screenHeight/2};
  const fitsRight=anchor.x-screenWidth/2-margin+swingWidth<=area.x+area.width;
  const fitsLeft=anchor.x+screenWidth/2+margin-swingWidth>=area.x;
  const side=fitsRight||!fitsLeft&&area.x+area.width-anchor.x>=anchor.x-area.x?'right':'left';
  const screenX=side==='right'?margin:width-screenWidth-margin;
  const bounds=clampBounds({x:Math.round(anchor.x-screenX-screenWidth/2),y:Math.round(anchor.y-height/2),width,height},area);
  const screenY=Math.max(margin,Math.min(height-screenHeight-margin,Math.round(anchor.y-bounds.y-screenHeight/2)));
  const radii=(values:number[])=>values.map(px) as [number,number,number,number];
  const screen:FoldSurface={x:screenX,y:screenY,width:screenWidth,height:screenHeight,angle:side==='right'?-2:2,radii:radii(side==='right'?[28,16,16,28]:[16,28,28,16])};
  const wing:FoldSurface|null=expanded?{x:side==='right'?screenX+screenWidth+wp(12):wp(20),y:wp(20),width:Math.max(1,width-screenWidth-margin-wp(32)),height:Math.max(1,height-wp(40)),angle:side==='right'?1.5:-1.5,radii:(side==='right'?[16,34,28,16]:[34,16,16,28]).map(wp) as [number,number,number,number]}:null;
  const hingeHeight=Math.max(1,Math.min(px(168),screenHeight-px(44)));
  const hinge={x:expanded?(side==='right'?screenX+screenWidth-px(3):screenX-px(15)):(side==='right'?screenX+screenWidth-px(3):screenX-px(5)),y:Math.round(screenY+screenHeight/2-hingeHeight/2),width:px(expanded?18:8),height:hingeHeight};
  return {bounds,anchor:{x:bounds.x+screenX+screenWidth/2,y:bounds.y+screenY+screenHeight/2},scale,density:metrics.density,screenScale:metrics.contentScale,wingScale,side,screen,wing,hinge};
}

// The same rotated rounded surfaces drive CSS and the native input region.
// Windows excludes the unused canvas and gaps between the two physical wings.
function surfaceRegion(surface:FoldSurface,bounds:Rect,pad:number):Rect[]{
  const x=surface.x-pad,y=surface.y-pad,width=surface.width+pad*2,height=surface.height+pad*2;
  const radii=surface.radii.map(r=>Math.max(0,Math.min(r+pad,width/2,height/2))),points:Array<{x:number;y:number}>=[];
  const corners=[[x+radii[0]!,y+radii[0]!,180],[x+width-radii[1]!,y+radii[1]!,270],[x+width-radii[2]!,y+height-radii[2]!,0],[x+radii[3]!,y+height-radii[3]!,90]];
  const angle=surface.angle*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle),cx=x+width/2,cy=y+height/2;
  corners.forEach(([cornerX,cornerY,start],i)=>{for(let n=0;n<=8;n++){const t=(start!+n*90/8)*Math.PI/180,px=cornerX!+radii[i]!*Math.cos(t)-cx,py=cornerY!+radii[i]!*Math.sin(t)-cy;points.push({x:cx+px*cos-py*sin,y:cy+px*sin+py*cos});}});
  const rects:Rect[]=[];
  for(let row=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y))));row<Math.min(bounds.height,Math.ceil(Math.max(...points.map(p=>p.y))));row++){
    const yy=row+.5,crossings:number[]=[];
    for(let i=0;i<points.length;i++){const a=points[i]!,b=points[(i+1)%points.length]!;if(a.y<=yy&&b.y>yy||b.y<=yy&&a.y>yy)crossings.push(a.x+(yy-a.y)*(b.x-a.x)/(b.y-a.y));}
    if(crossings.length<2)continue;const left=Math.max(0,Math.floor(Math.min(...crossings))),right=Math.min(bounds.width,Math.ceil(Math.max(...crossings)));if(right<=left)continue;
    const previous=rects.at(-1);if(previous&&previous.x===left&&previous.width===right-left&&previous.y+previous.height===row)previous.height++;else rects.push({x:left,y:row,width:right-left,height:1});
  }
  return rects;
}
export function foldShape(layout:FoldGeometry):Rect[]{
  return [layout.screen,...(layout.wing?[layout.wing]:[]),{...layout.hinge,angle:0,radii:[4,4,4,4].map(r=>r*layout.scale) as [number,number,number,number]}].flatMap(surface=>surfaceRegion(surface,layout.bounds,(surface===layout.screen||surface===layout.wing?4:1)*layout.scale));
}

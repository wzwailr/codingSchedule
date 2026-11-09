import type {FoldGeometry,FoldSurface,WidgetRect} from '../shared/ui-contract.js';
import {MIN_SCALE,MAX_SCALE,normalizeAppearance,screenMetrics} from '../shared/appearance.js';
import {DEFAULT_THEME,THEMES,type WidgetTheme} from '../shared/themes.js';
export type Rect=WidgetRect;
export const FOLD_CLOSED={width:148,height:272};
export const FOLD_OPEN={width:456,height:416};
export function clampBounds(bounds:Rect,area:Rect):Rect {
  const width=Math.min(bounds.width,area.width),height=Math.min(bounds.height,area.height);
  return {x:Math.max(area.x,Math.min(bounds.x,area.x+area.width-width)),y:Math.max(area.y,Math.min(bounds.y,area.y+area.height-height)),width,height};
}
export function scaleLimit(area:Rect,theme:WidgetTheme=DEFAULT_THEME):number{
 if(theme==='porthole')return Math.min(MAX_SCALE,Math.max(MIN_SCALE,Math.min(area.width/FOLD_OPEN.width,area.height/FOLD_OPEN.height)));
 const t=THEMES[theme],stack=t.arrangement==='stack';
 const width=(stack?Math.max(t.screen.width,t.wing.width):t.screen.width+16+t.wing.width)+24;
 const height=(stack?t.screen.height+8+t.wing.height:Math.max(t.screen.height,t.wing.height))+24;
 return Math.min(MAX_SCALE,Math.max(MIN_SCALE,Math.min(area.width/width,area.height/height)));
}
export function foldLayout(point:{x:number;y:number},area:Rect,expanded:boolean,requestedScale=1,theme:WidgetTheme=DEFAULT_THEME):FoldGeometry {
 if(theme==='porthole')return portholeLayout(point,area,expanded,requestedScale);
 const t=THEMES[theme],scale=Math.min(normalizeAppearance({scale:requestedScale}).scale,scaleLimit(area,theme));
 const m=screenMetrics(scale,theme),margin=m.margin,wingScale=Math.max(1,scale),wp=(n:number)=>Math.round(n*wingScale);
 const sw=Math.max(1,Math.min(m.width,area.width-2*margin)),sh=Math.max(1,Math.min(m.height,area.height-2*margin));
 const closed=clampBounds({x:Math.round(point.x-sw/2-margin),y:Math.round(point.y-sh/2-margin),width:Math.min(area.width,sw+2*margin),height:Math.min(area.height,sh+2*margin)},area);
 const anchor={x:closed.x+margin+sw/2,y:closed.y+margin+sh/2};
 const right=area.x+area.width-margin-anchor.x-sw/2,left=anchor.x-sw/2-area.x-margin;
 const wingWidth=Math.min(wp(t.wing.width),area.width-2*margin),sideGap=Math.round(16*scale);
 const sideways=t.arrangement==='side'&&(right>=wingWidth+sideGap||left>=wingWidth+sideGap);
 const side:'left'|'right'=right>=wingWidth+sideGap||right>=left?'right':'left';
 const gap=sideways?sideGap:Math.max(4,Math.round(8*scale));
 const below=area.y+area.height-margin-anchor.y-sh/2,above=anchor.y-sh/2-area.y-margin;
 const placement=sideways?side:below>=above?'bottom':'top';
 let bounds=closed,sx=margin,sy=margin,wing:FoldSurface|null=null;
 if(expanded){
  if(sideways){
   const wh=Math.min(wp(t.wing.height),area.height-2*margin),width=sw+gap+wingWidth+2*margin,height=Math.max(sh,wh)+2*margin;
   sx=side==='right'?margin:margin+wingWidth+gap;
   bounds=clampBounds({x:Math.round(anchor.x-sx-sw/2),y:Math.round(anchor.y-height/2),width,height},area);sy=anchor.y-bounds.y-sh/2;
   const wy=Math.max(margin,Math.min(height-wh-margin,sy+(sh-wh)/2));
   wing={x:side==='right'?sx+sw+gap:margin,y:Math.round(wy),width:wingWidth,height:wh,angle:0,radii:[8,24,24,8].map(r=>r*wingScale) as [number,number,number,number]};
  }else{
   const available=Math.max(below,above),wh=Math.max(1,Math.min(wp(t.wing.height),available-gap));
   const width=Math.max(sw,wingWidth)+2*margin,height=sh+gap+wh+2*margin;
   sy=placement==='bottom'?margin:margin+wh+gap;
   bounds=clampBounds({x:Math.round(anchor.x-width/2),y:Math.round(anchor.y-sy-sh/2),width,height},area);sx=anchor.x-bounds.x-sw/2;
   const wx=Math.max(margin,Math.min(width-wingWidth-margin,sx+(sw-wingWidth)/2));
   wing={x:Math.round(wx),y:placement==='bottom'?sy+sh+gap:margin,width:wingWidth,height:wh,angle:0,radii:[t.radius,t.radius,t.radius,t.radius].map(r=>Math.min(r,16)*wingScale) as [number,number,number,number]};
  }
 }
 const radius=theme==='disc'?Math.min(sw,sh)/2:m.density==='normal'?t.radius*scale:Math.min(20,sw/2,sh/2);
 const screen:FoldSurface={x:sx,y:sy,width:sw,height:sh,angle:0,radii:[radius,radius,radius,radius]};
 return {bounds,anchor,theme,scale,density:m.density,screenScale:m.contentScale,wingScale,side,placement,screen,wing};
}

// Preserve the original two-wing device, including its angles and hinge.
function portholeLayout(point:{x:number;y:number},area:Rect,expanded:boolean,requestedScale:number):FoldGeometry{
 const scale=Math.min(normalizeAppearance({scale:requestedScale}).scale,scaleLimit(area,'porthole')),px=(n:number)=>Math.max(1,Math.round(n*scale)),metrics=screenMetrics(scale,'porthole'),margin=metrics.margin;
 const wingScale=Math.max(1,scale),wp=(n:number)=>Math.max(1,Math.round(n*wingScale));
 const fullWidth=metrics.width+2*margin,fullHeight=metrics.height+2*margin;
 const swingWidth=Math.min(scale>=1?px(FOLD_OPEN.width):margin+metrics.width+wp(320),area.width);
 const width=Math.min(expanded?swingWidth:fullWidth,area.width),height=Math.min(expanded?wp(FOLD_OPEN.height):fullHeight,area.height);
 const screenWidth=Math.max(1,Math.min(metrics.width,width-2*margin)),screenHeight=Math.max(1,Math.min(metrics.height,height-2*margin));
 const closed=clampBounds({x:Math.round(point.x-screenWidth/2-margin),y:Math.round(point.y-screenHeight/2-margin),width:Math.min(fullWidth,area.width),height:Math.min(fullHeight,area.height)},area);
 const anchor={x:closed.x+margin+screenWidth/2,y:closed.y+margin+screenHeight/2};
 const fitsRight=anchor.x-screenWidth/2-margin+swingWidth<=area.x+area.width,fitsLeft=anchor.x+screenWidth/2+margin-swingWidth>=area.x;
 const side=fitsRight||!fitsLeft&&area.x+area.width-anchor.x>=anchor.x-area.x?'right':'left',screenX=side==='right'?margin:width-screenWidth-margin;
 const bounds=clampBounds({x:Math.round(anchor.x-screenX-screenWidth/2),y:Math.round(anchor.y-height/2),width,height},area);
 const screenY=Math.max(margin,Math.min(height-screenHeight-margin,Math.round(anchor.y-bounds.y-screenHeight/2)));
 const screen:FoldSurface={x:screenX,y:screenY,width:screenWidth,height:screenHeight,angle:side==='right'?-2:2,radii:(side==='right'?[28,16,16,28]:[16,28,28,16]).map(px) as [number,number,number,number]};
 const wing:FoldSurface|null=expanded?{x:side==='right'?screenX+screenWidth+wp(12):wp(20),y:wp(20),width:Math.max(1,width-screenWidth-margin-wp(32)),height:Math.max(1,height-wp(40)),angle:side==='right'?1.5:-1.5,radii:(side==='right'?[16,34,28,16]:[34,16,16,28]).map(wp) as [number,number,number,number]}:null;
 const hingeHeight=Math.max(1,Math.min(px(168),screenHeight-px(44)));
 const hinge:FoldSurface={x:expanded?(side==='right'?screenX+screenWidth-px(3):screenX-px(15)):(side==='right'?screenX+screenWidth-px(3):screenX-px(5)),y:Math.round(screenY+screenHeight/2-hingeHeight/2),width:px(expanded?18:8),height:hingeHeight,angle:0,radii:[4,4,4,4].map(px) as [number,number,number,number]};
 return {bounds,anchor:{x:bounds.x+screenX+screenWidth/2,y:bounds.y+screenY+screenHeight/2},theme:'porthole',scale,density:metrics.density,screenScale:metrics.contentScale,wingScale,side,placement:side,screen,wing,hinge};
}

// CSS surfaces and native hit regions use the same geometry; transparent gaps
// and circle corners never intercept input intended for the underlying app.
function surfaceRegion(surface:FoldSurface,bounds:Rect,pad:number):Rect[]{
  const x=surface.x-pad,y=surface.y-pad,width=surface.width+pad*2,height=surface.height+pad*2;
  const radii=surface.radii.map(r=>Math.max(0,Math.min(r+pad,width/2,height/2))),points:Array<{x:number;y:number}>=[];
  const corners=[[x+radii[0]!,y+radii[0]!,180],[x+width-radii[1]!,y+radii[1]!,270],[x+width-radii[2]!,y+height-radii[2]!,0],[x+radii[3]!,y+height-radii[3]!,90]];
  const angle=surface.angle*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle),cx=x+width/2,cy=y+height/2;
  corners.forEach(([cornerX,cornerY,start],i)=>{for(let n=0;n<=32;n++){const t=(start!+n*90/32)*Math.PI/180,px=cornerX!+radii[i]!*Math.cos(t)-cx,py=cornerY!+radii[i]!*Math.sin(t)-cy;points.push({x:cx+px*cos-py*sin,y:cy+px*sin+py*cos});}});
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
  // Keep the compositor's one-pixel edge blend inside the binary native clip.
  return [layout.screen,...(layout.wing?[layout.wing]:[]),...(layout.hinge?[layout.hinge]:[])].flatMap(surface=>surfaceRegion(surface,layout.bounds,1));
}

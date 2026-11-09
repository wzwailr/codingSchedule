import {expect,test} from 'vitest';import {foldLayout} from '../../src/desktop/geometry.js';import {dockEdge,edgeBounds,edgeShape} from '../../src/desktop/edge.js';
test('all four edges fit the Windows minimum size and keep the OLED anchor separate',()=>{
 for(const area of [{x:0,y:0,width:1920,height:1032},{x:-1280,y:-100,width:1280,height:720}])for(const [x,y,expected] of [[area.x,area.y+area.height/2,'left'],[area.x+area.width,area.y+area.height/2,'right'],[area.x+area.width/2,area.y,'top'],[area.x+area.width/2,area.y+area.height,'bottom']] as const)for(const scale of [.35,.5,1,2]){
  const g=foldLayout({x,y},area,false,scale),edge=dockEdge(g,area);if(scale===2&&area.height===720)continue;expect(edge).toBe(expected);const b=edgeBounds(g,area,edge!);expect([b.width,b.height]).toEqual(edge==='left'||edge==='right'?[32,64]:[64,40]);expect(b.x).toBeGreaterThanOrEqual(area.x);expect(b.y).toBeGreaterThanOrEqual(area.y);expect(b.x+b.width).toBeLessThanOrEqual(area.x+area.width);expect(b.y+b.height).toBeLessThanOrEqual(area.y+area.height);expect(g.anchor).not.toEqual({x:b.x,y:b.y});
 }
 const area={x:0,y:0,width:1920,height:1032};expect(dockEdge(foldLayout({x:800,y:400},area,false),area)).toBeNull();
});
test('capsule native region keeps the visible center and excludes transparent corners in both orientations',()=>{
 for(const [width,height] of [[32,64],[64,40]]){
  const bounds={x:-1200,y:200,width:width!,height:height!},shape=edgeShape(bounds),contains=(x:number,y:number)=>shape.some(r=>x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height);
  expect(contains(0,0)).toBe(false);expect(contains(width!-1,0)).toBe(false);expect(contains(0,height!-1)).toBe(false);expect(contains(width!-1,height!-1)).toBe(false);
  expect(contains(width!/2,height!/2)).toBe(true);expect(contains(width!/2,0)).toBe(true);expect(contains(0,height!/2)).toBe(true);
  for(const r of shape){expect(r.x).toBeGreaterThanOrEqual(0);expect(r.y).toBeGreaterThanOrEqual(0);expect(r.x+r.width).toBeLessThanOrEqual(width!);expect(r.y+r.height).toBeLessThanOrEqual(height!);}
 }
});

import {expect,test} from 'vitest';
import {foldLayout,foldShape,FOLD_CLOSED,FOLD_OPEN} from '../../src/desktop/geometry.js';
import type {WidgetRect} from '../../src/shared/ui-contract.js';
const area={x:0,y:0,width:1920,height:1080};
const contains=(rect:WidgetRect,x:number,y:number)=>x>=rect.x&&y>=rect.y&&x<rect.x+rect.width&&y<rect.y+rect.height;
test('folding physically removes the detail wing, with a stable OLED center at each screen edge',()=>{
 for(const point of [{x:80,y:150},{x:1840,y:150},{x:80,y:930},{x:1840,y:930},{x:960,y:540}]){
  const closed=foldLayout(point,area,false),open=foldLayout(closed.anchor,area,true),again=foldLayout(open.anchor,area,false);
  expect(closed.bounds.width).toBe(FOLD_CLOSED.width);expect(open.bounds.width).toBe(FOLD_OPEN.width);expect(closed.wing).toBeNull();expect(open.wing).not.toBeNull();
  expect(open.anchor).toEqual(closed.anchor);expect(again.anchor).toEqual(closed.anchor);expect(open.side).toBe(closed.side);
  for(const layout of [closed,open,again]){expect(layout.bounds.x).toBeGreaterThanOrEqual(area.x);expect(layout.bounds.y).toBeGreaterThanOrEqual(area.y);expect(layout.bounds.x+layout.bounds.width).toBeLessThanOrEqual(area.width);expect(layout.bounds.y+layout.bounds.height).toBeLessThanOrEqual(area.height);}
 }
 expect(foldLayout({x:80,y:540},area,true).side).toBe('right');expect(foldLayout({x:1840,y:540},area,true).side).toBe('left');
});
test('logical small and negative-coordinate work areas remain bounded',()=>{
 for(const work of [{x:-1280,y:-100,width:1280,height:720},{x:0,y:0,width:300,height:250}])for(const expanded of [false,true]){
  const g=foldLayout({x:work.x+work.width-30,y:work.y+work.height-10},work,expanded);
  expect(g.bounds.x).toBeGreaterThanOrEqual(work.x);expect(g.bounds.y).toBeGreaterThanOrEqual(work.y);expect(g.bounds.x+g.bounds.width).toBeLessThanOrEqual(work.x+work.width);expect(g.bounds.y+g.bounds.height).toBeLessThanOrEqual(work.y+work.height);
  expect(g.screen.width).toBeGreaterThan(50);expect(g.screen.height).toBeGreaterThan(70);
 }
});
test('native regions include both visible surfaces and exclude unused corners and canvas in either orientation',()=>{
 for(const point of [{x:80,y:540},{x:1840,y:540}])for(const expanded of [false,true]){
  const g=foldLayout(point,area,expanded),region=foldShape(g),hit=(x:number,y:number)=>region.some(r=>contains(r,x,y));
  for(const surface of [g.screen,g.wing].filter(x=>x!==null)){expect(hit(surface.x+surface.width/2,surface.y+surface.height/2)).toBe(true);}
  expect(hit(0,0)).toBe(false);expect(hit(g.bounds.width-1,g.bounds.height-1)).toBe(false);
  if(expanded)expect(hit(g.screen.x+g.screen.width/2,5)).toBe(false);
  for(const r of region){expect([r.x,r.y,r.width,r.height].every(Number.isInteger)).toBe(true);expect(r.x).toBeGreaterThanOrEqual(0);expect(r.y).toBeGreaterThanOrEqual(0);expect(r.x+r.width).toBeLessThanOrEqual(g.bounds.width);expect(r.y+r.height).toBeLessThanOrEqual(g.bounds.height);expect(r.width*r.height).toBeGreaterThan(0);}
 }
});

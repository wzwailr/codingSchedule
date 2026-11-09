import {expect,test} from 'vitest';
import {DEFAULT_THEME,THEMES,normalizeTheme,edgeRadius,type WidgetTheme} from '../../src/shared/themes.js';
import {foldLayout,foldShape} from '../../src/desktop/geometry.js';
import {edgeShape} from '../../src/desktop/edge.js';
const area={x:0,y:0,width:1920,height:1080};
const ids=Object.keys(THEMES) as WidgetTheme[];
test('the original theme and three additions are accepted, retaining the original default for old profiles',()=>{
 expect(ids).toEqual(['porthole','terminal','silver','disc']);expect(DEFAULT_THEME).toBe('porthole');for(const id of ids)expect(normalizeTheme(id)).toBe(id);
 for(const value of [null,{},'toString','__proto__','unknown'])expect(normalizeTheme(value)).toBe(DEFAULT_THEME);
});
test('each theme keeps the same native anchor through folding and excludes transparent holes',()=>{
 for(const theme of ids)for(const point of [{x:180,y:180},{x:1740,y:880},{x:960,y:500}]){
  const closed=foldLayout(point,area,false,1,theme),open=foldLayout(closed.anchor,area,true,1,theme),again=foldLayout(open.anchor,area,false,1,theme);
  expect(again.bounds).toEqual(closed.bounds);expect(open.anchor).toEqual(closed.anchor);expect(closed.screen.width).toBe(THEMES[theme].screen.width);
  expect(closed.wing).toBeNull();expect(open.wing).not.toBeNull();
  if(theme==='terminal'||theme==='silver')expect(['top','bottom']).toContain(open.placement);
  if(theme==='porthole'){expect(closed.bounds).toMatchObject({width:148,height:272});expect(open.hinge).toBeDefined();expect(Math.abs(open.screen.angle)).toBe(2);expect(Math.abs(open.wing!.angle)).toBe(1.5);}
  const shape=foldShape(open),hit=(x:number,y:number)=>shape.some(r=>x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height);
  expect(hit(open.screen.x+open.screen.width/2,open.screen.y+open.screen.height/2)).toBe(true);expect(hit(0,0)).toBe(false);
  if(theme==='disc')expect(hit(open.screen.x+2,open.screen.y+2)).toBe(false);
 }
});
test('theme geometry stays bounded across negative screens, density tiers and edge tab shapes',()=>{
 for(const theme of ids)for(const scale of [.35,.49,.5,.74,.75,1,2])for(const work of [area,{x:-1280,y:-100,width:1280,height:720}]){
  const closed=foldLayout({x:work.x+50,y:work.y+50},work,false,scale,theme),open=foldLayout(closed.anchor,work,true,scale,theme);
  expect(open.anchor).toEqual(closed.anchor);
  for(const layout of [closed,open]){expect(layout.bounds.x).toBeGreaterThanOrEqual(work.x);expect(layout.bounds.y).toBeGreaterThanOrEqual(work.y);expect(layout.bounds.x+layout.bounds.width).toBeLessThanOrEqual(work.x+work.width);expect(layout.bounds.y+layout.bounds.height).toBeLessThanOrEqual(work.y+work.height);expect(foldShape(layout).length).toBeGreaterThan(0);}
 }
 for(const theme of ids){const bounds={x:0,y:0,width:32,height:64},shape=edgeShape(bounds,theme);expect(shape.length).toBeGreaterThan(0);expect(edgeRadius(theme,32,64)).toBe(theme==='terminal'?3:theme==='silver'?7:16);}
});

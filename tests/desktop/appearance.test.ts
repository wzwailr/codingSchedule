import {expect,test} from 'vitest';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {normalizeAppearance,resizedScale} from '../../src/shared/appearance.js';import {readAppearance} from '../../src/desktop/appearance.js';import {foldLayout,foldShape} from '../../src/desktop/geometry.js';import {OpacityWheel} from '../../src/renderer/opacity-wheel.js';
test('appearance defaults, rejects non-number configuration values, clamps bounds and rounds user values',()=>{
 for(const value of [null,[],{scale:'1.5',opacity:'0.6'},{scale:NaN,opacity:Infinity}])expect(normalizeAppearance(value)).toEqual({scale:1,opacity:1});
 expect(normalizeAppearance({scale:.01,opacity:-3})).toEqual({scale:.35,opacity:.4});expect(normalizeAppearance({scale:7,opacity:5})).toEqual({scale:2,opacity:1});expect(normalizeAppearance({scale:1.276,opacity:.684})).toEqual({scale:1.28,opacity:.68});
});
test('old, corrupt and partially specified appearance files recover safely',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'appearance-config-')),path=join(dir,'appearance.json');try{expect(await readAppearance(path)).toEqual({scale:1,opacity:1});await writeFile(path,'invalid');expect(await readAppearance(path)).toEqual({scale:1,opacity:1});await writeFile(path,'\uFEFF{"opacity":0.65,"other":"preserved elsewhere"}');expect(await readAppearance(path)).toEqual({scale:1,opacity:.65});}finally{await rm(dir,{recursive:true,force:true});}
});
test('proportional resize uses event points in either wing direction, without late OS cursor reads',()=>{
 const anchor={x:500,y:400};expect(resizedScale(1,anchor,{x:550,y:500},{x:575,y:550})).toBe(1.5);expect(resizedScale(1,anchor,{x:400,y:500},{x:350,y:550})).toBe(1.5);expect(resizedScale(1,anchor,anchor,{x:700,y:600})).toBe(1);expect(resizedScale(1,anchor,{x:550,y:500},{x:500,y:400})).toBe(.35);expect(resizedScale(1,anchor,{x:550,y:500},{x:1000,y:1400})).toBe(2);
});
test('both states scale the native window and regions together while repeated folds preserve their OLED anchor',()=>{
 const area={x:-1920,y:0,width:1920,height:1080};
 for(const scale of [.9,.91,1.13,1.25,1.5,1.77,2]){
  let closed=foldLayout({x:-1000,y:540},area,false,scale);const anchor=closed.anchor;
  for(let n=0;n<15;n++){const open=foldLayout(closed.anchor,area,true,scale);closed=foldLayout(open.anchor,area,false,scale);expect(open.anchor).toEqual(anchor);expect(closed.anchor).toEqual(anchor);expect(open.scale).toBe(scale);if(scale>=1)expect(open.bounds.width).toBeCloseTo(456*scale,0);else expect(open.wingScale).toBe(1);expect(closed.bounds.width/closed.bounds.height).toBeCloseTo(148/272,2);const region=foldShape(open);expect(region.every(r=>Number.isInteger(r.width)&&Number.isInteger(r.x)&&r.x>=0&&r.y>=0&&r.x+r.width<=open.bounds.width&&r.y+r.height<=open.bounds.height)).toBe(true);}
 }
});
test('work-area scale ceiling applies to both states and does not permanently change the requested preference',()=>{
 const area={x:-1280,y:0,width:720,height:500},a=foldLayout({x:-920,y:250},area,false,2),b=foldLayout(a.anchor,area,true,2);
 expect(a.scale).toBe(b.scale);expect(b.scale).toBeLessThan(1.21);expect(b.bounds.width).toBeLessThanOrEqual(720);expect(b.bounds.height).toBeLessThanOrEqual(500);
 expect(foldLayout({x:500,y:500},{x:0,y:0,width:1920,height:1080},false,2).scale).toBe(2);
});
test('wheel direction and modes change one 5% step; trackpad bursts accumulate and are bounded',()=>{
 const wheel=new OpacityWheel();expect(wheel.consume(100,0,0)).toBe(-1);expect(wheel.consume(-3,1,100)).toBe(1);expect(wheel.consume(1,2,200)).toBe(-1);expect(wheel.consume(NaN,0,300)).toBe(0);
 const small=new OpacityWheel();let steps=0;for(let n=0;n<100;n++)steps+=Math.abs(small.consume(4,0,n*5));expect(steps).toBeGreaterThan(0);expect(steps).toBeLessThanOrEqual(4);
 const huge=new OpacityWheel();expect(huge.consume(100000,0,0)).toBe(-1);expect(huge.consume(100000,0,10)).toBe(0);expect(huge.consume(-100,0,90)).toBe(1);
});

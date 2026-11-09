import {expect,test} from 'vitest';
import {foldLayout,foldShape} from '../../src/desktop/geometry.js';
test('native clipping leaves a one-DIP antialias fringe while excluding empty canvas',()=>{
 const g=foldLayout({x:500,y:400},{x:0,y:0,width:1920,height:1080},false,1,'disc'),shape=foldShape(g),hit=(x:number,y:number)=>shape.some(r=>x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height);
 expect(hit(g.screen.x+g.screen.width/2,g.screen.y-1)).toBe(true);
 expect(hit(0,0)).toBe(false);expect(hit(g.screen.x,g.screen.y)).toBe(false);
});

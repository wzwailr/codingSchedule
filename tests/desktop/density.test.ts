import {expect,test} from 'vitest';
import {foldLayout,foldShape} from '../../src/desktop/geometry.js';
import {normalizeAppearance,resizedScale} from '../../src/shared/appearance.js';
import {shortScreenEta,shortScreenState} from '../../src/renderer/widget.js';
import {createRunState} from '../../src/domain/reducer.js';
import {clock,event} from '../helpers.js';
const area={x:0,y:0,width:1920,height:1032};
test('35% is a genuinely small physical screen; threshold equality chooses the larger information tier',()=>{
 expect(normalizeAppearance({scale:.35,opacity:.65})).toEqual({scale:.35,opacity:.65});
 const micro=foldLayout({x:500,y:400},area,false,.35);expect(micro.bounds.width).toBe(68);expect(micro.bounds.height).toBe(92);expect(micro.density).toBe('micro');expect(micro.screenScale).toBe(1);
 for(const [scale,density] of [[.49,'micro'],[.5,'compact'],[.74,'compact'],[.75,'normal'],[1,'normal']] as const)expect(foldLayout({x:500,y:400},area,false,scale).density).toBe(density);
});
test('size is monotone and continuous across tiers; folds preserve the selected tier and native OLED anchor',()=>{
 let previous=foldLayout({x:500,y:400},area,false,.35);
 for(let n=36;n<=100;n++){
  const closed=foldLayout(previous.anchor,area,false,n/100),open=foldLayout(closed.anchor,area,true,n/100),again=foldLayout(open.anchor,area,false,n/100);
  expect(closed.bounds.width).toBeGreaterThanOrEqual(previous.bounds.width);expect(closed.bounds.height).toBeGreaterThanOrEqual(previous.bounds.height);expect(closed.bounds.height-previous.bounds.height).toBeLessThan(8);
  expect(open.anchor).toEqual(closed.anchor);expect(again.anchor).toEqual(closed.anchor);expect(again.bounds).toEqual(closed.bounds);expect(open.scale).toBe(n/100);expect(open.wingScale).toBeGreaterThanOrEqual(1);
  expect(open.wing!.width/open.wingScale).toBeGreaterThanOrEqual(280);expect(open.wing!.height/open.wingScale).toBeGreaterThanOrEqual(370);previous=closed;
 }
});
test('micro and compact geometry remains bounded, shaped and restorable at both screen edges and negative coordinates',()=>{
 for(const work of [area,{x:-1280,y:-100,width:1280,height:720}])for(const x of [work.x+50,work.x+work.width-50])for(const scale of [.35,.49,.5,.74,.75]){
  const closed=foldLayout({x,y:work.y+work.height/2},work,false,scale),open=foldLayout(closed.anchor,work,true,scale);
  expect(open.anchor).toEqual(closed.anchor);expect(foldLayout(open.anchor,work,false,scale).bounds).toEqual(closed.bounds);
  for(const g of [closed,open]){expect(g.bounds.x).toBeGreaterThanOrEqual(work.x);expect(g.bounds.y).toBeGreaterThanOrEqual(work.y);expect(g.bounds.x+g.bounds.width).toBeLessThanOrEqual(work.x+work.width);expect(g.bounds.y+g.bounds.height).toBeLessThanOrEqual(work.y+work.height);const shape=foldShape(g);expect(shape.length).toBeGreaterThan(0);expect(shape.every(r=>Number.isInteger(r.x)&&Number.isInteger(r.y)&&r.x>=0&&r.y>=0&&r.x+r.width<=g.bounds.width&&r.y+r.height<=g.bounds.height)).toBe(true);}
 }
});
test('one captured resize can cross all tiers in both directions without rebasing its start point',()=>{
 const anchor={x:500,y:400},start={x:540,y:510};
 for(const n of [.35,.49,.5,.74,.75,1,1.5]){const point={x:anchor.x+(start.x-anchor.x)*n,y:anchor.y+(start.y-anchor.y)*n};expect(resizedScale(1,anchor,start,point)).toBe(n);}
});
test('short ETA rounds intervals outward, never fabricates unknown zero and distinguishes frozen, overtime and completion',()=>{
 const s=createRunState(event({type:'run.started',title:'显示边界',scope:'task'}),clock()).snapshot,now=Date.now();
 expect(shortScreenEta(s,now)).toBe('待估');s.eta={range:{minSec:121,maxSec:239},basis:'agent',asOf:now};expect(shortScreenEta(s,now)).toBe('2–4分');s.status='waiting';expect(shortScreenEta(s,now+500000)).toBe('2–4分');expect(shortScreenState(s)).toBe('等待');
 s.status='active';expect(shortScreenEta(s,now+500000)).toBe('超时');s.eta={range:{minSec:172800,maxSec:604800},basis:'agent',asOf:now};expect(shortScreenEta(s,now)).toBe('≈5天');s.eta.range={minSec:0,maxSec:8};expect(shortScreenEta(s,now)).toBe('0–8秒');
 s.freshness='stale';expect(shortScreenState(s)).toBe('过期');s.status='reported_done';expect(shortScreenEta(s,now)).toBe('待验');expect(shortScreenState(s)).toBe('AI完');s.status='verified_done';expect(shortScreenState(s)).toBe('验收');s.status='failed';expect(shortScreenEta(s,now)).toBe('失败');
});
test('a narrow hour-plus interval remains a ten-minute span on the tiny screen',()=>{const s=createRunState(event({type:'run.started',title:'interval',scope:'task'}),clock()).snapshot,now=Date.now();s.eta={range:{minSec:5400,maxSec:6000},basis:'agent',asOf:now};expect(shortScreenEta(s,now)).toBe('90–100m');});
test('outward minute rounding never expands a ten-minute ETA to eleven minutes',()=>{const s=createRunState(event({type:'run.started',title:'minutes',scope:'task'}),clock()).snapshot,now=Date.now();s.eta={range:{minSec:70,maxSec:670},basis:'agent',asOf:now};expect(shortScreenEta(s,now)).toBe('1–11分');});

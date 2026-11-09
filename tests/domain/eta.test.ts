import { expect,test } from 'vitest';
import { estimateRemaining } from '../../src/domain/eta.js';
import { emptyTiming } from '../../src/domain/clock.js';
import { createRunState,reduceRun } from '../../src/domain/reducer.js';
import { clock,event,plan,step,NOW } from '../helpers.js';
const estimated=(id:string,minSec:number,maxSec:number,status:'pending'|'running'='pending',version=1)=>({...step(id,status),estimate:{minSec,maxSec,version}});
function started(){return createRunState(event({type:'run.started',title:'test',scope:'task'}),clock());}
test('serial sums remaining, subtracts only active after anchor and rejects unknown/parallel',()=>{
  const p=plan([estimated('a',60,120),estimated('b',120,180)]),t=emptyTiming();
  expect(estimateRemaining(p,t).range).toEqual({minSec:180,maxSec:300});
  p.steps[0]!.status='running';t.currentAttemptByStep.a=1;t.activeMsByAttempt['a:1']=30000;t.estimateAnchors['a:1']={version:1,anchorActiveMs:0,kind:'prior',continuous:true};
  expect(estimateRemaining(p,t).range).toEqual({minSec:150,maxSec:270});p.schedule='parallel';expect(estimateRemaining(p,t).range).toBeNull();p.schedule='serial';delete p.steps[1]!.estimate;expect(estimateRemaining(p,t).range).toBeNull();
});
test('running re-estimate anchors now; same version cannot reset; waiting does not spend time',()=>{
  let s=reduceRun(started(),event({type:'plan.replaced',plan:plan([estimated('a',600,1200,'running')])}),clock());
  for(let i=1;i<=8;i++)s=reduceRun(s,event({type:'source.heartbeat'},{receivedAt:NOW+i*60000}),clock(NOW+i*60000,i*60000));
  s=reduceRun(s,event({type:'plan.replaced',plan:plan([estimated('a',240,480,'running',2)],2)},{receivedAt:NOW+480000}),clock(NOW+480000,480000));
  expect(s.snapshot.eta.range).toEqual({minSec:240,maxSec:480});
  s=reduceRun(s,event({type:'source.heartbeat'},{receivedAt:NOW+540000}),clock(NOW+540000,540000));expect(s.snapshot.eta.range).toEqual({minSec:180,maxSec:420});
  s=reduceRun(s,event({type:'plan.replaced',plan:plan([estimated('a',240,480,'running',2)],3)},{receivedAt:NOW+540000}),clock(NOW+540000,540000));expect(s.snapshot.eta.range).toEqual({minSec:180,maxSec:420});
  s=reduceRun(s,event({type:'run.status',status:'waiting'},{receivedAt:NOW+540000}),clock(NOW+540000,540000));
  for(let i=1;i<=10;i++)s=reduceRun(s,event({type:'source.heartbeat'},{receivedAt:NOW+540000+i*60000}),clock(NOW+540000+i*60000,540000+i*60000));
  expect(s.snapshot.eta.range).toEqual({minSec:180,maxSec:420});
});
test('median calibration clamps and requires 3 valid samples; remaining estimates are not multiplied',()=>{
  const t=emptyTiming(),p=plan([estimated('a',60,120)]);
  const samples=(ratios:number[])=>ratios.map((n,i)=>({stepId:String(i),attempt:1,activeSec:90*n,estimateAtStart:{minSec:60,maxSec:120},valid:true}));
  t.completedSamples=samples([1,2]);expect(estimateRemaining(p,t).basis).toBe('prior');t.completedSamples=samples([1,2,4]);expect(estimateRemaining(p,t).range).toEqual({minSec:120,maxSec:240});t.completedSamples=samples([5,6,7]);expect(estimateRemaining(p,t).range).toEqual({minSec:180,maxSec:360});
  p.steps[0]!.status='running';t.currentAttemptByStep.a=1;t.activeMsByAttempt['a:1']=0;t.estimateAnchors['a:1']={version:1,anchorActiveMs:0,kind:'remaining',continuous:true};expect(estimateRemaining(p,t).range).toEqual({minSec:60,maxSec:120});
});
test('overdue is retained at zero, continuity loss preserves the last countdown and reopened steps invalidate old samples',()=>{
  let s=reduceRun(started(),event({type:'plan.replaced',plan:plan([estimated('a',10,20,'running')])}),clock());
  s=reduceRun(s,event({type:'source.heartbeat'},{receivedAt:NOW+21000}),clock(NOW+21000,21000));expect(s.snapshot.eta.reason).toBe('overdue');
  s=reduceRun(s,event({type:'step.updated',revision:1,step:estimated('a',10,20)},{receivedAt:NOW+21000}),clock(NOW+21000,21000));
  const p=plan([estimated('a',10,20,'running')],2);p.reason='retry';s=reduceRun(s,event({type:'plan.replaced',plan:p}),clock(NOW+21000,21000));
  s=reduceRun(s,event({type:'source.heartbeat'}),clock(NOW+31000,31000,'new'));expect(s.snapshot.eta.range).toEqual({minSec:10,maxSec:20});expect(s.snapshot.progress.value).toBe(0);
});

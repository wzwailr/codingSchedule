import { expect,test,vi } from 'vitest';
import { clampBounds,foldLayout } from '../../src/desktop/geometry.js';
import { chooseRun,etaText,screenEta,inquiryText,progressText,statusText,HoverIntent } from '../../src/renderer/widget.js';
import { createRunState } from '../../src/domain/reducer.js';
import { clock,event } from '../helpers.js';
test('unknown progress is text, completed plan/reported/verified are distinct',()=>{
  const s=createRunState(event({type:'run.started',title:'test',scope:'task'}),clock()).snapshot;
  expect(progressText(s)).toBe('进度未知');s.progress.value=100;expect(progressText(s)).toBe('计划 100% · 待收尾');
  s.status='reported_done';expect(statusText(s)).toBe('AI 报告完成');s.status='verified_done';expect(statusText(s)).toBe('已验收');
});
test('inquiry states remain inline and a fresh agent answer can be shown while work activity remains stale',()=>{
 const s=createRunState(event({type:'run.started',title:'test',scope:'task'}),clock()).snapshot;
 s.etaInquiry={state:'queued',channel:'cooperative',requestedAt:Date.now()};expect(etaText(s)).toBe('等待 agent 估时');expect(inquiryText(s)).toContain('MCP 协作取件');
 s.etaInquiry.state='sent';s.etaInquiry.channel='hook';expect(inquiryText(s)).toContain('等待宿主安全点');
 s.etaInquiry.state='unanswered';expect(etaText(s)).toBe('agent 暂未答复');
 s.freshness='stale';s.eta={basis:'agent',range:{minSec:180,maxSec:300}};s.etaInquiry={state:'answered',channel:'cooperative',requestedAt:Date.now(),answeredAt:Date.now()};
 expect(etaText(s)).toContain('AI 粗估');expect(s.freshness).toBe('stale');
 s.etaInquiry.answeredAt=Date.now()-180001;expect(etaText(s)).toContain('03:00–05:00');
});
test('hover waits 250ms and leave400ms; pinned cancels collapse',()=>{
  vi.useFakeTimers();try{const change=vi.fn(),h=new HoverIntent(change);h.enter();vi.advanceTimersByTime(249);expect(change).not.toHaveBeenCalled();vi.advanceTimersByTime(1);expect(change).toHaveBeenLastCalledWith(true);h.leave();vi.advanceTimersByTime(399);expect(change).toHaveBeenCalledTimes(1);h.pin(true);vi.advanceTimersByTime(1);expect(change).toHaveBeenCalledTimes(1);h.pin(false);h.leave();vi.advanceTimersByTime(400);expect(change).toHaveBeenLastCalledWith(false);h.dispose();}finally{vi.useRealTimers();}
});

test('known ETA counts every second even after stale activity, freezes on wait and shows overtime rather than unknown',()=>{
 const s=createRunState(event({type:'run.started',title:'test',scope:'task'}),clock()).snapshot;
 s.eta={basis:'agent',range:{minSec:60,maxSec:120},asOf:10000};s.freshness='stale';
 expect(etaText(s,11000)).toContain('00:59–01:59');expect(etaText(s,12000)).toContain('00:58–01:58');
 s.status='waiting';expect(etaText(s,100000)).toContain('01:00–02:00');
 s.status='active';expect(etaText(s,140000)).toBe('已超时 00:10');
});

test('a complete plan keeps its valid countdown until the agent declares completion',()=>{
 const s=createRunState(event({type:'run.started',title:'test',scope:'task'}),clock()).snapshot;s.progress.value=100;
 expect(etaText(s,10000)).toBe('等待收尾');
 s.eta={basis:'agent',range:{minSec:5,maxSec:30},asOf:10000};
 expect(etaText(s,11000)).toBe('剩余 00:04–00:29（AI 粗估）');expect(etaText(s,12000)).toBe('剩余 00:03–00:28（AI 粗估）');
 s.status='reported_done';expect(etaText(s,12000)).toBe('AI 报告完成');
});
test('hover/manual selection remains stable when another run updates',()=>{
  const s=createRunState(event({type:'run.started',title:'test',scope:'task'}),clock()).snapshot;
  const other={...s,run:{runId:'other',generation:1},lastSeenAt:s.lastSeenAt+100};
  expect(chooseRun([other,s],s.run,true)).toEqual(s.run);expect(chooseRun([other,s],s.run,false,true)).toEqual(s.run);
});
test('expanded geometry handles negative monitor coords, small screens and DPI logical work areas',()=>{
  const area={x:-1280,y:0,width:1280,height:720};
  expect(clampBounds({x:100,y:800,width:360,height:420},area)).toEqual({x:-360,y:300,width:360,height:420});
  const expanded=foldLayout({x:-90,y:580},area,true).bounds;expect(expanded.y+expanded.height).toBeLessThanOrEqual(720);
  expect(clampBounds({x:100,y:100,width:360,height:420},{x:0,y:0,width:300,height:250})).toEqual({x:0,y:0,width:300,height:250});
});
test('OLED presentation retains valid ETA at 100%, separates stale/waiting/terminal states and unknown',()=>{
 const s=createRunState(event({type:'run.started',title:'test',scope:'task'}),clock()).snapshot;
 expect(screenEta(s,10000)).toEqual({value:'—',label:'暂不能估时'});
 s.progress.value=100;s.eta={basis:'agent',range:{minSec:60,maxSec:120},asOf:10000};s.freshness='stale';
 expect(screenEta(s,11000)).toEqual({value:'00:59–01:59',label:'预计剩余 · AI 粗估'});
 s.status='waiting';expect(screenEta(s,110000).value).toBe('01:00–02:00');expect(screenEta(s).label).toContain('计时暂停');
 s.status='active';expect(screenEta(s,140000).value).toBe('超时 00:10');s.status='reported_done';expect(screenEta(s).label).toBe('尚待人工验收');
 s.status='verified_done';expect(screenEta(s).value).toBe('已验收');s.status='failed';expect(screenEta(s).value).toBe('任务失败');
});
test('stopped native or reporter selection releases even when pinned or manually selected',()=>{
  const old=createRunState(event({type:'run.started',title:'old',scope:'turn'},{sourceKind:'transcript'}),clock()).snapshot;old.status='paused';
  const next={...old,run:{runId:'next',generation:1},status:'active' as const};
  expect(chooseRun([next,old],old.run,false)).toEqual(next.run);expect(chooseRun([next,old],old.run,true)).toEqual(next.run);expect(chooseRun([next,old],old.run,false,true)).toEqual(next.run);
  old.scope='task';expect(chooseRun([next,old],old.run,false)).toEqual(next.run);
});

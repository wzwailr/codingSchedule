import {expect,test} from 'vitest';
import {visibleSessions,chooseRun,sessionLabel} from '../../src/renderer/widget.js';
import {createRunState} from '../../src/domain/reducer.js';
import {clock,event} from '../helpers.js';
const now=Date.now();
function item(id:string,status:'active'|'paused'|'reported_done'='active',at=now){
 const s=createRunState(event({type:'run.started',title:id,scope:'turn'},{run:{runId:id,generation:1},sourceKind:'transcript',nativeSessionId:id,turnId:'turn',occurredAt:at,receivedAt:at}),clock(at)).snapshot;
 s.status=status;if(s.nativeActivity)s.nativeActivity.hasWork=true;return s;
}
test('only current active sessions appear; completed latest turn cannot revive its older active turn',()=>{
 const old=item('one'),end={...item('one','paused'),run:{runId:'end',generation:2}},live=item('two');
 expect(visibleSessions([old,end,live,item('idle','active',now-180001)],now).map(s=>s.nativeSession?.id)).toEqual(['two']);
 expect(visibleSessions([item('done','reported_done')],now)).toEqual([]);
});
test('late stop from an older generation never replaces the current turn',()=>{
 const old=item('one','paused',now+1000),current={...item('one','active',now),run:{runId:'next',generation:2}};
 expect(visibleSessions([old,current],now)).toEqual([current]);
});
test('a turn identity and telemetry alone do not count as actual work',()=>{
 const s=createRunState(event({type:'run.started',title:'telemetry',scope:'turn'},{run:{runId:'telemetry',generation:1},sourceKind:'transcript',nativeSessionId:'telemetry',turnId:'t',occurredAt:now,receivedAt:now}),clock(now)).snapshot;
 expect(visibleSessions([s],now)).toEqual([]);
});
test('explicitly linked reporter/native share one item and retain reported plan/estimate',()=>{
 const native=item('linked'),reporter={...item('reported'),scope:'task' as const,linkedNativeRun:native.run};delete reporter.nativeSession;
 reporter.progress={value:42,completed:1,total:3,basis:'plan'};
 const result=visibleSessions([native,reporter],now);expect(result).toHaveLength(1);expect(result[0]?.scope).toBe('task');expect(result[0]?.progress.value).toBe(42);expect(result[0]?.nativeSession?.id).toBe('linked');
});
test('in-flight native tools stay visible beyond freshness; a heartbeat cannot keep idle sessions alive',()=>{
 const busy=item('busy','active',now-600000),idle=item('idle','active',now-600000);
 busy.nativeActivity={lastEventAt:now-600000,inFlight:true};idle.lastSeenAt=now;
 expect(visibleSessions([busy,idle],now)).toEqual([busy]);
});
test('automatic mode follows latest work and stopped manual selection releases; sessions have distinct labels',()=>{
 const a=item('a'),b=item('b','active',now+1000);b.nativeSession!.project='项目B';
 expect(chooseRun([a,b],a.run,false)).toEqual(b.run);
 a.status='paused';expect(chooseRun([a,b],a.run,true,true)).toEqual(b.run);
 expect(sessionLabel(b)).toContain('项目B');expect(sessionLabel(a)).not.toBe(sessionLabel(b));
});

test('session labels show project and actual session name, with honest missing-name fallbacks and no identifier',()=>{
 const named=item('session-12345678');named.nativeSession!.name='敏感性预警功能开发';named.nativeSession!.project='支架供应链寻优';
 expect(sessionLabel(named)).toBe('支架供应链寻优 · 敏感性预警功能开发');
 delete named.nativeSession!.name;expect(sessionLabel(named)).toBe('支架供应链寻优 · 未命名会话');
 delete named.nativeSession!.project;expect(sessionLabel(named)).toBe('未知项目 · 未命名会话');
});

test('a precisely linked ongoing task keeps its last plan and timer through quiet reasoning, but a stopped native head hides it',()=>{
 const native=item('bound','active',now-600000),task={...item('reported','active',now-600000),scope:'task' as const,linkedNativeRun:native.run};delete task.nativeSession;task.progress={value:40,completed:2,total:5,basis:'plan'};task.eta={range:{minSec:60,maxSec:120},basis:'agent',asOf:now};
 expect(visibleSessions([native,task],now)).toHaveLength(1);expect(visibleSessions([native,task],now)[0]?.eta.range).toEqual(task.eta.range);native.status='paused';expect(visibleSessions([native,task],now)).toHaveLength(0);
});
test('waiting on the same still-running native session retains its frozen estimate beyond three minutes',()=>{const native=item('waiting-bound','active',now-600000),task={...item('waiting-report','active',now-600000),scope:'task' as const,status:'waiting' as const,linkedNativeRun:native.run};delete task.nativeSession;task.eta={range:{minSec:60,maxSec:120},basis:'agent',asOf:now-600000};const result=visibleSessions([native,task],now);expect(result).toHaveLength(1);expect(result[0]?.status).toBe('waiting');expect(result[0]?.eta.range).toEqual({minSec:60,maxSec:120});});

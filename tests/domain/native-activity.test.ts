import {expect,test} from 'vitest';
import {createRunState,reduceRun} from '../../src/domain/reducer.js';
import {clock,event} from '../helpers.js';
test('native visibility follows source time, tracks overlapping tools and clears on turn stop',()=>{
 const now=Date.now(),base={sourceKind:'transcript' as const,nativeSessionId:'session',turnId:'turn',occurredAt:now-600000,receivedAt:now};
 let s=createRunState(event({type:'run.started',title:'native',scope:'turn'},base),clock(now));
 expect(s.snapshot.nativeActivity?.lastEventAt).toBe(now-600000);
 s=reduceRun(s,event({type:'activity.updated',activity:'执行命令'},{...base,occurredAt:now,nativeCallId:'a'}),clock(now));
 s=reduceRun(s,event({type:'activity.updated',activity:'执行命令'},{...base,occurredAt:now,nativeCallId:'b'}),clock(now));
 s=reduceRun(s,event({type:'activity.updated',activity:'工具执行结束'},{...base,nativeCallId:'a:end'}),clock(now));
 expect(s.snapshot.nativeActivity?.inFlight).toBe(true);
 s=reduceRun(s,event({type:'run.status',status:'paused'},base),clock(now));
 expect(s.snapshot.nativeActivity?.inFlight).toBe(false);
 expect(s.snapshot.nativeActivity?.lastEventAt).toBe(now);
});
test('old tool starts discovered through history do not establish a live in-flight call',()=>{
 const now=Date.now(),base={sourceKind:'transcript' as const,nativeSessionId:'s',turnId:'t',occurredAt:now-600000,receivedAt:now};
 const s=reduceRun(createRunState(event({type:'run.started',title:'history',scope:'turn'},base),clock(now)),event({type:'activity.updated',activity:'执行命令'},{...base,nativeCallId:'orphan'}),clock(now));
 expect(s.snapshot.nativeActivity?.inFlight).toBe(false);
});

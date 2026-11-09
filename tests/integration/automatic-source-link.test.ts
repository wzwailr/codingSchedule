import {expect,test} from 'vitest';
import {openStore} from '../../src/storage/repository.js';
import {visibleSessions} from '../../src/renderer/widget.js';
import {clock,event,key,plan,source,step} from '../helpers.js';
import {reportBatch} from '../../src/ingestion/normalize-report.js';
const checkpoint=()=>({events:[],cursor:{pathKey:'path',fileGeneration:'file',committedOffset:1,pendingBytes:new Uint8Array()}});

test('an observed public reference merges one session while retaining its reporter plan and estimate',async()=>{
 const store=await openStore(':memory:',()=>clock()),reporter=source(),native={...source('native','transcript'),nativeSessionId:'session',nativeReplayComplete:false};
 try{
  const target=await store.begin({idempotencyKey:key(),title:'same task',plan:plan([step('one','completed'),step('two')])},reporter);
  const context=await store.context(target,reporter);const q=context.etaQuestion!;
  await store.commit(reportBatch(target,key(),context.nextSeq,[{type:'eta.answered',requestId:q.requestId,planRevision:q.planRevision,range:{minSec:100,maxSec:200},reason:'two remains'}],reporter,clock().wallMs),reporter);
  const observed=await store.resolveNative(native,'turn');await store.commit({events:[event({type:'activity.updated',activity:'work'},{run:{runId:observed.runId,generation:observed.generation},sourceKind:'transcript',nativeSessionId:'session',turnId:'turn',seq:2})]},native);
  expect(visibleSessions(await store.listSnapshots(),clock().wallMs)).toHaveLength(2);
  await store.commitNative([],checkpoint(),native);
  await store.commitNative([],checkpoint(),native,[{run:{runId:target.runId,generation:target.generation+1},turnId:'turn'}]);
  expect(visibleSessions(await store.listSnapshots(),clock().wallMs)).toHaveLength(2);
  await expect(store.commitNative([],{...checkpoint(),cursor:{...checkpoint().cursor,committedOffset:0}},native,[{run:{runId:target.runId,generation:target.generation},turnId:'turn'}])).rejects.toThrow('STALE_CURSOR');
  expect(visibleSessions(await store.listSnapshots(),clock().wallMs)).toHaveLength(2);
  await store.commitNative([],checkpoint(),native,[{run:{runId:target.runId,generation:target.generation},turnId:'turn'}]);
  const sessions=visibleSessions(await store.listSnapshots(),clock().wallMs);expect(sessions).toHaveLength(1);expect(sessions[0]?.progress.value).toBe(50);expect(sessions[0]?.eta.basis).toBe('agent');expect(sessions[0]?.nativeSession?.id).toBe('session');
  await store.commitNative([],checkpoint(),native,[{run:{runId:target.runId,generation:target.generation},turnId:'turn'}]);expect(visibleSessions(await store.listSnapshots(),clock().wallMs)).toHaveLength(1);
  const other={...native,nativeSessionId:'other'},otherRun=await store.resolveNative(other,'another');await store.commit({events:[event({type:'activity.updated',activity:'other work'},{run:{runId:otherRun.runId,generation:otherRun.generation},sourceKind:'transcript',nativeSessionId:'other',turnId:'another',seq:2})]},other);
  await store.commitNative([],{...checkpoint(),cursor:{...checkpoint().cursor,pathKey:'other'}},other,[{run:{runId:target.runId,generation:target.generation},turnId:'another'}]);expect(visibleSessions(await store.listSnapshots(),clock().wallMs)).toHaveLength(2);
  expect((await store.listSnapshots()).find(s=>s.run.runId===target.runId)?.linkedNativeRun).toEqual({runId:observed.runId,generation:observed.generation});
  const next=await store.resolveNative(native,'next');
  const taskContext=await store.context(target,reporter);await store.commit(reportBatch(target,key(),taskContext.nextSeq,[{type:'activity.updated',activity:'验证估时持久性与断线恢复'}],reporter,clock().wallMs),reporter);
  await store.commit({events:[event({type:'activity.updated',activity:'continued work'},{run:{runId:next.runId,generation:next.generation},sourceKind:'transcript',nativeSessionId:'session',turnId:'next',seq:2,eventId:key()})]},native);
  await store.commitNative([],checkpoint(),native,[{run:{runId:target.runId,generation:target.generation},turnId:'next'}]);
  const continued=visibleSessions(await store.listSnapshots(),clock().wallMs).find(s=>s.nativeSession?.id==='session');expect(continued?.scope).toBe('task');expect(continued?.progress.value).toBe(50);expect(continued?.linkedNativeRun?.runId).toBe(next.runId);
  expect(continued?.activity).toBe('验证估时持久性与断线恢复');expect((await store.context(target,reporter)).snapshot.nativeActivity?.action).toBe('continued work');
 }finally{await store.close();}
});

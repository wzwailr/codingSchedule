import {expect,test} from 'vitest';
import {openStore} from '../../src/storage/repository.js';
import {reportBatch} from '../../src/ingestion/normalize-report.js';
import {clock,key,NOW,plan,source,step} from '../helpers.js';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';

test('product asks each reporter, accepts only its live request and never records estimating as work',async()=>{
 let elapsed=0;const reporter=source(),store=await openStore(':memory:',()=>clock(NOW+elapsed,elapsed));
 try{
  const a=await store.begin({idempotencyKey:key(),title:'A'},reporter),b=await store.begin({idempotencyKey:key(),title:'B'},reporter);
  const ca=await store.context(a,reporter),cb=await store.context(b,reporter);
  expect(ca.etaQuestion).toMatchObject({run:{runId:a.runId,generation:1},planRevision:0});
  expect(ca.etaQuestion?.requestId).not.toBe(cb.etaQuestion?.requestId);
  const answer={type:'eta.answered' as const,requestId:ca.etaQuestion!.requestId,planRevision:0,range:{minSec:120,maxSec:240},reason:'remaining implementation and tests'};
  await expect(store.commit(reportBatch(b,key(),2,[answer],reporter,NOW),reporter)).rejects.toThrow('STALE_ETA_REQUEST');
  await expect(store.context(a,source('other'))).rejects.toThrow('FORBIDDEN');
  elapsed=10000;const batch=reportBatch(a,key(NOW+elapsed),2,[answer],reporter,NOW+elapsed);
  await store.commit(batch,reporter);expect((await store.commit(batch,reporter)).duplicate).toBe(true);
  const accepted=await store.context(a,reporter);
  expect(accepted.snapshot.eta).toMatchObject({basis:'agent',range:{minSec:120,maxSec:240}});
  expect(accepted.snapshot.lastWorkAt).toBe(NOW);expect(accepted.snapshot.activity).toBeNull();expect(accepted.snapshot.progress.value).toBeNull();
  elapsed=70000;await store.tick();expect((await store.context(a,reporter)).snapshot.eta.range).toEqual({minSec:60,maxSec:180});
  await store.commit(reportBatch(a,key(NOW+elapsed),3,[{type:'run.status',status:'waiting'}],reporter,NOW+elapsed),reporter);
  elapsed=130000;await store.tick();const paused=await store.context(a,reporter);expect(paused.snapshot.eta.range).toEqual({minSec:60,maxSec:180});expect(paused.etaQuestion).toBeUndefined();
 }finally{await store.close();}
});

test('restart cancels pending questions and old answers; turn observations never get questions',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'eta-restart-')),path=join(dir,'db'),reporter=source();let store=await openStore(path,()=>clock());
 try{
  const h=await store.begin({idempotencyKey:key(),title:'task'},reporter),old=(await store.context(h,reporter)).etaQuestion!;
  const native={...source('native','transcript'),nativeSessionId:'s'};const n=await store.resolveNative(native,'t');expect((await store.context(n,native)).etaQuestion).toBeUndefined();
  await store.close();store=await openStore(path,()=>clock(NOW+1000,0,'restart'));
  expect((await store.context(h,reporter)).snapshot.status).toBe('paused');expect((await store.context(h,reporter)).etaQuestion).toBeUndefined();
  await store.commit(reportBatch(h,key(NOW+1000),2,[{type:'run.status',status:'active'}],reporter,NOW+1000),reporter);
  await expect(store.commit(reportBatch(h,key(NOW+1000),3,[{type:'eta.answered',requestId:old.requestId,planRevision:0,range:{minSec:5,maxSec:10},reason:'old'}],reporter,NOW+1000),reporter)).rejects.toThrow('STALE_ETA_REQUEST');
  expect((await store.context(h,reporter)).etaQuestion).toBeUndefined();expect((await store.context(h,reporter)).etaUpdate).toBeDefined();
 }finally{await store.close();await rm(dir,{recursive:true,force:true});}
});
for(const status of ['paused','waiting','blocked'] as const)test(status+' then active in one report still invalidates the old question atomically',async()=>{
 const reporter=source(),store=await openStore(':memory:',()=>clock());
 try{
  const h=await store.begin({idempotencyKey:key(),title:'task'},reporter),ctx=await store.context(h,reporter);
  const changes=[{type:'run.status' as const,status},{type:'run.status' as const,status:'active' as const},{type:'eta.answered' as const,requestId:ctx.etaQuestion!.requestId,planRevision:0,range:{minSec:10,maxSec:20},reason:'outdated'}];
  await expect(store.commit(reportBatch(h,key(),ctx.nextSeq,changes,reporter,NOW),reporter)).rejects.toThrow('STALE_ETA_REQUEST');
  expect((await store.context(h,reporter)).nextSeq).toBe(ctx.nextSeq);
 }finally{await store.close();}
});

test('expired, replaced-plan and paused requests reject late replies; no periodic re-questioning and revisions use the optional update channel',async()=>{
 let elapsed=0;const reporter=source(),store=await openStore(':memory:',()=>clock(NOW+elapsed,elapsed));
 try{
  const h=await store.begin({idempotencyKey:key(),title:'task'},reporter),initial=(await store.context(h,reporter)).etaQuestion!;
  const answer=(requestId:string,planRevision=0)=>({type:'eta.answered' as const,requestId,planRevision,range:null,reason:'cannot yet bound external wait'});
  elapsed=120001;await expect(store.commit(reportBatch(h,key(NOW+elapsed),2,[answer(initial.requestId)],reporter,NOW+elapsed),reporter)).rejects.toThrow('STALE_ETA_REQUEST');
  await store.tick();expect((await store.context(h,reporter)).etaQuestion).toBeUndefined();
  elapsed=360001;await store.tick();expect((await store.context(h,reporter)).etaQuestion).toBeUndefined();const refreshed=(await store.context(h,reporter)).etaUpdate!;
  await store.commit(reportBatch(h,key(NOW+elapsed),2,[{type:'plan.replaced',plan:plan([step('a')])}],reporter,NOW+elapsed),reporter);
  await expect(store.commit(reportBatch(h,key(NOW+elapsed),3,[answer(refreshed.requestId)],reporter,NOW+elapsed),reporter)).rejects.toThrow('STALE_ETA_REQUEST');
  const current=(await store.context(h,reporter)).etaUpdate!;expect(current.planRevision).toBe(1);
  await store.commit(reportBatch(h,key(NOW+elapsed),3,[answer(current.requestId,1)],reporter,NOW+elapsed),reporter);
  expect((await store.context(h,reporter)).snapshot.eta.reason).toBe('agent_unknown');
  elapsed+=120000;await store.tick();expect((await store.context(h,reporter)).etaQuestion).toBeUndefined();
  elapsed+=480001;await store.tick();expect((await store.context(h,reporter)).etaQuestion).toBeUndefined();const pending=(await store.context(h,reporter)).etaUpdate!;
  await store.commit(reportBatch(h,key(NOW+elapsed),4,[{type:'run.status',status:'paused'}],reporter,NOW+elapsed),reporter);
  await expect(store.commit(reportBatch(h,key(NOW+elapsed),5,[answer(pending.requestId,1)],reporter,NOW+elapsed),reporter)).rejects.toThrow('STALE_ETA_REQUEST');
 }finally{await store.close();}
});

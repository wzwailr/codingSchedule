import {expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {openStore} from '../../src/storage/repository.js';import {reportBatch} from '../../src/ingestion/normalize-report.js';
import {clock,key,NOW,plan,source,step} from '../helpers.js';

test('last valid time survives missing/null estimates, plan changes and long running without new model questions',async()=>{
 let elapsed=0;const reporter=source(),store=await openStore(':memory:',()=>clock(NOW+elapsed,elapsed));
 try{
  const h=await store.begin({idempotencyKey:key(),title:'retain'},reporter);
  const report=async(changes:Parameters<typeof reportBatch>[3])=>{const c=await store.context(h,reporter);await store.commit(reportBatch(h,key(NOW+elapsed),c.nextSeq,changes,reporter,NOW+elapsed),reporter);};
  const q=(await store.context(h,reporter)).etaQuestion!;
  await report([{type:'eta.answered',requestId:q.requestId,planRevision:0,range:{minSec:120,maxSec:240},reason:'initial'}]);
  elapsed=10000;await report([{type:'activity.updated',activity:'real work'}]);expect((await store.context(h,reporter)).snapshot.eta.range).toEqual({minSec:110,maxSec:230});
  await report([{type:'plan.replaced',plan:plan([step('new')])}]);
  let c=await store.context(h,reporter);expect(c.snapshot.eta.range).toEqual({minSec:110,maxSec:230});expect(c.etaQuestion).toBeUndefined();expect(c.etaUpdate).toBeDefined();
  elapsed=20000;await report([{type:'eta.answered',requestId:c.etaUpdate!.requestId,planRevision:1,range:null,reason:'no revised estimate'}]);
  c=await store.context(h,reporter);expect(c.snapshot.eta.range).toEqual({minSec:100,maxSec:220});
  await report([{type:'eta.answered',requestId:c.etaUpdate!.requestId,planRevision:1,range:{minSec:60,maxSec:90},reason:'scope now smaller'}]);expect((await store.context(h,reporter)).snapshot.eta.range).toEqual({minSec:60,maxSec:90});
  for(elapsed=80000;elapsed<=800000;elapsed+=60000){await store.tick();expect((await store.context(h,reporter)).etaQuestion).toBeUndefined();}
  const late=(await store.context(h,reporter)).snapshot;expect(late.eta.range).toEqual({minSec:0,maxSec:0});expect(late.eta.reason).toBe('overdue');expect(late.progress.value).toBe(0);
 }finally{await store.close();}
});

test('a plan estimate starts counting, survives restart and can be revised through the same existing report contract',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'eta-retain-')),path=join(dir,'db'),reporter=source();let elapsed=0,store=await openStore(path,()=>clock(NOW+elapsed,elapsed));
 try{
  const h=await store.begin({idempotencyKey:key(),title:'plan',plan:plan([{...step('a','running'),estimate:{minSec:120,maxSec:240,version:1}}])},reporter);
  expect((await store.context(h,reporter)).etaQuestion).toBeUndefined();elapsed=30000;await store.tick();expect((await store.context(h,reporter)).snapshot.eta.range).toEqual({minSec:90,maxSec:210});
  await store.close();store=await openStore(path,()=>clock(NOW+60000,0,'restart'));let c=await store.context(h,reporter);expect(c.snapshot.eta.range).toEqual({minSec:90,maxSec:210});
  await store.commit(reportBatch(h,key(NOW+60000),c.nextSeq,[{type:'run.status',status:'active'}],reporter,NOW+60000),reporter);
  c=await store.context(h,reporter);expect(c.etaQuestion).toBeUndefined();expect(c.etaUpdate).toBeDefined();
  await store.commit(reportBatch(h,key(NOW+60000),c.nextSeq,[{type:'eta.answered',requestId:c.etaUpdate!.requestId,planRevision:1,range:{minSec:40,maxSec:70},reason:'revised'}],reporter,NOW+60000),reporter);expect((await store.context(h,reporter)).snapshot.eta.range).toEqual({minSec:40,maxSec:70});
 }finally{await store.close();await rm(dir,{recursive:true,force:true});}
});

test('a completed replacement plan without new estimates preserves the agent countdown, while a new estimate can replace it',async()=>{
 let elapsed=0;const reporter=source(),store=await openStore(':memory:',()=>clock(NOW+elapsed,elapsed));
 try{
  const h=await store.begin({idempotencyKey:key(),title:'finish countdown'},reporter),c=await store.context(h,reporter);
  await store.commit(reportBatch(h,key(),c.nextSeq,[{type:'eta.answered',requestId:c.etaQuestion!.requestId,planRevision:0,range:{minSec:60,maxSec:120},reason:'implementation and final verification'}],reporter,NOW),reporter);
  elapsed=10000;let next=await store.context(h,reporter);
  await store.commit(reportBatch(h,key(NOW+elapsed),next.nextSeq,[{type:'plan.replaced',plan:plan([step('done','completed')])}],reporter,NOW+elapsed),reporter);
  next=await store.context(h,reporter);expect(next.snapshot.progress.value).toBe(100);expect(next.snapshot.status).toBe('active');expect(next.snapshot.eta).toMatchObject({range:{minSec:50,maxSec:110},basis:'agent'});
  await store.commit(reportBatch(h,key(NOW+elapsed),next.nextSeq,[{type:'plan.replaced',plan:{...plan([{...step('more','running'),estimate:{minSec:40,maxSec:70,version:1}}],2),reason:'new implementation scope'}}],reporter,NOW+elapsed),reporter);
  expect((await store.context(h,reporter)).snapshot.eta).toMatchObject({range:{minSec:40,maxSec:70},basis:'prior'});
 }finally{await store.close();}
});

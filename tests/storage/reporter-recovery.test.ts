import {expect,test} from 'vitest';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {openStore} from '../../src/storage/repository.js';import {reportBatch} from '../../src/ingestion/normalize-report.js';import {clock,key,NOW,plan,source,step} from '../helpers.js';
test('original reporter work resumes a restart-only pause while preserving ETA and explicit waits',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'report-recovery-')),s=source();let now=clock(),store=await openStore(join(dir,'db'),()=>now);
 try{
  const h=await store.begin({idempotencyKey:key(),title:'restart',plan:plan([step('done','completed'),step('work','running')])},s),q=(await store.context(h,s)).etaQuestion!;
  await store.commit(reportBatch(h,key(),2,[{type:'eta.answered',requestId:q.requestId,planRevision:1,range:{minSec:60,maxSec:120},reason:'work'}],s,NOW),s);await store.close();now=clock(NOW+30000,0,'restart');store=await openStore(join(dir,'db'),()=>now);
  const paused=await store.context(h,s);expect(paused.snapshot.status).toBe('paused');expect(paused.snapshot.eta.range).toEqual({minSec:60,maxSec:120});
  await store.commit(reportBatch(h,key(now.wallMs),paused.nextSeq,[{type:'activity.updated',activity:'continue original task'}],s,now.wallMs),s);expect((await store.context(h,s)).snapshot.status).toBe('active');
  const resumed=await store.context(h,s);await store.commit(reportBatch(h,key(now.wallMs),resumed.nextSeq,[{type:'run.status',status:'paused'}],s,now.wallMs),s);await store.close();now=clock(NOW+60000,0,'again');store=await openStore(join(dir,'db'),()=>now);const explicit=await store.context(h,s);await store.commit(reportBatch(h,key(now.wallMs),explicit.nextSeq,[{type:'activity.updated',activity:'note while deliberately paused'}],s,now.wallMs),s);expect((await store.context(h,s)).snapshot.status).toBe('paused');
 }finally{await store.close();await rm(dir,{recursive:true,force:true});}
});

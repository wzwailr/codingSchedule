import {expect,test} from 'vitest';
import {openStore} from '../../src/storage/repository.js';
import {linkSource,unlinkSource} from '../../src/integration/source-link.js';
import {key,source,clock,event,plan,step} from '../helpers.js';
import {reportBatch} from '../../src/ingestion/normalize-report.js';
test('explicit session/turn links share activity only; future turns and unlink remain independent',async()=>{
  const store=await openStore(':memory:',()=>clock()),reporter=source(),native={...source('native','transcript'),nativeSessionId:'session'};
  try{
    const target=await store.begin({idempotencyKey:key(),title:'overall',plan:plan([step('own')])},reporter);
    await store.commit(reportBatch(target,key(),2,[{type:'run.status',status:'waiting'}],reporter,clock().wallMs),reporter);
    const passive=await store.resolveNative(native,'a');
    const commit=async(turn:string,activity:string,seq:number)=>{const h=await store.resolveNative(native,turn);await store.commit({events:[event({type:'activity.updated',activity},{run:{runId:h.runId,generation:h.generation},sourceKind:'transcript',nativeSessionId:'session',turnId:turn,seq})]},native);};
    await commit('a','testing',2);
    await linkSource(store,target,{provider:'codex',nativeSessionId:'session'},{turnIds:['a']});
    expect((await store.listSnapshots()).find(s=>s.run.runId===target.runId)?.linkedNativeRun).toEqual({runId:passive.runId,generation:passive.generation});
    const snapshot=(await store.context(target,reporter)).snapshot;expect(snapshot.activity).toBe('testing');expect(snapshot.status).toBe('waiting');expect(snapshot.plan?.steps[0]?.id).toBe('own');
    await commit('b','future unrelated',2);expect((await store.context(target,reporter)).snapshot.activity).toBe('testing');
    await commit('a','late end',3);expect((await store.context(target,reporter)).snapshot.status).toBe('waiting');
    await unlinkSource(store,target,{provider:'codex',nativeSessionId:'session'},{turnIds:['a']});expect((await store.context(target,reporter)).snapshot.activity).toBeNull();
    expect((await store.context(passive,native)).snapshot.activity).toBe('late end');
    await expect(linkSource(store,target,{provider:'codex',nativeSessionId:'session'},{turnIds:['missing']})).rejects.toThrow();
  }finally{await store.close();}
});

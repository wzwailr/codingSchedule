import { expect,test } from 'vitest';
import { openStore } from '../../src/storage/repository.js';
import { source,clock,event } from '../helpers.js';
test('multiple native observations and checkpoint roll back together on bad last observation',async()=>{
  const store=await openStore(':memory:',()=>clock()),s={...source('native','transcript'),nativeSessionId:'a'};
  try{
    const handle=await store.resolveNative(s,'turn'),h={runId:handle.runId,generation:handle.generation};
    const a=event({type:'activity.updated',activity:'working'},{run:h,sourceKind:'transcript',seq:2,nativeSessionId:'a'});
    const b=event({type:'step.updated',revision:9,step:{id:'missing',title:'missing',weight:1,status:'completed',evidence:'observed'}},{run:h,sourceKind:'transcript',seq:3,nativeSessionId:'a'});
    await expect(store.commitNative([{events:[a]},{events:[b]}],{events:[],cursor:{pathKey:'path',fileGeneration:'gen',committedOffset:10,pendingBytes:new Uint8Array()},expectedCursor:null},s)).rejects.toThrow('STALE_REVISION');
    expect((await store.listSnapshots())[0]?.activity).toBeNull();expect(await store.checkpoint('path')).toBeNull();
  }finally{await store.close();}
});

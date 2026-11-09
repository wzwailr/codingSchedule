import {expect,test} from 'vitest';import {openStore} from '../../src/storage/repository.js';import {handleHook} from '../../src/ingestion/hook.js';
import {source,clock,event} from '../helpers.js';
test('hook missing turn maps only a known transcript call, never latest session head',async()=>{
  const store=await openStore(':memory:',()=>clock()),native={...source('native','transcript'),nativeSessionId:'session'},hook={...source('hook','hook'),nativeSessionId:'session'};
  try{
    const a=await store.resolveNative(native,'a');await store.commit({events:[event({type:'activity.updated',activity:'start'},{run:{runId:a.runId,generation:a.generation},sourceKind:'transcript',nativeSessionId:'session',turnId:'a',nativeCallId:'known',seq:2})]},native);
    const b=await store.resolveNative(native,'b');
    expect(await handleHook(store,hook,{session_id:'session',hook_event_name:'PostToolUse',tool_use_id:'unknown'},clock().wallMs)).toMatchObject({ignored:true});
    expect(await handleHook(store,hook,{session_id:'session',hook_event_name:'PostToolUse',tool_use_id:'known'},clock().wallMs)).toMatchObject({accepted:true});
    expect((await store.context(a,native)).snapshot.activity).toBe('工具执行结束');expect((await store.context(b,native)).snapshot.activity).toBeNull();
  }finally{await store.close();}
});

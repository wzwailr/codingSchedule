import {expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openStore} from '../../src/storage/repository.js';
import {clock,event,source} from '../helpers.js';
import {visibleSessions} from '../../src/renderer/widget.js';
test('native in-flight work survives collector restart without requiring new log bytes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'native-restart-')),now=Date.now(),native={...source('native','transcript'),nativeSessionId:'session',nativeObservedAt:now};
 let store=await openStore(join(dir,'db'),()=>clock(now));
 try{
  const h=await store.resolveNative(native,'turn');await store.commit({events:[event({type:'activity.updated',activity:'执行命令'},{run:{runId:h.runId,generation:h.generation},sourceKind:'transcript',nativeSessionId:'session',turnId:'turn',nativeCallId:'call',occurredAt:now,receivedAt:now,seq:2})]},native);
  await store.close();store=await openStore(join(dir,'db'),()=>clock(now+600000));
  const visible=visibleSessions(await store.listSnapshots(),now+600000);expect(visible).toHaveLength(1);expect(visible[0]?.status).toBe('active');
 }finally{await store.close();await rm(dir,{recursive:true,force:true});}
});

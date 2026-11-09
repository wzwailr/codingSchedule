import {mkdtemp,writeFile,appendFile,rm} from 'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';import{expect,test}from'vitest';
import{openStore}from'../../src/storage/repository.js';import{createAdapter}from'../../src/adapters/registry.js';import{startCollection}from'../../src/collector/service.js';
test('oversized/invalid native records persist partial plan and warn; next full plan clears incomplete marker',async()=>{
 const d=await mkdtemp(join(tmpdir(),'schedule-partial-')),p=join(d,'native.jsonl'),clock=()=>({wallMs:Date.now(),monoMs:performance.now(),continuityId:'partial'}),store=await openStore(join(d,'db'),clock);const errors:string[]=[];
 const plan=(id:string)=>JSON.stringify({type:'response_item',payload:{type:'function_call',name:'update_plan',call_id:id,arguments:JSON.stringify({plan:[{step:'done',status:'completed'}]})}})+'\n';
 await writeFile(p,JSON.stringify({type:'session_meta',payload:{id:'session'}})+'\n'+JSON.stringify({type:'turn_context',payload:{turn_id:'turn'}})+'\n'+plan('first')+'x'.repeat(1048600)+'\n');
 const c=await startCollection(store,[createAdapter('codex',d)],()=>{},{clock,onError:e=>errors.push(e),pollMs:20,discoverMs:20});
 try{const s=(await store.listSnapshots())[0]!;expect(s.plan?.complete).toBe(false);expect(s.progress.value).toBeNull();expect(s.sourcePartial).toBe(true);expect(errors).toContain('部分记录未解析');
 await appendFile(p,plan('recovered'));await expect.poll(async()=>(await store.listSnapshots())[0]?.sourcePartial).toBe(false);expect((await store.listSnapshots())[0]?.progress.value).toBe(100);
 }finally{await c.stop();await store.close();await rm(d,{recursive:true,force:true});}
});

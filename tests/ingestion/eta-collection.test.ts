import {expect,test} from 'vitest';import {mkdtemp,writeFile,appendFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {openStore} from '../../src/storage/repository.js';import {startCollection} from '../../src/collector/service.js';import {parseCodex} from '../../src/adapters/codex/parse.js';import {key,source,clock,NOW} from '../helpers.js';
test('native transcript checkpoints filter progress call AND output, including code wrappers, without faking linked work',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'eta-transcript-')),path=join(dir,'session.jsonl');let elapsed=0;
 const store=await openStore(join(dir,'db'),()=>clock(NOW+elapsed,elapsed)),reporter=source();
 const record=(payload:unknown)=>JSON.stringify({type:'response_item',payload})+'\n';
 await writeFile(path,JSON.stringify({type:'turn_context',payload:{turn_id:'turn'}})+'\n'+record({type:'function_call',name:'exec_command',call_id:'work',arguments:'{}'}));
 const collection=await startCollection(store,[{provider:'codex',parse:parseCodex,discover:async()=>[{path,provider:'codex',nativeSessionId:'session',mtimeMs:NOW}]}],()=>{}, {pollMs:1000000,clock:()=>clock(NOW+elapsed,elapsed)});
 try{
  const h=await store.begin({idempotencyKey:key(),title:'task'},reporter);await store.linkNative(h,{provider:'codex',nativeSessionId:'session'},['turn']);
  const before=(await store.context(h,reporter)).snapshot;elapsed=200000;await store.tick();expect((await store.context(h,reporter)).snapshot.freshness).toBe('stale');
  const append=async(payload:unknown)=>{await appendFile(path,record(payload));await collection.tick();};
  await append({type:'function_call',name:'mcp__codingSchedule__progress_context',call_id:'eta-context',arguments:'{}'});
  await append({type:'function_call_output',call_id:'eta-context',output:'reporter context'});
  let after=(await store.context(h,reporter)).snapshot;expect(after.lastWorkAt).toBe(before.lastWorkAt);expect(after.activity).toBe(before.activity);expect(after.freshness).toBe('stale');
  await append({type:'custom_tool_call',name:'functions.exec',call_id:'eta-wrapper',input:'const r = await tools.mcp__codingSchedule__progress_report({handle}); text(r);'});
  await append({type:'custom_tool_call_output',call_id:'eta-wrapper',output:'ok'});
  after=(await store.context(h,reporter)).snapshot;expect(after.lastWorkAt).toBe(before.lastWorkAt);expect(after.activity).toBe(before.activity);expect(after.freshness).toBe('stale');
  await append({type:'custom_tool_call',name:'functions.exec',call_id:'real-wrapper',input:'await tools.mcp__codingSchedule__progress_context({handle}); await tools.exec_command({cmd:"verify"});'});
  await append({type:'custom_tool_call_output',call_id:'real-wrapper',output:'verified'});
  after=(await store.context(h,reporter)).snapshot;expect(after.lastWorkAt).toBe(NOW+elapsed);expect(after.activity).toBe('工具执行结束');
 }finally{await collection.stop();await store.close();await rm(dir,{recursive:true,force:true});}
});

import {expect,test} from 'vitest';
import {openStore} from '../../src/storage/repository.js';import {parseCodex} from '../../src/adapters/codex/parse.js';import {parseClaude} from '../../src/adapters/claude/parse.js';import {emptyParser} from '../../src/adapters/types.js';import {clock,event,key,plan,source,step} from '../helpers.js';import type {BindingReceipt,NativeReporterBinding} from '../../src/shared/contracts.js';
const checkpoint=(offset=1)=>({events:[],cursor:{pathKey:'receipt-path',fileGeneration:'file',committedOffset:offset,pendingBytes:new Uint8Array()}});
test('fallback binding receipt merges only the exact Codex host item, without pretending the native MCP call succeeded',async()=>{
 const store=await openStore(':memory:',()=>clock()),reporter=source(),native={...source('native','transcript'),nativeSessionId:'session',nativeReplayComplete:true};
 try{
  const handle=await store.begin({idempotencyKey:key(),title:'own task',plan:plan([step('one','completed'),step('two','running')])},reporter),observed=await store.resolveNative(native,'turn');
  await store.commit({events:[event({type:'activity.updated',activity:'actual work'},{run:{runId:observed.runId,generation:observed.generation},sourceKind:'transcript',nativeSessionId:'session',turnId:'turn',seq:2})]},native);
  const receipt=await store.prepareBinding(handle,{sessionId:'session',turnId:'turn',itemId:'ctc-real'},reporter);
  const rows=[{type:'turn_context',payload:{turn_id:'turn'}},{type:'response_item',payload:{type:'custom_tool_call',id:'ctc-real',call_id:'call-real',name:'exec',input:'await tools.mcp__node_repl__js({code:"local report"})'}},{type:'response_item',payload:{type:'custom_tool_call_output',call_id:'call-real',output:[{type:'input_text',text:'metadata\n'+JSON.stringify({codingScheduleBindingReceipt:receipt})}]}}];
  const parsed=parseCodex(rows.map((r,i)=>({text:JSON.stringify(r),offset:i})),{source:native,fileGeneration:'file',previous:emptyParser()});expect(parsed.bindings).toHaveLength(1);expect(parsed.bindings![0]).toMatchObject({nativeItemId:'ctc-real',nativeCallId:'call-real',receipt:receipt.token});
  await store.commitNative([],checkpoint(),native,parsed.bindings);expect((await store.listSnapshots()).find(s=>s.run.runId===handle.runId)?.linkedNativeRun?.runId).toBe(observed.runId);
  await store.commitNative([],checkpoint(),native,parsed.bindings);expect((await store.context(handle,reporter)).snapshot.progress.value).toBe(50);
 }finally{await store.close();}
});
test('forged, copied-to-another-turn/item, expired and foreign-handle claims cannot link a task',async()=>{
 let now=clock();const store=await openStore(':memory:',()=>now),reporter=source(),native={...source('native','transcript'),nativeSessionId:'session',nativeReplayComplete:true};
 try{
  const handle=await store.begin({idempotencyKey:key(),title:'task'},reporter);await store.resolveNative(native,'turn');const receipt=await store.prepareBinding(handle,{sessionId:'session',turnId:'turn',itemId:'item'},reporter);
  await expect(store.prepareBinding({...handle,resumeHandle:'x'.repeat(43)},{sessionId:'session',turnId:'turn',itemId:'item'},reporter)).rejects.toThrow('FORBIDDEN');
  const base:NativeReporterBinding={run:receipt.run,receipt:receipt.token,turnId:'turn',nativeItemId:'item'};
  const linked=async()=>(await store.listSnapshots()).find(s=>s.run.runId===handle.runId)?.linkedNativeRun;
  for(const bad of [{...base,receipt:'0'.repeat(64)},{...base,turnId:'another'},{...base,nativeItemId:'copied-item'}]){await store.commitNative([],checkpoint(),native,[bad]);expect(await linked()).toBeUndefined();}
  await store.commitNative([],checkpoint(),{...native,nativeSessionId:'other'},[base]);expect(await linked()).toBeUndefined();
  now=clock(now.wallMs+600001,600001);await store.commitNative([],checkpoint(),native,[base]);expect(await linked()).toBeUndefined();
 }finally{await store.close();}
});
test('Claude actual tool-use/result correlation accepts the scoped call receipt; model prose and error results do not',async()=>{
 const store=await openStore(':memory:',()=>clock()),reporter={...source(),provider:'claude' as const},native={...source('native','transcript'),provider:'claude' as const,nativeSessionId:'claude-session',nativeReplayComplete:true};
 try{
  const handle=await store.begin({idempotencyKey:key(),title:'Claude task'},reporter),observed=await store.resolveNative(native,'claude-turn'),receipt:BindingReceipt=await store.prepareBinding(handle,{sessionId:'claude-session',turnId:'claude-turn',callId:'tool-real'},reporter);
  const parse=(isError=false)=>parseClaude([{type:'user',uuid:'claude-turn',message:{content:'do work'}},{type:'assistant',message:{content:[{type:'tool_use',id:'tool-real',name:'Bash',input:{command:'local helper'}}]}},{type:'user',message:{content:[{type:'tool_result',tool_use_id:'tool-real',is_error:isError,content:JSON.stringify({codingScheduleBindingReceipt:receipt})}]}}].map((r,i)=>({text:JSON.stringify(r),offset:i})),{source:native,fileGeneration:'file',previous:emptyParser()});
  expect(parse(true).bindings).toHaveLength(0);const parsed=parse();expect(parsed.bindings).toHaveLength(1);await store.commitNative([],checkpoint(),native,parsed.bindings);expect((await store.listSnapshots()).find(s=>s.run.runId===handle.runId)?.linkedNativeRun?.runId).toBe(observed.runId);
  const prose=parseClaude([{text:JSON.stringify({type:'user',uuid:'other-turn',message:{content:'work'}}),offset:10},{text:JSON.stringify({type:'assistant',message:{content:[{type:'text',text:JSON.stringify({codingScheduleBindingReceipt:receipt})}]}}),offset:11}],{source:native,fileGeneration:'file',previous:emptyParser()});expect(prose.bindings).toHaveLength(0);
 }finally{await store.close();}
});

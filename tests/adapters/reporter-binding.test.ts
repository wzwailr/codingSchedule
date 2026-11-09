import {expect,test} from 'vitest';
import {parseCodex} from '../../src/adapters/codex/parse.js';
import {parseClaude} from '../../src/adapters/claude/parse.js';
import {emptyParser} from '../../src/adapters/types.js';
import {reporterReference} from '../../src/adapters/common/reporter-binding.js';
import {source} from '../helpers.js';
const run={runId:'01a18687-d94a-7eec-9a45-bacf76fe7c76',generation:1};
const marker=JSON.stringify({codingScheduleBinding:run});
const ctx=(provider:'codex'|'claude'='codex')=>({source:{...source('native','transcript'),provider,nativeSessionId:'session'},fileGeneration:'file',previous:emptyParser()});
const lines=(...records:unknown[])=>records.map((r,i)=>({text:JSON.stringify(r),offset:i*100}));

test('Codex code-mode public binding survives split batches without retaining handles or creating activity',()=>{
 const c=ctx(),first=parseCodex(lines({type:'turn_context',payload:{turn_id:'turn'}},{type:'response_item',payload:{type:'custom_tool_call',name:'exec',call_id:'c',input:'const r=await tools.mcp__codingSchedule__progress_context({handle:load("private")});text({codingScheduleBinding:load("private")});'}}),c);
 const second=parseCodex(lines({type:'response_item',payload:{type:'custom_tool_call_output',call_id:'c',output:[{type:'input_text',text:'Script completed\nOutput:\n'},{type:'input_text',text:marker}]}}),{...c,previous:first.state});
 expect(second.bindings).toEqual([{run,turnId:'turn'}]);
 expect(second.observations).toEqual([]);
 expect(JSON.stringify(first.state)).not.toContain('private');
});

test('direct MCP results expose only run references; failures, unrelated output and later turns cannot bind',()=>{
 const c=ctx(),a=parseCodex(lines({type:'turn_context',payload:{turn_id:'turn'}},{type:'response_item',payload:{type:'function_call',name:'mcp__codingSchedule__progress_begin',call_id:'c',arguments:'{}'}},{type:'response_item',payload:{type:'function_call_output',call_id:'c',output:JSON.stringify({content:[{type:'text',text:JSON.stringify({handle:{...run,resumeHandle:'never-retain-this-private-handle'}})}]})}}),c);
 expect(a.bindings).toEqual([{run,turnId:'turn'}]);expect(JSON.stringify(a)).not.toContain('never-retain');
 const unrelated=parseCodex(lines({type:'turn_context',payload:{turn_id:'turn'}},{type:'response_item',payload:{type:'function_call',name:'exec_command',call_id:'x',arguments:'{}'}},{type:'response_item',payload:{type:'function_call_output',call_id:'x',output:marker}}),c);
 expect(unrelated.bindings||[]).toEqual([]);
 const fake=parseCodex(lines({type:'turn_context',payload:{turn_id:'turn'}},{type:'response_item',payload:{type:'custom_tool_call',name:'exec',call_id:'x',input:'text("tools.mcp__codingSchedule__progress_begin({})")'}},{type:'response_item',payload:{type:'custom_tool_call_output',call_id:'x',output:marker}}),c);
 expect(fake.bindings||[]).toEqual([]);
 const pending=parseCodex(lines({type:'turn_context',payload:{turn_id:'turn'}},{type:'response_item',payload:{type:'function_call',name:'mcp__codingSchedule__progress_context',call_id:'c',arguments:'{}'}}),c);
 const next=parseCodex(lines({type:'turn_context',payload:{turn_id:'other'}},{type:'response_item',payload:{type:'function_call_output',call_id:'c',output:marker}}),{...c,previous:pending.state});expect(next.bindings||[]).toEqual([]);
 const failed=parseCodex(lines({type:'turn_context',payload:{turn_id:'turn'}},{type:'response_item',payload:{type:'function_call',name:'mcp__codingSchedule__progress_begin',call_id:'c',arguments:'{}'}},{type:'response_item',payload:{type:'function_call_output',call_id:'c',output:JSON.stringify({isError:true,handle:run})}}),c);expect(failed.bindings||[]).toEqual([]);
});

test('Claude correlates the actual MCP tool result and ignores sidechains and ordinary messages',()=>{
 const c=ctx('claude'),result=parseClaude(lines({type:'user',uuid:'turn',message:{content:'go'}},{type:'assistant',message:{content:[{type:'tool_use',id:'c',name:'mcp__codingSchedule__progress_begin',input:{}}]}},{type:'user',message:{content:[{type:'tool_result',tool_use_id:'c',content:JSON.stringify({handle:{...run,resumeHandle:'private'}})}]}}),c);
 expect(result.bindings).toEqual([{run,turnId:'turn'}]);expect(JSON.stringify(result)).not.toContain('private');
 const side=parseClaude(lines({type:'user',uuid:'turn',message:{content:'go'}},{type:'assistant',isSidechain:true,message:{content:[{type:'tool_use',id:'c',name:'mcp__codingSchedule__progress_begin',input:{}}]}},{type:'user',message:{content:[{type:'tool_result',tool_use_id:'c',content:marker}]}}),c);expect(side.bindings||[]).toEqual([]);
});

test('real host input_text arrays unwrap direct results and reject failed or ambiguous wrappers',()=>{
 expect(reporterReference([{type:'input_text',text:JSON.stringify({content:[{type:'text',text:JSON.stringify({handle:{...run,resumeHandle:'private'}})}]})}],'direct')).toEqual(run);
 expect(reporterReference([{type:'input_text',text:'Script failed\nOutput:\n'},{type:'input_text',text:marker}],'wrapped')).toBeNull();
 expect(reporterReference([{type:'input_text',text:marker},{type:'input_text',text:JSON.stringify({codingScheduleBinding:{...run,generation:2}})}],'wrapped')).toBeNull();
});

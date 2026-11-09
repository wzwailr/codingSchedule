import { expect, test } from 'vitest';
import { parseCodex } from '../../src/adapters/codex/parse.js';
import { parseClaude } from '../../src/adapters/claude/parse.js';
import { extractPlan } from '../../src/adapters/codex/plan-call.js';
import { emptyParser } from '../../src/adapters/types.js';
import { source } from '../helpers.js';
const lines = (...records: unknown[]) => records.map((r,i) => ({ text: JSON.stringify(r), offset: i * 100 }));
const ctx = () => ({ source: { ...source('native', 'transcript'), nativeSessionId: 'session' }, fileGeneration: 'gen', previous: emptyParser() });
test('Codex exec literal only: ignores strings/comments, rejects executable expressions and depth bombs', () => {
  expect(extractPlan('"tools.update_plan({plan:[]})"; // tools.update_plan({plan:[]})')).toBeNull();
  expect(extractPlan('await tools.update_plan({plan:[{step:"test",status:"in_progress"}],explanation:"ok"});')?.plan).toHaveLength(1);
  expect(extractPlan('tools.update_plan({plan: globalThis.evil()})')).toBeNull();
  expect(extractPlan('tools.update_plan({plan:[]}.constructor)')).toBeNull();
  expect(extractPlan('tools.update_plan(' + '['.repeat(40) + '0' + ']'.repeat(40) + ')')).toBeNull();
});
test('Codex turn boundaries, direct plan, Stop preserves unfinished plan and pauses', () => {
  const result = parseCodex(lines({ type:'turn_context', payload:{turn_id:'turn-a'} }, {type:'response_item',payload:{type:'function_call',name:'update_plan',call_id:'c',arguments:JSON.stringify({plan:[{step:'test',status:'in_progress'}]})}}, {type:'event_msg',payload:{type:'task_complete'}}),ctx());
  expect(result.observations.map(o => o.payload.type)).toEqual(['run.started','activity.updated','plan.replaced','run.status']);
  const p = result.observations.find(o => o.payload.type === 'plan.replaced')!;
  expect(p.payload).toMatchObject({plan:{complete:true,steps:[{status:'running'}]}});
  expect(result.observations.at(-1)?.payload).toEqual({type:'run.status',status:'paused'});
  expect(parseCodex(lines({type:'response_item',payload:{type:'function_call',name:'update_plan',arguments:'{"plan":[]}'}}),ctx()).observations).toEqual([]);
});
test('Claude tool_use/result checkpoint correlation and partial TaskCreate', () => {
  const c = {...ctx(),source:{...ctx().source,provider:'claude' as const}};
  const a = parseClaude(lines({type:'user',uuid:'turn',sessionId:'session',message:{content:'do it'}},{type:'assistant',message:{content:[{type:'tool_use',id:'call',name:'TaskCreate',input:{subject:'test'}}]}}),c);
  expect(a.state.pendingCalls.call).toBeDefined();
  const b = parseClaude(lines({type:'user',toolUseResult:{task:{id:'1',subject:'test'}},message:{content:[{type:'tool_result',tool_use_id:'call',content:'ok'}]}}),{...c,previous:a.state});
  expect(b.observations.find(o=>o.payload.type === 'plan.replaced')?.payload).toMatchObject({plan:{complete:false,steps:[{id:'1'}]}});
  expect(b.state.pendingCalls.call).toBeUndefined();
});
test('Claude TodoWrite is complete; notifications and compaction are not new tasks', () => {
  const c = {...ctx(),source:{...ctx().source,provider:'claude' as const}};
  const a = parseClaude(lines({type:'user',uuid:'turn',message:{content:'go'}},{type:'assistant',message:{content:[{type:'tool_use',id:'todo',name:'TodoWrite',input:{todos:[{content:'test',status:'completed'}]}}]}},{type:'user',uuid:'noise',isCompactSummary:true,message:{content:'summary'}},{type:'user',uuid:'noise2',message:{content:'<task-notification>done'}}),c);
  expect(a.observations.filter(o=>o.payload.type === 'run.started')).toHaveLength(1);
  expect(a.observations.find(o=>o.payload.type==='plan.replaced')?.payload).toMatchObject({plan:{complete:true,steps:[{status:'completed'}]}});
});
test('Claude final end_turn closes a session without requiring a separate system stop record',()=>{
 const c={...ctx(),source:{...ctx().source,provider:'claude' as const}};
 const result=parseClaude(lines({type:'user',uuid:'turn',message:{content:'go'}},{type:'assistant',message:{content:[{type:'text',text:'done'}],stop_reason:'end_turn'}}),c);
 expect(result.observations.at(-1)?.payload).toEqual({type:'run.status',status:'paused'});
});
test('actual reasoning/text is work even before the first tool; no raw model text is retained',()=>{
 const codex=parseCodex(lines({type:'turn_context',payload:{turn_id:'turn'}},{type:'response_item',payload:{type:'reasoning',summary:[{text:'private reasoning'}]}}),ctx());
 expect(codex.observations.at(-1)?.payload).toEqual({type:'activity.updated',activity:'分析任务'});
 const c={...ctx(),source:{...ctx().source,provider:'claude' as const}},claude=parseClaude(lines({type:'user',uuid:'turn',message:{content:'go'}},{type:'assistant',message:{content:[{type:'thinking',thinking:'private reasoning'}],stop_reason:null}}),c);
 expect(claude.observations.at(-1)?.payload).toEqual({type:'activity.updated',activity:'分析任务'});
 expect(JSON.stringify([codex,claude])).not.toContain('private reasoning');
});

test('Codex host task start is visible before reasoning, while turn context alone is not work',()=>{
 const started=parseCodex(lines({type:'event_msg',payload:{type:'task_started',turn_id:'turn'}},{type:'turn_context',payload:{turn_id:'turn'}}),ctx());
 expect(started.observations.map(o=>o.payload)).toEqual([
  {type:'run.started',title:'Codex 本轮任务',scope:'turn'},
  {type:'activity.updated',activity:'准备响应'}
 ]);
 const identity=parseCodex(lines({type:'turn_context',payload:{turn_id:'turn'}}),ctx());
 expect(identity.observations.map(o=>o.payload.type)).toEqual(['run.started']);
});

test('Claude desktop request archives cannot replay work, pending calls or reporter bindings',()=>{
 const c={...ctx(),source:{...ctx().source,provider:'claude' as const}};
 const live=parseClaude(lines({type:'user',uuid:'turn',message:{content:'go'}},{type:'assistant',message:{content:[{type:'tool_use',id:'work',name:'Bash',input:{}}]}}),c);
 const archived=parseClaude(lines({type:'api-request-blob',message:{content:[{type:'tool_result',tool_use_id:'work',content:'old result'},{type:'tool_use',id:'ghost',name:'Bash',input:{}}]}},{type:'attachment',message:{content:[{type:'tool_use',id:'archive-report',name:'mcp__codingSchedule__progress_begin',input:{}}]}}),{...c,previous:live.state});
 expect(archived.observations).toEqual([]);expect(archived.bindings).toEqual([]);expect(archived.state).toEqual(live.state);
});

test('Claude desktop native update_plan supplies a complete plan without relying on MCP reports',()=>{
 const c={...ctx(),source:{...ctx().source,provider:'claude' as const}};
 const result=parseClaude(lines({type:'user',uuid:'turn',message:{content:'go'}},{type:'assistant',message:{content:[{type:'tool_use',id:'plan',name:'mcp__ccd_turn__update_plan',input:{items:[{content:'read',status:'completed'},{content:'verify',status:'in_progress'}],scope:'first_task'}}]}}),c);
 expect(result.observations.find(o=>o.payload.type==='plan.replaced')?.payload).toMatchObject({plan:{complete:true,steps:[{title:'read',status:'completed'},{title:'verify',status:'running'}]}});
});

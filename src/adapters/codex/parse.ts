import type { Parser } from '../types.js';
import { clean, obj, parserTools } from '../common/parse.js';
import { extractPlan } from './plan-call.js';
import {telemetryOnlyWrapper} from './telemetry.js';
import {reporterCall,reporterReference,bindingReceiptReference} from '../common/reporter-binding.js';
export const parseCodex: Parser = (lines, context) => {
  const t = parserTools(context);
  for (const line of lines) {
    let record: Record<string,unknown>; try { record = obj(JSON.parse(line.text)); } catch { t.diagnostics.push('invalid_json'); continue; }
    const p = obj(record.payload), time = record.timestamp;
    if (record.type === 'turn_context' || record.type === 'event_msg' && p.type === 'task_started') t.turn(clean(p.turn_id,256),line.offset,time);
    if (record.type === 'event_msg' && p.type === 'task_started' && clean(p.turn_id,256)) t.emit({type:'activity.updated',activity:'准备响应'},line.offset,time);
    if (record.type === 'event_msg' && ['task_complete','turn_aborted'].includes(String(p.type))) t.emit({type:'run.status',status:'paused'},line.offset,time);
    if (record.type !== 'response_item' || !t.state.currentTurnId) continue;
    if(p.type==='reasoning')t.emit({type:'activity.updated',activity:'分析任务'},line.offset,time);
    if(p.type==='message'&&p.role==='assistant')t.emit(p.phase==='final'?{type:'run.status',status:'paused'}:{type:'activity.updated',activity:'生成回复'},line.offset,time);
    const name = clean(p.name,120), call = clean(p.call_id,256);
    if (p.type === 'function_call' || p.type === 'custom_tool_call') {
      const input = obj(p.arguments ?? p.input);
      const raw = typeof p.arguments === 'string' ? p.arguments : typeof p.input === 'string' ? p.input : '';
      const code=String(input.code ?? input.cmd ?? raw),safeCall=call&&!['__proto__','constructor','prototype','$plan'].includes(call);
      const binding=reporterCall(name,code),telemetry=/progress_|codingSchedule/.test(name)||telemetryOnlyWrapper(name,code);
      if(telemetry){if(safeCall)t.state.pendingCalls[call]={name:'$report',input:{binding:binding??'receipt',nativeItemId:clean(p.id,256)},offset:line.offset};continue;}
      if(safeCall)t.state.pendingCalls[call]={name,input:{...(binding?{binding}:{}),nativeItemId:clean(p.id,256)},offset:line.offset};
      t.emit({type:'activity.updated',activity:name.includes('exec') ? '执行命令' : name.includes('plan') ? '更新计划' : '使用工具'},line.offset,time,call || undefined);
      const value = /^(tools\.)?update_plan$/.test(name) ? input : name.includes('exec') ? extractPlan(code) : null;
      if (value && Array.isArray(value.plan)) t.plan(value.plan,true,line.offset,time,call || undefined);
    } else if (p.type === 'function_call_output'||p.type==='custom_tool_call_output') {
      if(!call||!Object.hasOwn(t.state.pendingCalls,call)||t.state.pendingCalls[call]!.name==='$plan')continue;
      const pending=t.state.pendingCalls[call]!,kind=obj(pending.input).binding;
      if(kind==='direct'||kind==='wrapped'){const run=reporterReference(p.output,kind);if(run)t.bindings.push({run,turnId:t.state.currentTurnId!});}
      const receipt=bindingReceiptReference(p.output),itemId=obj(pending.input).nativeItemId;if(receipt)t.bindings.push({run:receipt.run,receipt:receipt.token,turnId:t.state.currentTurnId!,nativeCallId:call,...(typeof itemId==='string'&&itemId?{nativeItemId:itemId}:{})});
      delete t.state.pendingCalls[call];if(pending.name==='$report')continue;
      t.emit({type:'activity.updated',activity:'工具执行结束'},line.offset,time,call+':end');
    }
  }
  return t.result();
};

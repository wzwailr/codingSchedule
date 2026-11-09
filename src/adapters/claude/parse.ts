import type { Parser } from '../types.js';
import { clean, obj, parserTools } from '../common/parse.js';
import {reporterCall,reporterReference,bindingReceiptReference} from '../common/reporter-binding.js';
export const parseClaude: Parser = (lines, context) => {
  const t = parserTools(context);
  for (const line of lines) {
    let r: Record<string,unknown>; try { r = obj(JSON.parse(line.text)); } catch { t.diagnostics.push('invalid_json'); continue; }
    if (r.isSidechain === true || !['assistant','user','system'].includes(String(r.type))) continue;
    const message = obj(r.message), content = message.content, time = r.timestamp;
    const text = typeof content === 'string' ? content : Array.isArray(content) ? clean(obj(content.find(c=>obj(c).type==='text')).text,200) : '';
    if (r.type === 'user' && text && !r.isMeta && !r.isCompactSummary && !/^\s*(<task-notification|\[SYSTEM NOTIFICATION)/.test(text)) t.turn(clean(r.uuid,256),line.offset,time);
    if (r.type === 'system' && ['turn_duration','stop','interrupted'].includes(String(r.subtype))) t.emit({type:'run.status',status:'paused'},line.offset,time);
    if (!Array.isArray(content) || !t.state.currentTurnId) continue;
    if(r.type==='assistant'&&content.some(v=>['thinking','text'].includes(String(obj(v).type))))t.emit({type:'activity.updated',activity:content.some(v=>obj(v).type==='thinking')?'分析任务':'生成回复'},line.offset,time);
    for (const raw of content) {
      const block = obj(raw);
      if (r.type==='assistant' && block.type === 'tool_use') {
        const id = clean(block.id,256), name = clean(block.name,120), input = obj(block.input);
        if (!id) continue;
        if(['__proto__','constructor','prototype','$plan'].includes(id))continue;
        const binding=reporterCall(name);
        if(/progress_|codingSchedule/.test(name)){t.state.pendingCalls[id]={name:'$report',input:{binding:binding??'receipt'},offset:line.offset};continue;}
        const allowed:Record<string,unknown>={};
        if(['TaskCreate','TaskUpdate','TaskGet','TaskList'].includes(name))for(const key of ['subject','title','id','taskId','status'])if(typeof input[key]==='string')allowed[key]=clean(input[key],80);
        t.state.pendingCalls[id] = {name,input:allowed,offset:line.offset};
        t.emit({type:'activity.updated',activity:name==='Bash' ? '执行命令' : name==='Read' ? '读取文件' : /Todo|Task/.test(name)||name==='mcp__ccd_turn__update_plan' ? '更新计划' : '使用工具'},line.offset,time,id);
        if (name === 'TodoWrite' && Array.isArray(input.todos)) t.plan(input.todos,true,line.offset,time,id);
        if (name === 'mcp__ccd_turn__update_plan' && Array.isArray(input.items)) t.plan(input.items,input.scope==='first_task',line.offset,time,id);
      }
      if (r.type==='user' && block.type === 'tool_result') {
        const id = clean(block.tool_use_id,256), pending = t.state.pendingCalls[id]; if (!pending) continue;
        const input = obj(pending.input), output = obj(r.toolUseResult ?? block.content);
        const receipt=block.is_error!==true?bindingReceiptReference(block.content):null;if(receipt)t.bindings.push({run:receipt.run,receipt:receipt.token,turnId:t.state.currentTurnId!,nativeCallId:id});
        if(pending.name==='$report'){
          if(block.is_error!==true){const run=reporterReference(block.content,'direct');if(run)t.bindings.push({run,turnId:t.state.currentTurnId!});}
          delete t.state.pendingCalls[id];continue;
        }
        if (pending.name === 'TaskList' && Array.isArray(output.tasks)) t.plan(output.tasks,output.partial !== true,line.offset,time,id);
        else if (['TaskCreate','TaskUpdate','TaskGet'].includes(pending.name)) t.upsert({...input,...obj(output.task ?? output)},line.offset,time,id);
        t.emit({type:'activity.updated',activity:block.is_error ? '工具执行失败' : '工具执行结束'},line.offset,time,id+':end');
        delete t.state.pendingCalls[id];
      }
    }
    if(r.type==='assistant'&&['end_turn','stop_sequence'].includes(String(message.stop_reason)))t.emit({type:'run.status',status:'paused'},line.offset,time);
  }
  return t.result();
};

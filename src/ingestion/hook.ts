import type { NormalizedEvent, Store, TrustedSource } from '../shared/contracts.js';
import { obj, clean } from '../adapters/common/parse.js';
import { createHash } from 'node:crypto';
import {etaQuestionContext} from '../domain/eta-inquiry.js';
export async function handleHook(store:Store,source:TrustedSource,body:unknown,now:number):Promise<unknown> {
  const p=obj(body), name=clean(p.tool_name ?? p.toolName,120), kind=clean(p.hook_event_name ?? p.type,80);
  if (/progress_|codingSchedule/.test(name)) return {ignored:true};
  if(p.agent_id||p.agentId||p.parent_thread_id||p.agent_transcript_path||/[\\/]subagents[\\/]/i.test(String(p.transcript_path||'')))return {ignored:true,reason:'child_agent'};
  const session=clean(p.session_id ?? p['thread-id'],256),call=clean(p.tool_use_id ?? p.call_id,256);
  let turn=clean(p.turn_id ?? p['turn-id'],256);
  if(!session)return {ignored:true,reason:'missing_trusted_identity'};
  const trusted={...source,nativeSessionId:session};
  if(!turn&&call)turn=await store.nativeTurnForCall(trusted,call)||'';
  if(!turn)return {ignored:true,reason:'missing_trusted_identity'};
  // ETA-only hooks are not work observations. A parent session ID alone is
  // insufficient: require the exact call already recorded in its transcript.
  if(p.codingScheduleEstimate===true){
    if(kind!=='PostToolUse'||!call||await store.nativeTurnForCall(trusted,call)!==turn)return {ignored:true};
    const question=await store.takeEtaQuestion(trusted,turn);
    return question?{etaContext:etaQuestionContext(question)}:{ignored:true};
  }
  if(!['PreToolUse','PostToolUse','Stop','Notification','agent-turn-complete'].includes(kind))return {ignored:true};
  const handle=await store.resolveNative(trusted,turn),context=await store.context(handle,trusted);
  const payload:NormalizedEvent['payload']=kind==='Stop'||kind==='agent-turn-complete'?{type:'run.status',status:'paused'}:kind==='Notification'?{type:'run.status',status:'waiting'}:{type:'activity.updated',activity:kind==='PreToolUse'?'使用工具':'工具执行结束'};
  const event:NormalizedEvent={schemaVersion:1,eventId:call?createHash('sha256').update(JSON.stringify([source.provider,session,call,kind])).digest('hex'):'hook:'+now+':'+context.nextSeq,provider:source.provider,sourceKind:'hook',sourceInstanceId:source.sourceInstanceId,nativeSessionId:session,turnId:turn,...(call?{nativeCallId:call+(kind==='PostToolUse'?':end':'')}:{}),seq:context.nextSeq,eventIndex:0,run:{runId:handle.runId,generation:handle.generation},occurredAt:now,receivedAt:now,payload};
  return store.commit({events:[event]},trusted);
}

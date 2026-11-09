// Message-shape normalization adapted from CCAM task-progress.js 364-510, MIT; see origins.json.
import { createHash } from 'node:crypto';
import type { EventPayload, NativeReporterBinding, Plan, Step } from '../../shared/contracts.js';
import type { ParseContext, ParseResult, SourceObservation } from '../types.js';
export function obj(v: unknown): Record<string, unknown> { if (typeof v === 'string') { try { return obj(JSON.parse(v)); } catch { return {}; } } return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string,unknown> : {}; }
export function clean(v: unknown, max = 80): string { return typeof v === 'string' ? v.replace(/\s+/g,' ').trim().slice(0,max) : ''; }
function status(v: unknown): Step['status'] {
  if (['completed','complete','done'].includes(String(v))) return 'completed';
  if (['in_progress','running','active'].includes(String(v))) return 'running';
  if (['deleted','cancelled','skipped'].includes(String(v))) return 'skipped';
  if (v === 'failed') return 'failed'; return 'pending';
}
export function makeSteps(list: unknown[]): Step[] {
  return list.slice(0,100).map((v,i) => {
    const r = obj(v), title = clean(r.step ?? r.content ?? r.subject ?? r.title) || `步骤 ${i+1}`;
    let id = clean(String(r.id ?? r.taskId ?? `step-${i}`));
    if (['__proto__','prototype','constructor'].includes(id)) id = `step-${i}`;
    return { id, title, weight:1 as const, status:status(r.status), evidence:'observed' as const };
  }).filter((s,i,all) => all.findIndex(t=>t.id===s.id)===i);
}
export function parserTools(context: ParseContext) {
  const state = structuredClone(context.previous), observations: SourceObservation[] = [], diagnostics: string[] = [],bindings:NativeReporterBinding[]=[];
  const serials = new Map<number,number>();
  function emit(payload: EventPayload, offset: number, timestamp: unknown, callId?: string) {
    if (!state.currentTurnId) { diagnostics.push('missing_turn'); return; }
    const parsed = typeof timestamp === 'string' ? Date.parse(timestamp) : NaN;
    const serial=serials.get(offset)||0; serials.set(offset,serial+1);
    observations.push({ schemaVersion:1, eventId:createHash('sha256').update(`${context.fileGeneration}:${offset}:${serial}`).digest('hex'), nativeSequence:offset*100+serial+2, provider:context.source.provider, sourceKind:'transcript', sourceInstanceId:context.source.sourceInstanceId,
      ...(context.source.nativeSessionId ? {nativeSessionId:context.source.nativeSessionId} : {}), turnId:state.currentTurnId, ...(callId ? {nativeCallId:callId} : {}), occurredAt:Number.isFinite(parsed) && parsed >= 0 ? parsed : 0, payload });
  }
  function turn(id: string, offset: number, time: unknown) {
    if (!id || id === state.currentTurnId) return;
    state.currentTurnId = id; state.nativePlanRevision = 0; state.completePlan = false; state.pendingCalls = {};
    emit({type:'run.started',title:`${context.source.provider === 'codex' ? 'Codex' : 'Claude'} 本轮任务`,scope:'turn'},offset,time);
  }
  function plan(list: unknown[], complete: boolean, offset: number, time: unknown, call?: string) {
    const steps=makeSteps(list);complete=complete&&steps.length===list.length;
    const p: Plan = { revision:++state.nativePlanRevision, complete, schedule:'unknown', steps, reason:'原生计划更新' };
    state.completePlan = complete;
    state.pendingCalls['$plan'] = { name:'$plan', input:p, offset };
    emit({type:'plan.replaced',plan:p},offset,time,call);
  }
  function upsert(task: unknown, offset: number, time: unknown, call?: string) {
    const old = obj(state.pendingCalls['$plan']?.input), steps = Array.isArray(old.steps) ? old.steps as Step[] : [];
    const item = obj(task), id = String(item.id ?? item.taskId ?? '');
    if (!id) { diagnostics.push('task_without_id'); return; }
    const previous = steps.find(s=>s.id===id);
    const merged = {...previous,...item, id, title:clean(item.subject ?? item.title) || previous?.title || '已发现步骤'};
    plan([...steps.filter(s=>s.id!==id),merged],false,offset,time,call);
  }
  const result = (): ParseResult => {
    const entries = Object.entries(state.pendingCalls).sort((a,b)=>a[1].offset-b[1].offset);
    while(entries.length > 200 || Buffer.byteLength(JSON.stringify(Object.fromEntries(entries))) > 262144) { entries.shift(); state.completePlan = false; diagnostics.push('checkpoint_partial'); }
    state.pendingCalls = Object.fromEntries(entries);
    return { state, observations, diagnostics,bindings };
  };
  return { state, observations, diagnostics, bindings, emit, turn, plan, upsert, result };
}

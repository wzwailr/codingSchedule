import type { ClockSample, Freshness, NormalizedEvent, Plan, RunState } from '../shared/contracts.js';
import { fail } from '../shared/errors.js';
import { validateEvent, validatePlan } from '../shared/schemas.js';
import { calculateProgress } from './progress.js';
import { advanceClock, emptyTiming } from './clock.js';
import { estimateRemaining,refreshRemaining } from './eta.js';
import {acceptEtaAnswer,invalidateEtaInquiry,suspendEtaInquiry} from './eta-inquiry.js';
const terminal = new Set(['reported_done', 'verified_done', 'failed', 'cancelled']);
function planWriterKey(event: NormalizedEvent): string {
  return event.sourceKind !== 'reporter' && event.nativeSessionId
    ? JSON.stringify([event.sourceKind, event.provider, event.nativeSessionId]) : event.sourceInstanceId;
}
export function classifyFreshness(lastWorkAt: number | null, now: number): Freshness {
  if (lastWorkAt === null) return 'stale';
  const age = Math.max(0, now - lastWorkAt);
  return age <= 60_000 ? 'fresh' : age <= 180_000 ? 'aging' : 'stale';
}
export function createRunState(input: NormalizedEvent, clock: ClockSample): RunState {
  const event = validateEvent(input);
  if (event.payload.type !== 'run.started') fail('START_REQUIRED', 400);
  return {
    snapshot: { run: { ...event.run }, provider: event.provider, title: event.payload.title, scope: event.payload.scope,
      status: 'active', plan: null, activity: null, progress: calculateProgress(null),
      ...(event.payload.scope==='turn'?{nativeActivity:{lastEventAt:Math.min(event.occurredAt,event.receivedAt),inFlight:false,hasWork:false}}:{}),
      ...(event.payload.scope==='turn'&&event.nativeSessionId&&event.turnId?{nativeSession:{id:event.nativeSessionId,turnId:event.turnId}}:{}),
      eta: { range: null, basis: 'unknown', reason: 'not_estimated' }, freshness: 'fresh',
      lastWorkAt: event.receivedAt, lastSeenAt: event.receivedAt,...(event.sourceKind==='reporter'?{reportedAt:event.receivedAt}:{}) },
    timing: emptyTiming(), lastClock: { ...clock },
    planOwner: event.sourceKind === 'reporter' ? planWriterKey(event) : null,
  };
}
function nativeWork(state:RunState,event:NormalizedEvent):void {
  if(state.snapshot.scope!=='turn'||event.sourceKind==='reporter')return;
  const p=event.payload;
  if(!['activity.updated','plan.replaced','step.updated','run.status'].includes(p.type))return;
  const calls=new Set(state.pendingNativeCalls||[]);
  if(p.type==='activity.updated'&&event.nativeCallId){
    if(event.nativeCallId.endsWith(':end'))calls.delete(event.nativeCallId.slice(0,-4));
    else if(event.occurredAt>0&&event.receivedAt-event.occurredAt<=180000)calls.add(event.nativeCallId);
  }
  if(p.type==='run.status'&&p.status!=='active')calls.clear();
  state.pendingNativeCalls=[...calls].slice(-200);
  state.snapshot.nativeActivity={lastEventAt:Math.max(state.snapshot.nativeActivity?.lastEventAt||0,Math.min(event.occurredAt,event.receivedAt)),inFlight:state.pendingNativeCalls.length>0,hasWork:state.snapshot.nativeActivity?.hasWork===true||['activity.updated','plan.replaced','step.updated'].includes(p.type)};
}
function checkPlanChange(previous: Plan | null, next: Plan): void {
  if (previous && next.revision <= previous.revision) fail('STALE_REVISION');
  for (const old of previous?.steps || []) {
    const current = next.steps.find((s) => s.id === old.id);
    if ((!current || (current.status === 'skipped' && old.status !== 'skipped') ||
      (old.status === 'completed' && current.status !== 'completed')) && !next.reason) fail('SCOPE_REASON_REQUIRED');
    if (!current) continue;
    if (old.estimate && current.estimate) {
      if (current.estimate.version < old.estimate.version ||
        (current.estimate.version === old.estimate.version && (current.estimate.minSec !== old.estimate.minSec || current.estimate.maxSec !== old.estimate.maxSec))) fail('ESTIMATE_VERSION');
    } else if (old.estimate && !current.estimate) {
      if (!next.reason) fail('ESTIMATE_REMOVAL_REASON_REQUIRED');
    }
  }
}
function setPlan(state: RunState, plan: Plan): void {
  const previous = state.snapshot.plan;
  const estimateChanged=JSON.stringify(previous?.steps.map(s=>[s.id,s.estimate])||[])!==JSON.stringify(plan.steps.map(s=>[s.id,s.estimate]));
  for (const step of plan.steps) {
    const old = previous?.steps.find((s) => s.id === step.id);
    let attempt = state.timing.currentAttemptByStep[step.id] || 1;
    if ((old?.status === 'completed' && step.status !== 'completed') || (old?.status === 'failed' && step.status === 'running')) {
      attempt++;
      state.timing.completedSamples=state.timing.completedSamples.filter(s=>s.stepId!==step.id);
    }
    state.timing.currentAttemptByStep[step.id] = attempt;
    const key = step.id + ':' + attempt;
    state.timing.activeMsByAttempt[key] ??= 0;
    if (step.estimate && (step.estimate.version !== old?.estimate?.version || !state.timing.estimateAnchors[key])) {
      state.timing.estimateAnchors[key] = { version: step.estimate.version, anchorActiveMs: state.timing.activeMsByAttempt[key], kind: step.status === 'running' && old?.status !== 'pending' ? 'remaining' : 'prior', continuous: true };
    }
    state.timing.attemptSamples??={};
    if(step.status==='running'&&old?.status!=='running'&&step.estimate)state.timing.attemptSamples[key]={estimate:{minSec:step.estimate.minSec,maxSec:step.estimate.maxSec},version:step.estimate.version,valid:old?.status==='pending'&&state.timing.continuous};
    const sample=state.timing.attemptSamples[key];
    if(sample&&old?.status==='running'&&(step.estimate?.version!==sample.version||!state.timing.estimateAnchors[key]?.continuous))sample.valid=false;
    if(sample&&old?.status==='running'&&step.status==='completed')state.timing.completedSamples.push({stepId:step.id,attempt,activeSec:state.timing.activeMsByAttempt[key]/1000,estimateAtStart:sample.estimate,valid:sample.valid});
    if(sample&&step.status==='failed')sample.valid=false;
  }
  state.snapshot.plan = structuredClone(plan);
  if(plan.complete)state.snapshot.sourcePartial=false;
  state.snapshot.progress = calculateProgress(plan);
  if(estimateChanged&&plan.steps.some(s=>s.estimate&&!['completed','skipped'].includes(s.status))){const fromPlan={...state.timing};delete fromPlan.agentEstimate;if(estimateRemaining(plan,fromPlan).range)delete state.timing.agentEstimate;}
  refreshRemaining(state,state.lastClock!.wallMs,estimateChanged&&plan.steps.some(s=>s.estimate&&!['completed','skipped'].includes(s.status)));
}
export function reduceRun(input: RunState, rawEvent: NormalizedEvent, clock: ClockSample): RunState {
  const event = validateEvent(rawEvent);
  if (input.snapshot.run.runId !== event.run.runId || input.snapshot.run.generation !== event.run.generation || input.snapshot.provider !== event.provider) fail('RUN_MISMATCH');
  const state = structuredClone(input);
  state.timing = advanceClock(input, clock);
  refreshRemaining(state,clock.wallMs);
  state.lastClock = { ...clock };
  state.snapshot.lastSeenAt = Math.max(state.snapshot.lastSeenAt, event.receivedAt);
  const p = event.payload;
  if (p.type === 'source.heartbeat') {
    state.snapshot.freshness = classifyFreshness(state.snapshot.lastWorkAt, clock.wallMs);
    return state;
  }
  if (terminal.has(state.snapshot.status) && !(p.type === 'completion.verified' && state.snapshot.status === 'reported_done')) fail('TERMINAL_RUN');
  const reporterOwned = state.snapshot.scope === 'task' && state.planOwner !== null;
  const foreign = reporterOwned && (event.sourceKind !== 'reporter' || event.sourceInstanceId !== state.planOwner);
  if (foreign && !['activity.updated', 'completion.verified'].includes(p.type)) {
    state.snapshot.freshness = classifyFreshness(state.snapshot.lastWorkAt, clock.wallMs);
    return state;
  }
  if ((p.type === 'plan.replaced' || p.type === 'step.updated') && state.planOwner && state.planOwner !== planWriterKey(event)) {
    state.snapshot.freshness = classifyFreshness(state.snapshot.lastWorkAt, clock.wallMs);
    return state;
  }
  switch (p.type) {
    case 'source.diagnostic':
      state.snapshot.sourcePartial=p.partial;
      if(p.partial&&state.snapshot.plan){state.snapshot.plan.complete=false;state.snapshot.progress=calculateProgress(state.snapshot.plan);refreshRemaining(state,clock.wallMs);}
      state.snapshot.freshness=classifyFreshness(state.snapshot.lastWorkAt,clock.wallMs);return state;
    case 'plan.replaced': {
      const plan = validatePlan(p.plan);
      checkPlanChange(state.snapshot.plan, plan);
      invalidateEtaInquiry(state);
      state.planOwner = planWriterKey(event);
      setPlan(state, plan);
      break;
    }
    case 'step.updated': {
      const plan = state.snapshot.plan;
      if (!plan || plan.revision !== p.revision) fail('STALE_REVISION');
      const previous = plan.steps.find((s) => s.id === p.step.id);
      if (!previous) fail('UNKNOWN_STEP');
      if ((p.step.status === 'skipped' && previous.status !== 'skipped') ||
        (previous.status === 'completed' && p.step.status !== 'completed') ||
        previous.weight !== p.step.weight || JSON.stringify(previous.estimate) !== JSON.stringify(p.step.estimate)) fail('PLAN_REVISION_REQUIRED');
      setPlan(state, { ...plan, steps: plan.steps.map((s) => s.id === p.step.id ? p.step : s) });
      break;
    }
    case 'activity.updated':
      if (event.receivedAt >= (state.snapshot.lastWorkAt || 0)) {state.snapshot.activity = p.activity;state.snapshot.activitySource={provider:event.provider,kind:event.sourceKind};}
      if(state.snapshot.scope==='turn'&&state.snapshot.status==='paused'&&event.sourceKind!=='reporter')state.snapshot.status='active';
      break;
    case 'eta.answered':
      if(event.sourceKind!=='reporter')fail('FORBIDDEN',403);
      acceptEtaAnswer(state,p,clock.wallMs);
      refreshRemaining(state,clock.wallMs,p.range!==null&&p.range.maxSec-p.range.minSec<=600);
      state.snapshot.freshness=classifyFreshness(state.snapshot.lastWorkAt,clock.wallMs);
      return state;
    case 'run.status':
      if (['reported_done', 'verified_done'].includes(p.status)) fail('COMPLETION_EVENT_REQUIRED', 400);
      if(p.status!=='active')suspendEtaInquiry(state);
      state.snapshot.status = p.status;
      break;
    case 'completion.reported': {
      const plan = state.snapshot.plan;
      if (plan && (!plan.complete || plan.steps.some((s) => !['completed', 'skipped'].includes(s.status)))) fail('INCOMPLETE_PLAN');
      state.snapshot.status = 'reported_done';
      break;
    }
    case 'completion.verified':
      if (state.snapshot.status !== 'reported_done') fail('REPORT_COMPLETION_FIRST');
      state.snapshot.status = 'verified_done';
      break;
    case 'run.started': fail('RUN_ALREADY_EXISTS');
  }
  state.snapshot.lastWorkAt = Math.max(state.snapshot.lastWorkAt || 0, event.receivedAt);
  if(event.sourceKind==='reporter')state.snapshot.reportedAt=event.receivedAt;
  nativeWork(state,event);
  state.snapshot.freshness = classifyFreshness(state.snapshot.lastWorkAt, clock.wallMs);
  return state;
}

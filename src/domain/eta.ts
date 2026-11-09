import type { Plan, RunSnapshot, RunState, TimingState } from '../shared/contracts.js';
import {refreshProgress} from './display-progress.js';
// Capture valid estimates from any supported source. Missing data, null replies,
// partial plans and reconnects must not discard an already accepted countdown.
export function refreshRemaining(state:RunState,asOf:number,revisedEta=false):void {
  const legacy=state.timing.agentEstimate;
  if(!state.timing.retainedEta&&legacy?.range)state.timing.retainedEta={range:{...legacy.range},anchorActiveMs:legacy.anchorActiveMs,basis:'agent'};
  const current=estimateRemaining(state.snapshot.plan,state.timing),active=state.timing.taskActiveMs||0;
  if(current.range&&current.basis!=='unknown')state.timing.retainedEta={range:{...current.range},anchorActiveMs:active,basis:current.basis};
  const retained=state.timing.retainedEta;
  if(!retained){state.snapshot.eta={...current,asOf};refreshProgress(state,asOf,revisedEta);return;}
  const elapsed=Math.max(0,(active-retained.anchorActiveMs)/1000),overdueSec=Math.max(0,elapsed-retained.range.maxSec);
  state.snapshot.eta={range:{minSec:Math.max(0,retained.range.minSec-elapsed),maxSec:Math.max(0,retained.range.maxSec-elapsed)},basis:retained.basis,asOf,...(overdueSec>0?{reason:'overdue',overdueSec}:{})};
  refreshProgress(state,asOf,revisedEta);
}
export function estimateRemaining(plan:Plan|null,timing:TimingState):RunSnapshot['eta'] {
  const unknown=(reason:string):RunSnapshot['eta']=>({range:null,basis:'unknown',reason});
  const agent=timing.agentEstimate;
  if(agent){
    if(!agent.continuous)return unknown('continuity_lost');
    if(!agent.range)return unknown('agent_unknown');
    const elapsed=Math.max(0,((timing.taskActiveMs||0)-agent.anchorActiveMs)/1000);
    if(elapsed>agent.range.maxSec)return unknown('overdue');
    return {range:{minSec:Math.max(0,agent.range.minSec-elapsed),maxSec:Math.max(0,agent.range.maxSec-elapsed)},basis:'agent'};
  }
  if(!plan?.complete||!plan.steps.length)return unknown('incomplete_plan');
  if(plan.schedule!=='serial'||plan.steps.filter(s=>s.status==='running').length>1)return unknown('schedule_unknown');
  const ratios=timing.completedSamples.filter(s=>s.valid&&s.activeSec>0).map(s=>s.activeSec/((s.estimateAtStart.minSec+s.estimateAtStart.maxSec)/2)).filter(Number.isFinite).sort((a,b)=>a-b);
  const middle=Math.floor(ratios.length/2),median=ratios.length%2?ratios[middle]!:(ratios[middle-1]!+ratios[middle]!)/2;
  const k=ratios.length>=3?Math.max(.5,Math.min(3,median)):1;
  let minSec=0,maxSec=0,calibrated=false;
  for(const step of plan.steps){
    if(['completed','skipped'].includes(step.status))continue;
    if(step.status==='failed'||!step.estimate)return unknown('missing_estimate');
    const key=step.id+':'+(timing.currentAttemptByStep[step.id]||1),anchor=timing.estimateAnchors[key];
    if(step.status==='running'&&(!anchor?.continuous))return unknown('continuity_lost');
    const factor=step.status==='running'&&anchor?.kind==='remaining'?1:k;
    const elapsed=step.status==='running'?Math.max(0,((timing.activeMsByAttempt[key]||0)-(anchor?.anchorActiveMs||0))/1000):0;
    if(step.status==='running'&&elapsed>step.estimate.maxSec*factor)return unknown('overdue');
    minSec+=Math.max(0,step.estimate.minSec*factor-elapsed);maxSec+=Math.max(0,step.estimate.maxSec*factor-elapsed);
    if(factor!==1&&ratios.length>=3)calibrated=true;
  }
  return {range:{minSec,maxSec},basis:calibrated?'calibrated':'prior'};
}

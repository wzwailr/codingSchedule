import {randomUUID} from 'node:crypto';
import type {EtaAnswer,EtaQuestion,RunState} from '../shared/contracts.js';
import {fail} from '../shared/errors.js';
export const ETA_INTERVAL_MS=120000;
export function currentEtaQuestion(state:RunState,now:number):EtaQuestion|undefined {
 const q=state.etaInquiry?.question;
 return state.snapshot.status==='active'&&q&&q.expiresAt>now&&q.planRevision===(state.snapshot.plan?.revision||0)?q:undefined;
}
export function invalidateEtaInquiry(state:RunState):void {
 const asked=state.etaInquiry?.asked===true||!!state.etaInquiry?.question||!!state.etaInquiry?.nextAt||!!state.snapshot.etaInquiry;
 state.etaInquiry={question:null,nextAt:0,failures:0,asked};delete state.snapshot.etaInquiry;
}
export function suspendEtaInquiry(state:RunState):void {
 if(state.etaInquiry){state.etaInquiry.question=null;state.etaInquiry.nextAt=0;state.etaInquiry.hookDelivered=false;delete state.etaInquiry.update;}
 delete state.snapshot.etaInquiry;
}
export function refreshEtaInquiry(state:RunState,now:number):void {
 if(state.snapshot.scope!=='task')return;
 if(state.snapshot.status!=='active'){suspendEtaInquiry(state);return;}
 const inquiry=state.etaInquiry??={question:null,nextAt:0,failures:0};
 inquiry.asked??=!!inquiry.question||inquiry.nextAt>0||!!state.snapshot.etaInquiry;
 const revision=state.snapshot.plan?.revision||0;
 if(!inquiry.update||inquiry.update.planRevision!==revision)inquiry.update={requestId:randomUUID(),planRevision:revision};
 if(state.timing.retainedEta){inquiry.question=null;return;}
 if(inquiry.question&&inquiry.question.expiresAt<=now){
  inquiry.question=null;inquiry.failures=Math.min(3,inquiry.failures+1);
  inquiry.nextAt=0;
  if(state.snapshot.etaInquiry)state.snapshot.etaInquiry.state='unanswered';
 }
 if(inquiry.question||inquiry.asked)return;
 inquiry.asked=true;
 inquiry.question={requestId:randomUUID(),run:{...state.snapshot.run},planRevision:state.snapshot.plan?.revision||0,requestedAt:now,expiresAt:now+ETA_INTERVAL_MS};
 inquiry.hookDelivered=false;
 const answeredAt=state.snapshot.etaInquiry?.answeredAt;
 state.snapshot.etaInquiry={state:'queued',channel:'cooperative',requestedAt:now,...(answeredAt===undefined?{}:{answeredAt})};
}
export function acceptEtaAnswer(state:RunState,answer:EtaAnswer,now:number):void {
 const q=currentEtaQuestion(state,now);
 const update=state.snapshot.status==='active'?state.etaInquiry?.update:undefined;
 if(!(q?.requestId===answer.requestId&&q.planRevision===answer.planRevision)&&!(update?.requestId===answer.requestId&&update.planRevision===answer.planRevision))fail('STALE_ETA_REQUEST');
 if(answer.planRevision!==(state.snapshot.plan?.revision||0))fail('STALE_ETA_REQUEST');
 if(answer.range&&answer.range.maxSec-answer.range.minSec>600){state.snapshot.etaWarning='ETA_RANGE_TOO_WIDE';return;}
 delete state.snapshot.etaWarning;
 if(answer.range||!state.timing.retainedEta)state.timing.agentEstimate={range:answer.range,anchorActiveMs:state.timing.taskActiveMs||0,continuous:true,reason:answer.reason};
 state.etaInquiry!.question=null;state.etaInquiry!.failures=0;
 state.etaInquiry!.asked=true;state.etaInquiry!.nextAt=0;
 state.snapshot.etaInquiry={state:'answered',channel:state.snapshot.etaInquiry?.channel||'cooperative',requestedAt:q?.requestedAt??now,answeredAt:now};
}
export function etaQuestionContext(q:EtaQuestion):string {
 return 'Initial codingSchedule ETA request (not a user message). Only the original task agent holding the private handle for '+JSON.stringify(q.run)+' may answer. At a natural reporting boundary use progress_report eta.answered with nextSeq, a fresh UUIDv7 reportId, requestId '+JSON.stringify(q.requestId)+', planRevision '+q.planRevision+' and an honest remaining ACTIVE range with maxSec - minSec <= 600, or null if it cannot be bounded honestly. Do not interrupt work or add chat prose. There is no periodic re-estimation requirement: the widget keeps counting down. If the estimate later needs changing, use context.etaUpdate to publish a revision. Ignore this request if it has expired or you do not own this task.';
}

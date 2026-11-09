import type { RunRef,RunSnapshot } from '../shared/contracts.js';
import type {ActivityView} from '../shared/ui-contract.js';
import {displayedProgress} from '../domain/display-progress.js';
import {activityAt} from '../shared/sessions.js';
export {visibleSessions,sessionLabel} from '../shared/sessions.js';
export function activityContent(s:RunSnapshot,view:ActivityView):{text:string;source:string;at:number|null}{
 if(view==='work'){
  const reported=s.activitySource?.kind==='reporter'||s.scope==='task'&&!s.activitySource&&s.reportedAt!==undefined;
  const text=reported?s.activity?.trim():null;
  return {text:text||'尚未收到具体工作事项',source:text?'AI 汇报':'等待 AI 汇报',at:text?s.reportedAt??s.lastWorkAt:null};
 }
 const nativeText=s.nativeActivity?.action?.trim()||((s.activitySource&&s.activitySource.kind!=='reporter'||s.scope==='turn')?s.activity?.trim():null);
 const text=nativeText||(s.nativeActivity?.inFlight?'工具执行中':null);
 return {text:text||'尚未检测到执行状态',source:text?'会话观察':'等待会话活动',at:text?s.nativeActivity?.lastEventAt??s.lastWorkAt:null};
}
export function statusText(s:RunSnapshot):string {
  return {active:'进行中',waiting:'等待你处理',blocked:'遇到阻碍',paused:'已暂停',reported_done:'AI 报告完成',verified_done:'已验收',failed:'任务失败',cancelled:'已取消'}[s.status];
}
export function progressText(s:RunSnapshot,now=Date.now()):string {const value=displayedProgress(s,now);return value===null?'进度未知':value===100&&s.status==='active'?'计划 100% · 待收尾':`${value}%`;}
function clockText(value:number):string {
  const seconds=Math.max(0,Math.ceil(value)),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds/60)%60,rest=seconds%60;
  return (hours?String(hours).padStart(2,'0')+':':'')+String(minutes).padStart(2,'0')+':'+String(rest).padStart(2,'0');
}
export function etaText(s:RunSnapshot,now=Date.now()):string {
  const paused=['waiting','paused','blocked'].includes(s.status);
  if(paused&&!s.eta.range)return '计时暂停';
  if(['reported_done','verified_done','failed','cancelled'].includes(s.status))return statusText(s);
  if(s.progress.value===100&&!s.eta.range)return '等待收尾';
  if(!s.eta.range){
    if(s.freshness==='stale')return '状态可能过期，暂不能估时';
    if(s.etaInquiry?.state==='queued'||s.etaInquiry?.state==='sent')return '等待 agent 估时';
    if(s.etaInquiry?.state==='unanswered')return 'agent 暂未答复';
    return s.eta.reason==='overdue'?'已超原估计，等待更新':s.eta.reason==='agent_unknown'?'agent 暂无法估时':'暂不能估时';
  }
  const drift=!paused&&s.eta.asOf!==undefined?Math.max(0,(now-s.eta.asOf)/1000):0,{minSec,maxSec}=s.eta.range;
  if(!paused&&(s.eta.reason==='overdue'||drift>maxSec))return '已超时 '+clockText((s.eta.overdueSec||0)+Math.max(0,drift-maxSec));
  const lower=Math.max(0,minSec-drift),upper=Math.max(0,maxSec-drift),low=clockText(lower),high=clockText(upper),range=upper-lower>600?'约'+clockText((lower+upper)/2):low===high?high:low+'–'+high;
  return (paused?'计时暂停 · ':'剩余 ')+range+`（${s.eta.basis==='agent'?'AI 粗估':'粗估'}）`;
}
export function inquiryText(s:RunSnapshot):string {
  if(s.eta.range)return '按最近一次有效估时倒计时；估时变化时更新';
  if(s.scope!=='task')return '已检测到会话，尚未收到 agent 的进度计划';
  if(!s.etaInquiry)return '';
  const channel=s.etaInquiry.channel==='hook'?'异步 Hook':'MCP 协作取件';
  if(s.etaInquiry.state==='queued')return '已请求估时 · '+channel+'等待原 agent 的安全工具边界';
  if(s.etaInquiry.state==='sent')return '问题已交给 Hook · 等待宿主安全点处理，主任务继续';
  if(s.etaInquiry.state==='unanswered')return '本次估时请求暂未答复 · 主任务继续';
  return s.eta.basis==='agent'?'活跃时间递减，等待时冻结':s.eta.reason==='agent_unknown'?'原 agent 暂无法给出可靠区间':'';
}
export function screenEta(s:RunSnapshot,now=Date.now()):{value:string;label:string}{
  const text=etaText(s,now),basis=s.eta.basis==='agent'?'AI 粗估':'粗估';
  if(s.status==='reported_done')return {value:'AI 已完成',label:'尚待人工验收'};
  if(s.status==='verified_done')return {value:'已验收',label:'人工确认完成'};
  if(s.status==='failed')return {value:'任务失败',label:'展开查看当前动作'};
  if(s.status==='cancelled')return {value:'已取消',label:'任务已停止'};
  if(text.startsWith('已超时 '))return {value:text.replace('已超时 ','超时 '),label:'原估时已过 · 等待更新'};
  if(s.eta.range){const paused=['waiting','paused','blocked'].includes(s.status);return {value:text.replace(/^(剩余 |计时暂停 · )/,'').replace(/（.*）$/,''),label:(paused?'计时暂停':'预计剩余')+' · '+basis};}
  return {value:'—',label:text};
}
export function shortScreenState(s:RunSnapshot):string{
 if(s.freshness==='stale'&&['active','waiting','blocked','paused'].includes(s.status))return {active:'过期',waiting:'等·旧',blocked:'阻·旧',paused:'停·旧'}[s.status as 'active'|'waiting'|'blocked'|'paused'];
 return {active:'进行',waiting:'等待',blocked:'受阻',paused:'暂停',reported_done:'AI完',verified_done:'验收',failed:'失败',cancelled:'取消'}[s.status];
}
export function shortScreenEta(s:RunSnapshot,now=Date.now()):string{
 if(['reported_done','verified_done','failed','cancelled'].includes(s.status))return {reported_done:'待验',verified_done:'已验',failed:'失败',cancelled:'取消'}[s.status as 'reported_done'|'verified_done'|'failed'|'cancelled'];
 if(!s.eta.range)return s.eta.reason==='overdue'?'超时':s.progress.value===100?'收尾':'待估';
 const paused=['waiting','paused','blocked'].includes(s.status),drift=!paused&&s.eta.asOf!==undefined?Math.max(0,(now-s.eta.asOf)/1000):0;
 if(!paused&&(s.eta.reason==='overdue'||drift>s.eta.range.maxSec))return '超时';
 const low=Math.max(0,s.eta.range.minSec-drift),high=Math.max(0,s.eta.range.maxSec-drift);
 if(high-low>600){const [unit,label]:[number,string]=high>=86400?[86400,'天']:high>=3600?[3600,'时']:[60,'分'];return '≈'+Math.round((low+high)/2/unit)+label;}
 // Hour rounding must not turn a ten-minute interval into a one-hour span.
 // Tiny screens use minutes for these narrow ranges; the tooltip stays exact.
 if(high>=3600&&high-low<=600.01){if(high>36000)return '≈'+Math.round(high/3600)+'h';const a=Math.round(low/60),b=Math.round(high/60);return (a===b?String(b):a+'–'+b)+'m';}
 const [unit,label]:[number,string]=high>=86400?[86400,'天']:high>=3600?[3600,'时']:high>=60?[60,'分']:[1,'秒'];
 // Outward rounding retains the original interval; equal displayed endpoints
 // are a single rounded value, never an invented precise completion time.
 let a=Math.floor(low/unit),b=Math.ceil(high/unit);if(label==='分'&&b-a>10){a=Math.round(low/unit);b=Math.round(high/unit);}return (a===b?String(b):a+'–'+b)+label;
}
export function sameRun(a:RunRef|null,b:RunRef|null):boolean{return !!a&&!!b&&a.runId===b.runId&&a.generation===b.generation;}
export function chooseRun(snapshots:RunSnapshot[],selected:RunRef|null,frozen:boolean,manual=false):RunRef|null {
  const active=snapshots.filter(s=>['active','waiting','blocked'].includes(s.status));
  const old=active.find(s=>sameRun(s.run,selected));
  if(old&&(frozen||manual))return old.run;
  return active.sort((a,b)=>activityAt(b)-activityAt(a))[0]?.run??null;
}
export class HoverIntent {
  private timer:ReturnType<typeof setTimeout>|undefined;private pinned=false;
  constructor(private change:(expanded:boolean)=>void){}
  enter(){clearTimeout(this.timer);this.timer=setTimeout(()=>this.change(true),250);}
  leave(){clearTimeout(this.timer);if(!this.pinned)this.timer=setTimeout(()=>this.change(false),400);}
  pin(value:boolean){this.pinned=value;clearTimeout(this.timer);}
  dispose(){clearTimeout(this.timer);}
}

import type {RunSnapshot} from './contracts.js';
export const activityAt=(s:RunSnapshot)=>s.scope==='turn'?s.nativeActivity?.lastEventAt||0:Math.max(s.lastWorkAt||0,s.nativeActivity?.lastEventAt||0);
export function visibleSessions(snapshots:RunSnapshot[],now=Date.now()):RunSnapshot[]{
 const sessions=new Map<string,RunSnapshot>(),byRun=new Map(snapshots.map(s=>[s.run.runId,s]));
 for(const original of snapshots){
  const native=original.linkedNativeRun?byRun.get(original.linkedNativeRun.runId):undefined;
  const s=native?.nativeSession&&native.run.generation===original.linkedNativeRun?.generation?{...original,provider:native.provider,nativeSession:native.nativeSession,...(native.nativeActivity?{nativeActivity:{...original.nativeActivity,...native.nativeActivity}}:{}),status:['active','waiting','blocked'].includes(native.status)?original.status:native.status}:original;
  const key=s.nativeSession?JSON.stringify([s.provider,s.nativeSession.id]):s.run.runId,previous=sessions.get(key);
  const generation=s.linkedNativeRun?.generation??s.run.generation,oldGeneration=previous?.linkedNativeRun?.generation??previous?.run.generation??0;
  if(!previous||(s.nativeSession?generation>oldGeneration||generation===oldGeneration&&s.scope==='task'&&previous.scope!=='task':activityAt(s)>activityAt(previous)))sessions.set(key,s);
 }
 return [...sessions.values()].filter(s=>['active','waiting','blocked'].includes(s.status)&&(s.scope==='task'||s.nativeActivity?.hasWork!==false)&&activityAt(s)>0&&(now-activityAt(s)<=180000||s.status==='active'&&s.nativeActivity?.inFlight===true||s.scope==='task'&&!!s.linkedNativeRun&&byRun.get(s.linkedNativeRun.runId)?.status==='active'))
  .sort((a,b)=>activityAt(b)-activityAt(a)||a.run.runId.localeCompare(b.run.runId));
}
export function sessionLabel(s:RunSnapshot):string{return s.nativeSession?`${s.nativeSession.project||'未知项目'} · ${s.nativeSession.name||'未命名会话'}`:s.title;}
export function associationRuns(snapshots:RunSnapshot[],now=Date.now()){
 return {targets:visibleSessions(snapshots,now).filter(s=>s.scope==='task'),natives:visibleSessions(snapshots.filter(s=>s.scope==='turn'),now)};
}

import {expect,test} from 'vitest';import {associationRuns} from '../../src/shared/sessions.js';import {createRunState} from '../../src/domain/reducer.js';import {clock,event} from '../helpers.js';
const now=Date.now();
function reporter(id:string,age=0){const s=createRunState(event({type:'run.started',title:id,scope:'task'},{run:{runId:id,generation:1},occurredAt:now-age,receivedAt:now-age}),clock(now-age)).snapshot;s.lastWorkAt=now-age;return s;}
function native(id:string,age=0){const s=reporter(id,age);s.scope='turn';s.nativeSession={id:'session-'+id,turnId:'turn-'+id,project:'项目',name:id};s.nativeActivity={lastEventAt:now-age,inFlight:false,hasWork:true};return s;}
test('association uses current activity and excludes old unclosed, paused and ended reporter tasks',()=>{
 const live=reporter('live'),old=reporter('old',180001),paused=reporter('paused'),done=reporter('done'),n=native('live');paused.status='paused';done.status='reported_done';
 expect(associationRuns([live,old,paused,done,n],now).targets.map(s=>s.title)).toEqual(['live']);expect(associationRuns([live,old,paused,done,n],now).natives).toEqual([n]);expect(associationRuns([live],now+180001).targets).toEqual([]);
});
test('latest ended turn hides an earlier active turn and linked reporter, while genuinely in-flight waiting work remains available',()=>{
 const n=native('one',600000);n.nativeActivity!.inFlight=true;const r=reporter('task',600000);r.linkedNativeRun=n.run;r.status='waiting';
 expect(associationRuns([r,n],now).targets).toHaveLength(1);const ended={...n,run:{runId:'new-ended',generation:2},status:'paused' as const,nativeActivity:{lastEventAt:now,inFlight:false,hasWork:true}};
 expect(associationRuns([r,n,ended],now).targets).toEqual([]);expect(associationRuns([r,n,ended],now).natives).toEqual([]);
});

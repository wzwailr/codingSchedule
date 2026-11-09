import {expect,test} from 'vitest';
import {createRunState,reduceRun} from '../../src/domain/reducer.js';
import {refreshEtaInquiry} from '../../src/domain/eta-inquiry.js';
import {clock,event,NOW} from '../helpers.js';
test('task estimate freezes on waits and remains available on overdue or clock discontinuity',()=>{
 const initial=createRunState(event({type:'run.started',scope:'task',title:'test'}),clock());refreshEtaInquiry(initial,NOW);
 const q=initial.etaInquiry!.question!;
 const answer=reduceRun(initial,event({type:'eta.answered',requestId:q.requestId,planRevision:0,range:{minSec:10,maxSec:20},reason:'test'}),clock());
 expect(answer.snapshot.lastWorkAt).toBe(NOW);
 expect(reduceRun(answer,event({type:'source.heartbeat'}),clock(NOW+21000,21000)).snapshot.eta.reason).toBe('overdue');
 expect(reduceRun(answer,event({type:'source.heartbeat'}),clock(NOW+1000,1000,'wake')).snapshot.eta.range).toEqual({minSec:10,maxSec:20});
 const waiting=reduceRun(answer,event({type:'run.status',status:'waiting'}),clock(NOW+5000,5000));
 expect(reduceRun(waiting,event({type:'source.heartbeat'}),clock(NOW+65000,65000)).snapshot.eta.range).toEqual({minSec:5,maxSec:15});
});

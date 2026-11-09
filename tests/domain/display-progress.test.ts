import {expect,test} from 'vitest';
import {createRunState,reduceRun} from '../../src/domain/reducer.js';import {displayedProgress} from '../../src/domain/display-progress.js';import {refreshEtaInquiry} from '../../src/domain/eta-inquiry.js';import {clock,event,NOW,plan,step} from '../helpers.js';
function estimated(){let s=createRunState(event({type:'run.started',title:'work',scope:'task'}),clock());s=reduceRun(s,event({type:'plan.replaced',plan:plan([step('done','completed'),step('work','running')])}),clock());refreshEtaInquiry(s,NOW);return reduceRun(s,event({type:'eta.answered',requestId:s.etaInquiry!.question!.requestId,planRevision:1,range:{minSec:60,maxSec:120},reason:'remaining'}),clock());}
test('visible progress uses both ETA bounds while real progress remains unchanged, caps at99 and freezes waits',()=>{
 const s=estimated();expect(s.snapshot.progress.value).toBe(50);expect(displayedProgress(s.snapshot,NOW+30000)).toBe(68);expect(displayedProgress(s.snapshot,NOW+120000)).toBe(99);
 const waited=reduceRun(s,event({type:'run.status',status:'waiting'}),clock(NOW+30000,30000));expect(displayedProgress(waited.snapshot,NOW+120000)).toBe(68);expect(waited.snapshot.eta.range).toEqual({minSec:30,maxSec:90});expect(waited.snapshot.progress.value).toBe(50);
 const resumed=reduceRun(waited,event({type:'run.status',status:'active'}),clock(NOW+130000,130000));expect(displayedProgress(resumed.snapshot,NOW+130000)).toBe(68);expect(displayedProgress(resumed.snapshot,NOW+140000)).toBe(75);
});
test('null ETA and partial reports preserve the display; valid replacement reanchors without a backwards jump',()=>{
 let s=estimated();s=reduceRun(s,event({type:'source.heartbeat'}),clock(NOW+30000,30000));refreshEtaInquiry(s,NOW+30000);
 s=reduceRun(s,event({type:'eta.answered',...s.etaInquiry!.update!,range:null,reason:'no revision'}),clock(NOW+30000,30000));expect(displayedProgress(s.snapshot,NOW+40000)).toBe(75);
 s=reduceRun(s,event({type:'eta.answered',...s.etaInquiry!.update!,range:{minSec:120,maxSec:180},reason:'more work'}),clock(NOW+40000,40000));expect(displayedProgress(s.snapshot,NOW+40000)).toBe(75);expect(displayedProgress(s.snapshot,NOW+70000)).toBeGreaterThan(75);
 s=reduceRun(s,event({type:'source.diagnostic',partial:true}),clock(NOW+50000,50000));expect(s.snapshot.progress.value).toBeNull();expect(displayedProgress(s.snapshot,NOW+60000)).not.toBeNull();
});
test('unknown plans remain unknown and an overly wide estimate does not discard work or the last timer',()=>{
 const unknown=createRunState(event({type:'run.started',title:'unknown',scope:'task'}),clock());expect(displayedProgress(unknown.snapshot,NOW+50000)).toBeNull();
 let s=estimated();refreshEtaInquiry(s,NOW);s=reduceRun(s,event({type:'eta.answered',...s.etaInquiry!.update!,range:{minSec:600,maxSec:1800},reason:'wide'}),clock(NOW+1000,1000));expect(s.snapshot.etaWarning).toBe('ETA_RANGE_TOO_WIDE');expect(s.snapshot.eta.range).toEqual({minSec:59,maxSec:119});
});
test('a zero lower ETA bound cannot jump the display halfway forward in one second',()=>{const s=estimated();s.snapshot.displayProgress!.anchor!.range.minSec=0;expect(displayedProgress(s.snapshot,NOW+1000)).toBe(50);});

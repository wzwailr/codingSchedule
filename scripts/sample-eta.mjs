import {launchHarness,key} from './harness.mjs';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {writeFile} from 'node:fs/promises';
const h=await launchHarness(undefined,'eta'),jobs=[];
try{
 for(let sample=0;sample<10;sample++){
  const steps=Array.from({length:4},(_,i)=>({id:String(i),title:`本地定时校验 ${i+1}`,status:i===0?'running':'pending',weight:1,evidence:'declared',estimate:{minSec:1,maxSec:3,version:1}}));
  const started=await h.send('begin',{idempotencyKey:key(),title:`ETA synthetic serial ${sample+1}`,plan:{revision:1,complete:true,schedule:'serial',steps}});if(started.status!==200)throw new Error('ETA begin failed');
  const handle=started.body.handle,predictions=[];
  for(let i=0;i<steps.length;i++){
   const context=await h.send('context',{handle});if(context.status!==200)throw new Error('ETA context failed');predictions.push({at:performance.now(),eta:context.body.snapshot.eta});
   // A real independent Node task with a known serial timer plus assertion.
   await promisify(execFile)(h.runtime,['-e',`setTimeout(()=>{if((${sample}+2)*2!==${(sample+2)*2})process.exit(1)},${1100+sample*10+i*50})`],{windowsHide:true,timeout:10000});
   steps[i].status='completed';const changes=[{type:'step.updated',revision:1,step:steps[i]}];if(steps[i+1]){steps[i+1].status='running';changes.push({type:'step.updated',revision:1,step:steps[i+1]});}
   const update=await h.send('report',{handle,reportId:key(),seq:context.body.nextSeq,changes});if(update.status!==200)throw new Error('ETA step failed');
  }
  const finished=performance.now(),context=await h.send('context',{handle});const result=await h.send('finish',{handle,reportId:key(),seq:context.body.nextSeq,summary:'Four local serial assertions completed'});if(result.status!==200)throw new Error('ETA finish failed');
  jobs.push({sample:sample+1,predictions:predictions.map(p=>({eta:p.eta,actualRemainingActiveSec:(finished-p.at)/1000,within:p.eta.range!==null&&(finished-p.at)/1000>=p.eta.range.minSec&&(finished-p.at)/1000<=p.eta.range.maxSec}))});
 }
 const forecasts=jobs.flatMap(j=>j.predictions),unknown=forecasts.filter(p=>!p.eta.range).length,overdue=forecasts.filter(p=>p.eta.reason==='overdue').length;
 const report={scope:'10 synthetic serial real-time Node jobs; no AI estimates, no waits, no statistical accuracy claim',jobs,summary:{jobs:jobs.length,predictions:forecasts.length,unknownRate:unknown/forecasts.length,overdueRate:overdue/forecasts.length,knownCoverage:forecasts.filter(p=>p.within).length/(forecasts.length-unknown)}};
 await writeFile('.artifacts/eta/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report.summary));
}finally{await h.close();}

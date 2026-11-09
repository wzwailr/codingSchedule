import {join} from 'node:path';import {writeFile,stat} from 'node:fs/promises';import os from 'node:os';import {DatabaseSync} from 'node:sqlite';
import {runReplay,options} from './replay.mjs';import {evaluateMetrics,quantile} from '../src/verification/metrics.ts';
import {resourceSampler} from './resource-sampler.mjs';
const opts=options(process.argv.slice(2)),sampler=resourceSampler();let previous=null;
try{
 const result=await runReplay(opts,async(ids,phase,elapsedSec)=>{
  const now=performance.now(),data=await sampler.measure(ids);
  if(data.requestedCount!==ids.length)throw new Error('Product process disappeared during resource sampling');
  const cpuPercent=previous?Math.max(0,data.cpuMs-previous.cpuMs)/(now-previous.at)/os.cpus().length*100:0;previous={cpuMs:data.cpuMs,at:now};return {elapsedSec,phase,processIds:data.processIds,processCount:data.count,privateBytes:data.privateBytes,workingSetBytes:data.workingSetBytes,cpuPercent};
 },true);
 const verdict=evaluateMetrics(result),report={...verdict,environment:{os:os.release(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,ramBytes:os.totalmem(),node:process.version,executable:opts.exe},summary:{renderSamples:result.latencyMs.length,logSamples:result.logLatencyMs.length,renderP95:quantile(result.latencyMs,.95),logP95:quantile(result.logLatencyMs,.95),privateMax:Math.max(...result.samples.map(s=>s.privateBytes)),workingSetMax:Math.max(...result.samples.map(s=>s.workingSetBytes)),coldStartMs:result.coldStartMs,acknowledgements:result.acknowledgements},dataDir:result.dataDir,driver:result.driver};
 const dbPath=join(result.dataDir,'schedule.db'),db=new DatabaseSync(dbPath,{readOnly:true});let effectiveBytes;
 try{effectiveBytes=(Number(db.prepare('PRAGMA page_count').get().page_count)-Number(db.prepare('PRAGMA freelist_count').get().freelist_count))*Number(db.prepare('PRAGMA page_size').get().page_size);}finally{db.close();}
 const storage={effectiveBytes,physicalBytes:(await stat(dbPath)).size,walBytes:await stat(dbPath+'-wal').then(s=>s.size,()=>0),budgetBytes:100*1048576};
 report.checks.push({name:'databaseEffectiveBytes',value:effectiveBytes,limit:storage.budgetBytes,pass:effectiveBytes<=storage.budgetBytes});report.ok=report.checks.every(c=>c.pass);report.storage=storage;
 await writeFile(join(result.dataDir,'storage.json'),JSON.stringify(storage,null,2));await writeFile(join(result.dataDir,'verdict.json'),JSON.stringify(report,null,2));await writeFile(join(result.dataDir,'status.json'),JSON.stringify({status:report.ok?'passed':'failed',at:new Date().toISOString(),acknowledgements:result.acknowledgements,crashes:result.crashes,failedChecks:report.checks.filter(c=>!c.pass).map(c=>c.name)}));console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;
}catch(error){console.error(error.message);process.exitCode=1;}finally{sampler.close();}

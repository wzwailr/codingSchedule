import {launchHarness,sleep} from './harness.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve,join} from 'node:path';
import {writeFile} from 'node:fs/promises';

// Record actual defaults and retain each run. The old GPU/heap command-line
// comparison no longer describes the defaults and remains historical evidence.
const executable=process.argv[2]?resolve(process.argv[2]):undefined;
const h=await launchHarness(executable,'profile'),rows=[];
try{
  for(const delayMs of [5000,20000]){
    await sleep(delayMs);
    const {metrics,mainHeap}=await h.app.evaluate(({app})=>({
      metrics:app.getAppMetrics().map(p=>({pid:p.pid,type:p.type,name:p.name})),mainHeap:process.memoryUsage(),
    }));
    const ids=await h.pids();
    const {stdout}=await promisify(execFile)('powershell.exe',[
      '-NoProfile','-NonInteractive','-File',resolve('scripts/measure-process.ps1'),'-Details','-ProcessIds',ids.join(','),
    ],{windowsHide:true});
    const data=JSON.parse(stdout);if(data.count!==ids.length)throw new Error('Product process disappeared');
    rows.push({mainHeap,...data,processes:data.processes.map(p=>({...p,role:metrics.find(m=>m.pid===p.pid)??{type:'standalone MCP bridge'}}))});
  }
  const result={scope:'idle role diagnostic, not load/endurance acceptance; Browser memory includes collector thread',dataDir:h.dir,rows};
  await writeFile(join(h.dir,'profile.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await h.close();}

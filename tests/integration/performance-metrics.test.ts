import {expect,test} from 'vitest';import {evaluateMetrics} from '../../src/verification/metrics.js';
function standard(){return {mcpInstances:3,durationSec:300,idleSec:300,coldStartMs:500,activeStartSec:0,idleStartSec:300,runs:10,activeRuns:10,rate:20,requestedDurationSec:300,acknowledgedEvents:6000,latencyMs:[10],logLatencyMs:[20],samples:[...Array.from({length:61},(_,i)=>({elapsedSec:i*5,privateBytes:200*1048576,workingSetBytes:250*1048576,cpuPercent:.1,phase:'active' as const})),...Array.from({length:61},(_,i)=>({elapsedSec:300+i*5,privateBytes:200*1048576,workingSetBytes:250*1048576,cpuPercent:.1,phase:'idle' as const}))],endurance:false,crashes:0};}
test('performance result fails exceeded thresholds and refuses incomplete endurance or empty latency samples',()=>{
 const input={...standard(),latencyMs:[100,500,1100],logLatencyMs:[3001],samples:standard().samples.map(s=>({...s,privateBytes:221*1048576,cpuPercent:3.1}))};
 const bad=evaluateMetrics(input);expect(bad.ok).toBe(false);expect(bad.checks.filter(c=>!c.pass).map(c=>c.name)).toEqual(expect.arrayContaining(['renderP95','logP95','privateBytes','activeCpu','idleCpu']));
 const good=evaluateMetrics({...input,latencyMs:[10],logLatencyMs:[20],samples:input.samples.map(s=>({...s,privateBytes:200*1048576,cpuPercent:.1}))});expect(good.ok).toBe(true);
 expect(evaluateMetrics({...input,latencyMs:[],endurance:true}).checks.find(c=>c.name==='enduranceDuration')?.pass).toBe(false);
});
test('low workload, missing active runs, slow realized traffic and sparse or gapped resource samples cannot pass',()=>{
 const input=standard();expect(evaluateMetrics(input).ok).toBe(true);
 for(const changes of [{coldStartMs:3001},{runs:1,activeRuns:1,rate:1,acknowledgedEvents:1},{activeRuns:9},{acknowledgedEvents:5999},{samples:[input.samples[0]!,input.samples.at(-1)!]},{samples:input.samples.filter(s=>s.elapsedSec<100||s.elapsedSec>150)}])expect(evaluateMetrics({...input,...changes}).ok).toBe(false);
});
test('eight-hour endurance accepts the approved 2 eps workload while standard still requires 20 eps',()=>{
 const baseline=standard(),endurance={...baseline,endurance:true,rate:2,durationSec:28800,requestedDurationSec:28800,idleStartSec:28800,acknowledgedEvents:57600,samples:[...Array.from({length:5761},(_,i)=>({...baseline.samples[0]!,elapsedSec:i*5})),...baseline.samples.filter(s=>s.phase==='idle').map(s=>({...s,elapsedSec:s.elapsedSec+28500}))]};
 expect(evaluateMetrics(endurance).ok).toBe(true);
 expect(evaluateMetrics({...endurance,rate:1}).checks.find(c=>c.name==='workloadRate')?.pass).toBe(false);
 expect(evaluateMetrics({...baseline,rate:2}).checks.find(c=>c.name==='workloadRate')?.pass).toBe(false);
});
test('multi-client acceptance requires three MCP clients and no unplanned collector restart',()=>{
 expect(evaluateMetrics({...standard(),mcpInstances:3}).ok).toBe(true);
 expect(evaluateMetrics({...standard(),mcpInstances:2}).checks.find(c=>c.name==='mcpInstances')?.pass).toBe(false);
 expect(evaluateMetrics({...standard(),mcpInstances:3,collectorRestarts:1}).checks.find(c=>c.name==='collectorRestarts')?.pass).toBe(false);
});

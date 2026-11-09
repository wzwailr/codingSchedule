type Sample={elapsedSec:number;privateBytes:number;workingSetBytes:number;cpuPercent:number;phase:'active'|'idle'};
type Input={durationSec:number;idleSec:number;coldStartMs:number;activeStartSec:number;idleStartSec:number;runs:number;activeRuns:number;rate:number;requestedDurationSec:number;acknowledgedEvents:number;latencyMs:number[];logLatencyMs:number[];samples:Sample[];endurance:boolean;crashes:number;collectorRestarts?:number;mcpInstances?:number};
export function quantile(values:number[],fraction:number):number|null{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.max(0,Math.ceil(sorted.length*fraction)-1)]!;}
export function evaluateMetrics(input:Input):{ok:boolean;checks:Array<{name:string;value:number|null;limit:number;pass:boolean}>}{
 const checks:Array<{name:string;value:number|null;limit:number;pass:boolean}>=[];
 const atMost=(name:string,value:number|null,limit:number)=>checks.push({name,value,limit,pass:value!==null&&Number.isFinite(value)&&value<=limit});
 const atLeast=(name:string,value:number,limit:number)=>checks.push({name,value,limit,pass:Number.isFinite(value)&&value>=limit});
 const average=(values:number[])=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
 atLeast('workloadRuns',input.runs,10);atLeast('activeRuns',input.activeRuns,input.runs);atLeast('workloadRate',input.rate,input.endurance?2:20);
 atLeast('mcpInstances',input.mcpInstances??1,3);
 atLeast('acknowledgedEvents',input.acknowledgedEvents,Math.floor(input.rate*input.requestedDurationSec));
 const coverage=(phase:Sample['phase'],start:number,duration:number)=>{
  const times=input.samples.filter(s=>s.phase===phase).map(s=>s.elapsedSec);
  atLeast(phase+'SampleCount',times.length,Math.max(2,Math.floor(duration/5)*.8));
  atLeast(phase+'SampleSpan',times.length>1?times.at(-1)!-times[0]!:0,Math.max(0,duration-15));
  atMost(phase+'SampleGap',times.length>1?Math.max(...times.slice(1).map((t,i)=>t-times[i]!)):null,15);
  atMost(phase+'StartGap',times.length?Math.abs(times[0]!-start):null,15);
  atMost(phase+'EndGap',times.length?Math.abs(start+duration-times.at(-1)!):null,15);
  atLeast(phase+'MonotonicSamples',times.length>1&&times.every((t,i)=>Number.isFinite(t)&&(i===0||t>times[i-1]!))?1:0,1);
 };
 coverage('active',input.activeStartSec,input.durationSec);coverage('idle',input.idleStartSec,input.idleSec);
 atMost('renderP95',quantile(input.latencyMs,.95),1000);atMost('logP95',quantile(input.logLatencyMs,.95),3000);
 atMost('coldStartMs',input.coldStartMs,3000);
 atMost('privateBytes',input.samples.length?Math.max(...input.samples.map(s=>s.privateBytes)):null,220*1048576);
 atMost('activeCpu',average(input.samples.filter(s=>s.phase==='active').map(s=>s.cpuPercent)),3);
 atMost('idleCpu',average(input.samples.filter(s=>s.phase==='idle').map(s=>s.cpuPercent)),1);
 atLeast('activeDuration',input.durationSec,Math.max(300,input.requestedDurationSec));atLeast('requestedDuration',input.requestedDurationSec,300);atLeast('idleDuration',input.idleSec,300);atMost('crashes',input.crashes,0);
 atMost('collectorRestarts',input.collectorRestarts??0,0);
 if(input.endurance){
  atLeast('enduranceDuration',input.durationSec,8*3600);
  const second=quantile(input.samples.filter(s=>s.phase==='active'&&s.elapsedSec>=input.activeStartSec+3600&&s.elapsedSec<input.activeStartSec+7200).map(s=>s.privateBytes),.5);
  const last=quantile(input.samples.filter(s=>s.phase==='active'&&s.elapsedSec>=input.activeStartSec+input.durationSec-3600).map(s=>s.privateBytes),.5);
  atMost('enduranceGrowth',second===null||last===null?null:last-second,20*1048576);
 }
 return {ok:checks.every(c=>c.pass),checks};
}

import {resolve,join} from 'node:path';import {readFile,writeFile,appendFile} from 'node:fs/promises';import {performance} from 'node:perf_hooks';
import {DatabaseSync} from 'node:sqlite';import {Client} from '@modelcontextprotocol/client';import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {pathToFileURL} from 'node:url';import {launchHarness,key,sleep} from './harness.mjs';
import {createServer} from 'node:http';
async function commitWithoutAcknowledgement(h,body){
 const original=await readFile(h.endpointPath,'utf8'),endpoint=JSON.parse(original);let withheld=false;
 const proxy=createServer(async(req,res)=>{
  try{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const upstream=await fetch(`http://127.0.0.1:${endpoint.port}/v1/report`,{method:'POST',headers:{'Content-Type':'application/json','X-Connector-Id':String(req.headers['x-connector-id']),Authorization:String(req.headers.authorization)},body:Buffer.concat(chunks),signal:AbortSignal.timeout(3000)});
   await upstream.json();withheld=upstream.status===200;res.destroy();
  }catch{res.destroy();}
 });
 try{
  await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(0,'127.0.0.1',resolve);});
  const address=proxy.address();if(!address||typeof address==='string')throw new Error('Lost ACK proxy unavailable');
  // Only this harness owns the temporary endpoint file. The persistent MCP
  // process reads it for this call; no response bytes reach the MCP bridge.
  await writeFile(h.endpointPath,JSON.stringify({...endpoint,port:address.port}));
  const reply=await h.client.callTool({name:'progress_report',arguments:body});
  if(!withheld||!reply.isError)throw new Error('Lost ACK fault was not observed by MCP client');
  return true;
 }finally{
  await writeFile(h.endpointPath,original);
  proxy.closeAllConnections();if(proxy.listening)await new Promise(resolve=>proxy.close(resolve));
 }
}
export function options(args){const result={runs:10,rate:20,mcpInstances:3,duration:300,idle:300,endurance:false,exe:resolve('release/win-unpacked/codingSchedule.exe')};for(let i=0;i<args.length;i++){const name=args[i].replace(/^--/,'');if(name==='endurance')result.endurance=true;else if(name==='mcp-instances')result.mcpInstances=Number(args[++i]);else if(name==='exe')result.exe=resolve(args[++i]);else if(['runs','rate','duration','idle'].includes(name))result[name]=Number(args[++i]);else throw new Error('Unknown benchmark option');}for(const n of ['runs','rate','duration','idle'])if(!Number.isFinite(result[n])||result[n]<(n==='idle'?0:1)||result[n]>(n==='runs'?20:n==='rate'?100:86400))throw new Error('Invalid benchmark option');if(!Number.isInteger(result.mcpInstances)||result.mcpInstances<1||result.mcpInstances>8)throw new Error('Invalid MCP instance count');return result;}
export async function runReplay(opts,onSample=async()=>{},withIdle=false){
 const h=await launchHarness(opts.exe,withIdle?'bench':'replay',[],{mcpInstances:opts.mcpInstances??3}),latencyMs=[],logLatencyMs=[],sent=new Map(),samples=[],start=performance.now();let acknowledgements=0,acknowledgedEvents=0,controlEvents=0,duplicates=0,staleRejected=0,crashes=0,sampling=false,phase='active',samplingError=null;
 await writeFile(join(h.dir,'status.json'),JSON.stringify({status:'running',phase:'setup',startedAt:new Date().toISOString(),mcpInstances:h.mcpInstances,mcpMode:h.mcpMode}));
 if(process.env.SCHEDULE_BENCH_STATE){const state=JSON.parse(await readFile(process.env.SCHEDULE_BENCH_STATE,'utf8'));await writeFile(process.env.SCHEDULE_BENCH_STATE,JSON.stringify({...state,status:'running',dataDir:h.dir,driverPid:process.pid,processIds:await h.pids(),mcpInstances:h.mcpInstances,mcpMode:h.mcpMode,progressFile:join(h.dir,'status.json'),verdictFile:join(h.dir,'verdict.json')}));}
 const errors=[];h.page.on('pageerror',e=>errors.push(e.message));h.app.process().on('exit',()=>{if(phase!=='closed')crashes++;});
 // Keep bounded resource verification away from the user's lower-right
 // widget. Its visible expanded workload and rendering receipt stay unchanged.
 if(withIdle)await h.app.evaluate(({BrowserWindow,screen})=>{const w=BrowserWindow.getAllWindows()[0],a=screen.getPrimaryDisplay().workArea,b=w.getBounds();w.setTitle('codingSchedule · 标准资源测试');w.setBounds({...b,x:a.x+16,y:a.y+a.height-b.height-16});});
 const sample=async()=>{if(sampling)return;sampling=true;try{const value=await onSample(await h.pids(),phase,(performance.now()-start)/1000);if(value){samples.push(value);await appendFile(join(h.dir,'resources.jsonl'),JSON.stringify(value)+'\n');}}catch(error){samplingError=error; }finally{sampling=false;}};
 await h.page.exposeFunction('recordRendered',markers=>{for(const marker of markers){const entry=sent.get(marker);if(entry){const values=entry.kind==='log'?logLatencyMs:latencyMs;values.push(performance.now()-entry.at);sent.delete(marker);}}});
 await h.page.evaluate(()=>{window.schedule.subscribeSnapshots(message=>{if(message.type!=='snapshots')return;const markers=message.snapshots.flatMap(s=>[s.activity,...(s.plan?.steps||[]).map(step=>step.title)]).filter(s=>s?.startsWith('bench:'));requestAnimationFrame(()=>window.recordRendered(markers));});});
 const timer=setInterval(()=>{void sample();},5000);let durationSec,activeStartSec,idleStartSec=0,idleSec=0;
 try{
  // Checked-in scenario manifest is part of this driver, not a compatibility claim.
  const scenarios=(await readFile('tests/fixtures/replay/scenarios.jsonl','utf8')).trim().split('\n').map(s=>JSON.parse(s).scenario);if(scenarios.length!==5)throw new Error('Scenario manifest mismatch');
  const handles=[];for(let i=0;i<opts.runs;i++){const result=await h.send('begin',{idempotencyKey:key(),title:`Replay ${i+1}`,plan:{revision:1,complete:true,schedule:'serial',steps:[{id:'a',title:'串行步骤',status:'running',weight:1,estimate:{minSec:60,maxSec:120,version:1},evidence:'declared'},{id:'b',title:'等待验收',status:'pending',weight:1,evidence:'declared'}]}});if(result.status!==200)throw new Error('Begin failed');handles.push({handle:result.body.handle,seq:2});}
  await h.page.locator('#compact').hover();await h.page.waitForSelector('#details:not([hidden])');await h.page.locator('#pin').click();await sample();
  const waitingTarget=handles[0],beforeWait=await h.send('context',{handle:waitingTarget.handle});
  for(const status of ['waiting','active']){const changed=await h.send('report',{handle:waitingTarget.handle,reportId:key(),seq:waitingTarget.seq++,changes:[{type:'run.status',status}]});if(changed.status!==200)throw new Error('Waiting transition failed');controlEvents++;const context=await h.send('context',{handle:waitingTarget.handle});if(context.body.snapshot.status!==status||context.body.snapshot.progress.value!==beforeWait.body.snapshot.progress.value)throw new Error('Waiting round trip changed run or progress');}
  const priming={handle:waitingTarget.handle,reportId:key(),seq:waitingTarget.seq++,changes:[{type:'activity.updated',activity:'回放准备'}]};
  const lostAcknowledgement=await commitWithoutAcknowledgement(h,priming);controlEvents++;
  const duplicate=await h.send('report',priming);if(duplicate.status!==200||!duplicate.body.duplicate)throw new Error('Duplicate replay mismatch');duplicates++;
  if((await h.send('report',{...priming,reportId:key(),seq:priming.seq-1})).status!==409)throw new Error('Out-of-order replay accepted');staleRejected++;
  const reopened=new Client({name:'reopened-context',version:'1'});let reopenedContext;try{await reopened.connect(new StdioClientTransport({command:h.mcpCommand,args:h.mcpArgs,stderr:'pipe'}));const reply=await reopened.callTool({name:'progress_context',arguments:{handle:handles[0].handle}});if(reply.isError)throw new Error('Reopened MCP failed');reopenedContext=JSON.parse(reply.content[0].text);}finally{await reopened.close();}if(!reopenedContext.nextSeq)throw new Error('Reopen lost task context');const scenarioReopen=true;
  const activeStart=performance.now(),requestsPerSec=Math.min(20,opts.rate);activeStartSec=(activeStart-start)/1000;let index=0;
  while(performance.now()-activeStart<opts.duration*1000){
   const target=handles[index%handles.length],marker=`bench:${index}`,body={handle:target.handle,reportId:key(),seq:target.seq,changes:Array.from({length:Math.floor((index+1)*opts.rate/requestsPerSec)-Math.floor(index*opts.rate/requestsPerSec)},()=>({type:'activity.updated',activity:marker}))};
   sent.set(marker,{at:performance.now(),kind:'report'});const result=await h.reportThroughMcp(body,index);if(result.status!==200)throw new Error(`Replay report ${result.status}`);target.seq++;acknowledgements++;acknowledgedEvents+=body.changes.length;
   if(index%60===0){const logMarker=`bench:log:${index}`;sent.set(logMarker,{at:performance.now(),kind:'log'});await h.append({type:'response_item',payload:{type:'function_call',name:'update_plan',call_id:'call-'+index,arguments:JSON.stringify({plan:[{step:logMarker,status:'in_progress'}]})}});}
   index++;await sleep(activeStart+index*1000/requestsPerSec-performance.now());
   if(index%Math.max(1,Math.round(requestsPerSec*30))===0)await writeFile(join(h.dir,'status.json'),JSON.stringify({status:'running',at:new Date().toISOString(),phase,elapsedSec:(performance.now()-activeStart)/1000,acknowledgements,crashes}));
   if(samplingError)throw samplingError;
  }
  durationSec=(performance.now()-activeStart)/1000;await sleep(3200);
  if(sent.size)throw new Error(`Missing rendered updates: ${sent.size}`);
  if(withIdle){phase='idle';const idleStart=performance.now();idleStartSec=(idleStart-start)/1000;while(performance.now()-idleStart<opts.idle*1000){await sleep(Math.min(5000,opts.idle*1000-(performance.now()-idleStart)));if(samplingError)throw samplingError;}idleSec=(performance.now()-idleStart)/1000;await sample();}
  if(errors.length)throw new Error('Renderer failed');
  const db=new DatabaseSync(join(h.dir,'schedule.db'),{readOnly:true});let persistedReportEvents,activeRuns;try{activeRuns=Number(db.prepare("SELECT count(*) n FROM runs WHERE json_extract(state_json,'$.snapshot.scope')='task' AND json_extract(state_json,'$.snapshot.status')='active'").get().n);persistedReportEvents=Number(db.prepare("SELECT count(*) AS n FROM events WHERE event_id LIKE 'report:%'").get().n);}finally{db.close();}if(activeRuns!==opts.runs)throw new Error('Reporter workload is not fully active');if(persistedReportEvents!==acknowledgedEvents+controlEvents)throw new Error('Acknowledged event loss or duplicate persistence');
  const result={scope:'synthetic packaged replay, collector-to-renderer animation-frame receipt; includes network/driver dispatch, not physical display presentation',runs:opts.runs,activeRuns,mcpInstances:h.mcpInstances,mcpMode:h.mcpMode,rate:opts.rate,requestedDurationSec:opts.duration,activeStartSec,idleStartSec,durationSec,idleSec,endurance:opts.endurance,coldStartMs:h.coldStartMs,latencyMs,logLatencyMs,samples,acknowledgements,acknowledgedEvents,persistedReportEvents,duplicates,staleRejected,scenarioReopen,lostAcknowledgement,crashes,collectorRestarts:h.transportEvents.filter(e=>e.kind==='endpoint').length,transportEvents:h.transportEvents,driver:{pid:process.pid,cpu:process.cpuUsage(),memory:process.memoryUsage()},dataDir:h.dir};
  await writeFile(join(h.dir,'raw.json'),JSON.stringify(result));await writeFile(join(h.dir,'status.json'),JSON.stringify({status:'workload_completed',at:new Date().toISOString(),acknowledgements,crashes}));return result;
 }catch(error){const failure={status:'failed',reason:error.message,code:error.code??error.cause?.code??null,attempts:error.attempts??1,at:new Date().toISOString(),phase,elapsedSec:(performance.now()-start)/1000,acknowledgements,duplicates,staleRejected,crashes,transportEvents:h.transportEvents};await writeFile(join(h.dir,'failure.json'),JSON.stringify(failure));await writeFile(join(h.dir,'status.json'),JSON.stringify(failure));throw error;
 }finally{clearInterval(timer);while(sampling)await sleep(20);phase='closed';await h.close();}
}
if(import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{const result=await runReplay(options(process.argv.slice(2)));console.log(JSON.stringify({ok:true,dataDir:result.dataDir,acknowledgements:result.acknowledgements,duplicates:result.duplicates,staleRejected:result.staleRejected}));}catch(error){console.error(error.message);process.exitCode=1;}}

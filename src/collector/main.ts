import { parentPort } from 'node:worker_threads';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore } from '../storage/repository.js';
import { createCredential } from '../bridge/credential.js';
import { startIngest } from '../ingestion/server.js';
import { createAdapter } from '../adapters/registry.js';
import { startCollection } from './service.js';
import {configuredSources} from './sources.js';
async function main(){
const port=parentPort;
if(!port)throw new Error('Collector requires a worker message port');
const dir=process.argv[2]!;const continuityId=randomUUID();
const clock=()=>({wallMs:Date.now(),monoMs:performance.now(),continuityId});
await mkdir(dir,{recursive:true});
const store=await openStore(join(dir,'schedule.db'),clock);
for(const provider of ['codex','claude','generic'] as const)await createCredential(dir,provider+'-reporter',provider,'reporter');
for(const provider of ['codex','claude'] as const)await createCredential(dir,provider+'-hook',provider,'hook');
const publish=async()=>{port.postMessage({version:1,type:'snapshots',snapshots:await store.listSnapshots()});};
let lastProblem=0;
const health=(message:string)=>{lastProblem=Date.now();port.postMessage({version:1,type:'health',status:'degraded',message});};
const server=await startIngest(store,{userDataDir:dir,clock,onCommit:()=>{void publish();},onError:health});
let settings:unknown;
try{settings=JSON.parse(await readFile(join(dir,'settings.json'),'utf8'));}catch{/* Ordinary launch detects known roots; isolated tests remain opt-in. */}
const collection=await startCollection(store,configuredSources(settings,process.argv.includes('--auto-detect')).filter(s=>s.enabled).map(s=>createAdapter(s.provider,s.root,{optionalRoot:s.automatic===true})),m=>port.postMessage(m),{clock,onError:health});
const retention=setInterval(()=>{void store.maintenance().then(r=>{if(r.pressure)health('本地数据达到容量上限，请处理记录');}).catch(()=>health('本地记录维护异常'));},60000);
await publish();if(!lastProblem)port.postMessage({version:1,type:'health',status:'ok',message:'采集已连接'});
const heartbeat=setInterval(()=>{void store.tick().then(()=>{port.postMessage({version:1,type:'health',status:Date.now()-lastProblem>60000?'ok':'degraded',message:Date.now()-lastProblem>60000?'采集已连接':'部分来源或本地记录异常，正在恢复'});return publish();}).catch(()=>health('本地记录异常'));},10000);
let closing=false;
port.on('message',async message=>{
  if(message?.type==='stop'&&!closing){closing=true;clearInterval(heartbeat);clearInterval(retention);await collection.stop();await server.close();await store.close();process.exit(0);}
  if(message?.type==='command'&&!closing){
    try{
      let result:unknown;
      if(message.operation==='sources')result=await store.nativeSources();
      else if(message.operation==='verify')await store.verify(message.body.run);
      else if(message.operation==='link'||message.operation==='unlink'){
        const native=(await store.nativeSources()).find(s=>s.run.runId===message.body.nativeRun.runId&&s.run.generation===message.body.nativeRun.generation);
        if(!native)throw new Error('Source unavailable');
        await store.linkNative(message.body.run,{provider:native.provider,nativeSessionId:native.nativeSessionId},[native.turnId],message.operation==='unlink');
      }else throw new Error('Unknown operation');
      await publish();port.postMessage({type:'reply',id:message.id,result});
    }catch{port.postMessage({type:'reply',id:message.id,error:'操作未完成：任务状态已改变，或缺少完整回放记录'});}
  }
});
}
main().catch(()=>{console.error('Collector startup failed');process.exit(1);});

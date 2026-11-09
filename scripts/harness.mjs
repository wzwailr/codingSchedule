import {v8MemoryArgs} from '../src/shared/runtime-memory.ts';
import {_electron} from '@playwright/test';import {mkdir,mkdtemp,readFile,writeFile,appendFile,access} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';import {createHash,randomBytes} from 'node:crypto';import {performance} from 'node:perf_hooks';
import {Client} from '@modelcontextprotocol/client';import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {createAcceptanceRequester} from '../src/verification/request.ts';
export const sleep=ms=>new Promise(r=>setTimeout(r,Math.max(0,ms)));
export function key(){const b=randomBytes(16);b.writeUIntBE(Date.now(),0,6);b[6]=(b[6]&15)|112;b[8]=(b[8]&63)|128;const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
export async function launchHarness(executable=resolve('release/win-unpacked/codingSchedule.exe'),prefix='run',extraArgs=[],options={}){
 const mcpInstances=options.mcpInstances??1;if(!Number.isInteger(mcpInstances)||mcpInstances<1||mcpInstances>8)throw new Error('Invalid MCP instance count');executable=resolve(executable);
 const root=resolve('.artifacts',prefix);await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root,'中文 测试-')),logs=join(dir,'logs');await mkdir(logs);await writeFile(join(logs,'native.jsonl'),[JSON.stringify({type:'session_meta',payload:{id:'bench-native'}}),JSON.stringify({type:'turn_context',payload:{turn_id:'bench-turn'}})].join('\n')+'\n');
 await writeFile(join(dir,'settings.json'),JSON.stringify({sources:[{provider:'codex',root:logs,enabled:true}]}));
 const started=performance.now(),runtime=executable,bridge=join(dirname(executable),'resources/bridge/main.cjs'),relay=join(dirname(executable),'resources/bridge/mcp-relay.exe');
 const app=await _electron.launch({executablePath:executable,args:['--data-dir',dir,...extraArgs],env:{...process.env,PATH:join(process.env.SystemRoot||'C:\\Windows','System32')},timeout:20000});
 const clients=[],transports=[];try{
  const page=await app.firstWindow();await page.waitForSelector('#compact');const coldStartMs=performance.now()-started;
  const credentialPath=join(dir,'connectors',createHash('sha256').update('codex-reporter').digest('hex')+'.json'),endpointPath=join(dir,'endpoint.json');
  let credential,endpoint;for(let i=0;i<150;i++){try{credential=JSON.parse(await readFile(credentialPath,'utf8'));endpoint=JSON.parse(await readFile(endpointPath,'utf8'));break;}catch{await sleep(100);}}
  if(!credential||!endpoint)throw new Error('Collector not ready');
  let native=false;try{await access(relay);native=true;}catch{/* Historical candidates retain the isolated Node bridge. */}
  const mcpCommand=native?relay:runtime,mcpArgs=[...(native?[]:[...v8MemoryArgs,bridge,'--mcp']),'--connector','codex-reporter','--credential',credentialPath,'--endpoint',endpointPath];let tools;
  for(let i=0;i<mcpInstances;i++){
   const client=new Client({name:'candidate-acceptance-driver-'+i,version:'1'});clients.push(client);
   const transport=new StdioClientTransport({command:mcpCommand,args:mcpArgs,env:{SystemRoot:process.env.SystemRoot||'C:\\Windows',PATH:dirname(runtime),...(!native?{ELECTRON_RUN_AS_NODE:'1'}:{})},stderr:'pipe'});transports.push(transport);
   await client.connect(transport);const listed=await client.listTools();tools=listed.tools.map(t=>t.name);if(tools.length!==4)throw new Error('Incomplete MCP catalog');
  }
  const transportEvents=[],requester=createAcceptanceRequester({connectorId:credential.connectorId,credentialPath,endpointPath},{onRecovery:event=>transportEvents.push({...event,at:new Date().toISOString()})});
  const send=(operation,body)=>requester.send(operation,body);
  const pids=async()=>{await requester.observeEndpoint();const ids=await app.evaluate(({app})=>app.getAppMetrics().map(p=>p.pid));for(const transport of transports){if(!transport.pid)throw new Error('MCP process missing');ids.push(transport.pid);}return [...new Set(ids)];};
  const reportThroughMcp=async(body,index)=>{
   // Stable reportId/seq and unchanged arguments make transport retries idempotent.
   for(let attempt=1,rateAttempts=0;;){
    const reply=await clients[index%clients.length].callTool({name:'progress_report',arguments:body});const value=JSON.parse(reply.content[0].text);
    if(!reply.isError)return {status:200,body:value};
    if(value.error==='RATE_LIMIT'&&rateAttempts++<19){await sleep(100);continue;}
    const code=typeof value.code==='string'&&/^[A-Z_0-9]{1,60}$/.test(value.code)?value.code:'MCP_'+String(value.error).replace(/[^A-Z_]/g,'').slice(0,60);
    if(value.error==='UNAVAILABLE'&&['ECONNREFUSED','ECONNRESET','EPIPE','ENOENT','ETIMEDOUT','TIMEOUT'].includes(code)&&attempt<3){transportEvents.push({kind:'transport',operation:'report',attempt,code,at:new Date().toISOString()});await sleep(100*attempt++);continue;}
    const failure=new Error('MCP replay rejected ('+code+')');failure.code=code;failure.attempts=attempt;throw failure;
   }
  };
  return {app,page,client:clients[0],clients,send,reportThroughMcp,pids,dir,logs,coldStartMs,transportEvents,tools,runtime,bridge,mcpCommand,mcpArgs,mcpInstances:transports.length,mcpMode:native?'native':'node',credentialPath,endpointPath,async append(record){await appendFile(join(logs,'native.jsonl'),JSON.stringify(record)+'\n');},async close(){await Promise.allSettled(clients.map(c=>c.close()));await app.close();}};
 }catch(error){await Promise.allSettled(clients.map(c=>c.close()));await app.close();throw error;}
}

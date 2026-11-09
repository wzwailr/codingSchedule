import {expect,test} from 'vitest';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {execFile,spawn} from 'node:child_process';import {promisify} from 'node:util';import {createServer} from 'node:http';import {createInterface} from 'node:readline';
import {Client} from '@modelcontextprotocol/client';import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {openStore} from '../../src/storage/repository.js';import {startIngest} from '../../src/ingestion/server.js';import {createCredential} from '../../src/bridge/credential.js';import {key} from '../helpers.js';
test.skipIf(process.platform!=='win32')('three shipped Win32 stdio facades exercise generated SDK tools and stay below per-bridge headroom',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'native-中文-')),clock=()=>({wallMs:Date.now(),monoMs:performance.now(),continuityId:'native'}),store=await openStore(join(dir,'db'),clock),ingest=await startIngest(store,{userDataDir:dir,clock}),clients:Client[]=[],ids:number[]=[];let firstHandle:unknown;
 try{
  for(let i=0;i<3;i++){
   const connector='test-'+i,credential=await createCredential(dir,connector,i===1?'claude':'codex','reporter'),transport=new StdioClientTransport({command:resolve('dist/bridge/mcp-relay.exe'),args:['--connector',connector,'--credential',credential,'--endpoint',join(dir,'endpoint.json')],stderr:'pipe'}),client=new Client({name:'native-relay-test',version:'1'});clients.push(client);await client.connect(transport);ids.push(transport.pid!);expect((await client.listTools()).tools).toHaveLength(4);
   const result=await client.callTool({name:'progress_begin',arguments:{idempotencyKey:key(Date.now()),title:'中文任务 '+i}});expect(result.isError).not.toBe(true);const handle=JSON.parse((result.content as Array<{text:string}>)[0]!.text).handle;
   if(i===0)firstHandle=handle;else expect((await client.callTool({name:'progress_context',arguments:{handle:firstHandle}})).isError).toBe(true);
   const context=await client.callTool({name:'progress_context',arguments:{handle}});expect(JSON.parse((context.content as Array<{text:string}>)[0]!.text).snapshot.title).toBe('中文任务 '+i);
   const c=JSON.parse((context.content as Array<{text:string}>)[0]!.text);expect((await client.callTool({name:'progress_report',arguments:{handle,reportId:key(Date.now()),seq:c.nextSeq,changes:[{type:'activity.updated',activity:'验证原生MCP四工具'},{type:'eta.answered',requestId:c.etaQuestion.requestId,planRevision:0,range:{minSec:30,maxSec:60},reason:'verify'}]}})).isError).not.toBe(true);expect((await client.callTool({name:'progress_finish',arguments:{handle,reportId:key(Date.now()),seq:c.nextSeq+1,summary:'verified'}})).isError).not.toBe(true);
  }
  const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-File',resolve('scripts/measure-process.ps1'),'-ProcessIds',ids.join(','),'-IncludeChildren'],{windowsHide:true}),memory=JSON.parse(stdout);expect(memory.requestedCount).toBe(3);expect(memory.count).toBe(3);expect(memory.privateBytes/1048576).toBeLessThan(24);
  await mkdir('.artifacts/reliability',{recursive:true});await writeFile('.artifacts/reliability/native-memory.json',JSON.stringify({at:new Date().toISOString(),...memory},null,2));
 }finally{await Promise.allSettled(clients.map(c=>c.close()));await ingest.close();await store.close();await rm(dir,{recursive:true,force:true});}
},20000);
test.skipIf(process.platform!=='win32')('native auth mismatch produces no protocol output or credential disclosure',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'native-auth-'));try{
  const credential=await createCredential(dir,'actual','codex','reporter'),value=JSON.parse(await readFile(credential,'utf8'));
  const result=await promisify(execFile)(resolve('dist/bridge/mcp-relay.exe'),['--connector','wrong','--credential',credential,'--endpoint',join(dir,'endpoint.json')],{windowsHide:true,timeout:8000}).then(r=>r,error=>error as {stdout:string;stderr:string;code:number});
  expect(result.stdout).toBe('');expect(result.stderr).not.toContain(value.token);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test.skipIf(process.platform!=='win32')('one native MCP connection survives offline startup, backend loss and a changed endpoint without replaying writes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'native-recovery-')),clock=()=>({wallMs:Date.now(),monoMs:performance.now(),continuityId:'recovery'}),store=await openStore(join(dir,'db'),clock);
 const credential=await createCredential(dir,'recover','claude','reporter'),transport=new StdioClientTransport({command:resolve('dist/bridge/mcp-relay.exe'),args:['--connector','recover','--credential',credential,'--endpoint',join(dir,'endpoint.json')],stderr:'pipe'}),client=new Client({name:'recovery',version:'1'});
 let ingest:Awaited<ReturnType<typeof startIngest>>|undefined;
 try{
  await client.connect(transport);const pid=transport.pid;expect((await client.listTools()).tools).toHaveLength(4);
  const input={idempotencyKey:key(Date.now()),title:'离线重连 中文'};
  expect((await client.callTool({name:'progress_begin',arguments:input})).isError).toBe(true);
  ingest=await startIngest(store,{userDataDir:dir,clock});
  const begun=await client.callTool({name:'progress_begin',arguments:input});expect(begun.isError).not.toBe(true);const handle=JSON.parse((begun.content as Array<{text:string}>)[0]!.text).handle;
  await ingest.close();ingest=undefined;
  expect((await client.callTool({name:'progress_context',arguments:{handle}})).isError).toBe(true);
  expect((await client.listTools()).tools).toHaveLength(4);
  ingest=await startIngest(store,{userDataDir:dir,clock});
  const recovered=await client.callTool({name:'progress_context',arguments:{handle}});expect(recovered.isError).not.toBe(true);expect(JSON.parse((recovered.content as Array<{text:string}>)[0]!.text).snapshot.title).toBe(input.title);expect(transport.pid).toBe(pid);expect((await store.listSnapshots()).filter(s=>s.scope==='task')).toHaveLength(1);
 }finally{await client.close();await ingest?.close();await store.close();await rm(dir,{recursive:true,force:true});}
},15000);

test.skipIf(process.platform!=='win32')('native framing rejects malformed UTF8, duplicate routing and oversized input, then accepts split Unicode and string IDs',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'native-framing-')),credential=await createCredential(dir,'frames','codex','reporter'),child=spawn(resolve('dist/bridge/mcp-relay.exe'),['--connector','frames','--credential',credential,'--endpoint',join(dir,'endpoint.json')],{windowsHide:true,stdio:['pipe','pipe','pipe']}),lines=createInterface({input:child.stdout}),responses:unknown[]=[],waiting:Array<(value:unknown)=>void>=[];
 lines.on('line',line=>{const value=JSON.parse(line),resolve=waiting.shift();if(resolve)resolve(value);else responses.push(value);});
 const next=()=>responses.length?Promise.resolve(responses.shift()):new Promise<unknown>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Native reply deadline')),3000);waiting.push(v=>{clearTimeout(timeout);resolve(v);});});
 const send=async(value:string|Buffer)=>{child.stdin.write(value);return await next() as {id:unknown;error?:{code:number};result?:unknown};};
 try{
  expect((await send('{broken\n')).error?.code).toBe(-32700);expect((await send(Buffer.from([0xff,10]))).error?.code).toBe(-32700);
  expect((await send('x'.repeat(131073)+'\n')).error?.code).toBe(-32700);
  expect((await send('{"jsonrpc":"2.0","id":1,"method":"ping","method":"tools/call"}\n')).error?.code).toBe(-32600);
  const init=Buffer.from(JSON.stringify({jsonrpc:'2.0',id:'初始化',method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'split-中文',version:'1'}}})+'\n'),split=init.indexOf(Buffer.from('初'))+1;child.stdin.write(init.subarray(0,split));child.stdin.write(init.subarray(split));expect(await next()).toMatchObject({id:'初始化',result:{protocolVersion:'2025-11-25'}});
  expect((await send('{"jsonrpc":"2.0","id":"still-alive","method":"p\\u0069ng"}\n')).result).toEqual({});
  expect((await send(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'progress_begin',arguments:{title:'x'.repeat(65537)}}})+'\n')).error?.code).toBe(-32602);
  expect((await send('{"jsonrpc":"2.0","id":3,"method":"ping"}\n')).result).toEqual({});
 }finally{lines.close();child.stdin.end();await new Promise<void>(resolve=>child.once('exit',()=>resolve()));await rm(dir,{recursive:true,force:true});}
},12000);

test.skipIf(process.platform!=='win32')('a stalled or oversized localhost response is a bounded tool failure and does not close stdio',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'native-timeout-')),credential=await createCredential(dir,'deadline','codex','reporter');let mode='stall';const server=createServer((_req,res)=>{if(mode==='large')res.end(JSON.stringify({text:'x'.repeat(300000)}));});server.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));await writeFile(join(dir,'endpoint.json'),JSON.stringify({port:(server.address() as {port:number}).port}));
 const transport=new StdioClientTransport({command:resolve('dist/bridge/mcp-relay.exe'),args:['--connector','deadline','--credential',credential,'--endpoint',join(dir,'endpoint.json')],stderr:'pipe'}),client=new Client({name:'deadline',version:'1'});
 try{await client.connect(transport);const pid=transport.pid,at=performance.now();expect((await client.callTool({name:'progress_begin',arguments:{idempotencyKey:key(Date.now()),title:'deadline'}})).isError).toBe(true);expect(performance.now()-at).toBeLessThan(5500);mode='large';expect((await client.callTool({name:'progress_context',arguments:{handle:{runId:'test',generation:1,resumeHandle:'x'.repeat(43)}}})).isError).toBe(true);expect((await client.listTools()).tools).toHaveLength(4);expect(transport.pid).toBe(pid);}
 finally{await client.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(dir,{recursive:true,force:true});}
},10000);

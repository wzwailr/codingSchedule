import {expect,test} from 'vitest';import {Client} from '@modelcontextprotocol/client';import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {openStore} from '../../src/storage/repository.js';import {startIngest} from '../../src/ingestion/server.js';import {createCredential} from '../../src/bridge/credential.js';import {key} from '../helpers.js';
for(const provider of ['codex','claude','generic'] as const)test(provider+' MCP collects a product question and answers it without changing work or progress',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'eta-mcp-')),clock=()=>({wallMs:Date.now(),monoMs:performance.now(),continuityId:'mcp'}),store=await openStore(join(dir,'db'),clock),credential=await createCredential(dir,'test',provider,'reporter'),server=await startIngest(store,{userDataDir:dir,clock});
 const transport=new StdioClientTransport({command:process.execPath,args:['dist/bridge/main.cjs','--mcp','--connector','test','--credential',credential,'--endpoint',join(dir,'endpoint.json')],stderr:'pipe'}),client=new Client({name:'eta-verification',version:'1'});
 try{
  await client.connect(transport);
  const call=async(name:string,args:Record<string,unknown>)=>{const result=await client.callTool({name,arguments:args});expect(result.isError).not.toBe(true);return JSON.parse((result.content as Array<{text:string}>)[0]!.text);};
  const {handle}=await call('progress_begin',{idempotencyKey:key(Date.now()),title:'original task'}),context=await call('progress_context',{handle});
  expect(context.etaInstruction).toContain('not a user message');expect(context.etaInstruction).not.toContain(handle.resumeHandle);
  const rejected=await client.callTool({name:'progress_report',arguments:{handle,reportId:key(Date.now()),seq:context.nextSeq,changes:[{type:'plan.replaced',plan:{revision:1,complete:true,schedule:'serial',steps:[{id:'work',title:'work',status:'running',weight:1,evidence:'declared'}]}},{type:'eta.answered',requestId:context.etaQuestion.requestId,planRevision:0,range:{minSec:60,maxSec:120},reason:'old reference after plan replacement'}]}});
  expect(rejected.isError).toBe(true);const rejection=JSON.parse((rejected.content as Array<{text:string}>)[0]!.text);expect(rejection.error).toBe('STALE_ETA_REQUEST');expect(rejection.recovery).toContain('plan.replaced');expect(rejection.recovery).not.toContain(handle.resumeHandle);
  const unchanged=await call('progress_context',{handle});expect(unchanged.nextSeq).toBe(context.nextSeq);expect(unchanged.snapshot.plan).toBeNull();
  const input={handle,reportId:key(Date.now()),seq:context.nextSeq,changes:[{type:'eta.answered',requestId:context.etaQuestion.requestId,planRevision:0,range:{minSec:180,maxSec:360},reason:'remaining implementation'}]};
  expect((await call('progress_report',input)).duplicate).toBe(false);expect((await call('progress_report',input)).duplicate).toBe(true);
  const answered=await call('progress_context',{handle});expect(answered.etaQuestion).toBeUndefined();expect(answered.snapshot.eta.basis).toBe('agent');expect(answered.snapshot.lastWorkAt).toBe(context.snapshot.lastWorkAt);expect(answered.snapshot.progress.value).toBeNull();expect(answered.snapshot.activity).toBeNull();
  expect(answered.etaUpdate).toBeDefined();
  await call('progress_report',{handle,reportId:key(Date.now()),seq:answered.nextSeq,changes:[{type:'eta.answered',requestId:answered.etaUpdate.requestId,planRevision:0,range:{minSec:60,maxSec:90},reason:'necessary revision'}]});
  const revised=await call('progress_context',{handle});expect(revised.snapshot.eta.range).toEqual({minSec:60,maxSec:90});expect(revised.etaQuestion).toBeUndefined();
  await call('progress_report',{handle,reportId:key(Date.now()),seq:revised.nextSeq,changes:[{type:'eta.answered',requestId:revised.etaUpdate.requestId,planRevision:0,range:null,reason:'no new estimate'}]});
  const retained=(await call('progress_context',{handle})).snapshot.eta.range;expect(retained.maxSec).toBeLessThanOrEqual(90);expect(retained.maxSec).toBeGreaterThan(85);expect(retained.maxSec-retained.minSec).toBeCloseTo(30);
 }finally{await client.close();await server.close();await store.close();await rm(dir,{recursive:true,force:true});}
},20000);

import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { expect,test } from 'vitest';
import { openStore } from '../../src/storage/repository.js';
import { startIngest } from '../../src/ingestion/server.js';
import { createCredential } from '../../src/bridge/credential.js';
import { key,plan,step } from '../helpers.js';
import { runCli } from '../../src/bridge/cli.js';
import { Readable } from 'node:stream';
test('official MCP client: begin/report/context/finish, two runs, duplicate retry and MCP -> CLI reconnection',async()=>{
  const d=await mkdtemp(join(tmpdir(),'schedule-mcp-'));
  const clock=()=>({wallMs:Date.now(),monoMs:performance.now(),continuityId:'mcp'}),store=await openStore(join(d,'db'),clock),credentialPath=await createCredential(d,'test','codex','reporter'),server=await startIngest(store,{userDataDir:d,clock});
  const args=['--connector','test','--credential',credentialPath,'--endpoint',join(d,'endpoint.json')];
  const transport=new StdioClientTransport({command:process.execPath,args:['dist/bridge/main.cjs','--mcp',...args],stderr:'pipe'}),client=new Client({name:'integration-test',version:'1.0'});
  try{
    await client.connect(transport);expect((await client.listTools()).tools.map(t=>t.name).sort()).toEqual(['progress_begin','progress_context','progress_finish','progress_report']);
    const call=async(name:string,input:unknown)=>{const r=await client.callTool({name,arguments:input as Record<string,unknown>});expect(r.isError).not.toBe(true);return JSON.parse((r.content as Array<{type:string;text:string}>)[0]!.text);};
    const a=(await call('progress_begin',{idempotencyKey:key(Date.now()),title:'A',plan:plan([step('a')])})).handle;
    const b=(await call('progress_begin',{idempotencyKey:key(Date.now()),title:'B'})).handle;
    const input={handle:a,reportId:key(Date.now()),seq:2,changes:[{type:'step.updated',revision:1,step:step('a','completed')}]};
    expect((await call('progress_report',input)).duplicate).toBe(false);expect((await call('progress_report',input)).duplicate).toBe(true);
    expect((await call('progress_context',{handle:b})).snapshot.progress.value).toBeNull();
    await call('progress_finish',{handle:a,reportId:key(Date.now()),seq:3,summary:'done'});
    expect((await call('progress_context',{handle:a})).snapshot.status).toBe('reported_done');
    const output:string[]=[];expect(await runCli(['context',...args],Readable.from([JSON.stringify({handle:a})]),text=>output.push(text))).toBe(0);
    expect(JSON.parse(output[0]!).nextSeq).toBe(4);
  }finally{await client.close();await server.close();await store.close();await rm(d,{recursive:true,force:true});}
},20000);
test('CLI distinguishes unavailable service and invalid arguments; no model retries',async()=>{
  expect(await runCli(['bad'],Readable.from(['{}']),()=>{})).toBe(2);
  expect(await runCli(['begin','--connector','x','--credential','missing','--endpoint','missing'],Readable.from(['{}']),()=>{})).toBe(3);
});

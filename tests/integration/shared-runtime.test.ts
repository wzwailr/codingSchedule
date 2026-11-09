import {mkdtemp,rm,readFile} from 'node:fs/promises';import {existsSync} from 'node:fs';import {tmpdir} from 'node:os';import {resolve,join} from 'node:path';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {expect,test} from 'vitest';
import {parse as toml} from 'smol-toml';import {Client} from '@modelcontextprotocol/client';import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {previewIntegration} from '../../src/integration/config-patch.js';
const root=resolve(process.env.SCHEDULE_TEST_PACKAGE_DIR||'release/win-unpacked'),exe=join(root,'codingSchedule.exe');
test.skipIf(!existsSync(exe))('shared Electron Node exposes generic MCP without a standalone runtime, and packaged removal reverts clean setup',async()=>{
 const home=await mkdtemp(join(tmpdir(),'共享运行时 测试-')),env={...process.env,HOME:home,USERPROFILE:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude'),PATH:join(process.env.SystemRoot||'C:/Windows','System32'),ELECTRON_RUN_AS_NODE:'1'};
 try{
  expect(await readFile(join(root,'resources/LICENSE'),'utf8')).toBe(await readFile('LICENSE','utf8'));
  expect(existsSync(join(root,'resources/bridge-runtime/node.exe'))).toBe(false);
  const {stdout}=await promisify(execFile)(exe,[join(root,'resources/integration/setup-cli.cjs')],{env,windowsHide:true,timeout:20000});expect(JSON.parse(stdout).applied).toBe(true);
  for(const host of ['codex','generic'] as const){
   const patch=await previewIntegration({host,configPath:join(home,host+'.config'),nodePath:exe,runAsNode:true,bridgePath:join(root,'resources/bridge/main.cjs'),connectorId:'generic-reporter',credentialPath:join(home,'unused.json'),endpointPath:join(home,'unused-endpoint.json')});
   const config=host==='codex'?toml(patch.afterText):JSON.parse(patch.afterText),entry=(config[host==='codex'?'mcp_servers':'mcpServers'] as Record<string,{command:string;args:string[];env:Record<string,string>}>).codingSchedule!;
   const client=new Client({name:'shared-runtime-'+host,version:'1'});
   try{await client.connect(new StdioClientTransport({...entry,env:{SystemRoot:process.env.SystemRoot||'C:/Windows',PATH:env.PATH,...entry.env},stderr:'pipe'}));expect((await client.listTools()).tools).toHaveLength(4);}finally{await client.close();}
  }
  const removed=await promisify(execFile)(exe,[join(root,'resources/integration/remove-cli.cjs'),'--data-dir',join(home,'.coding-schedule')],{env,windowsHide:true,timeout:20000});expect(JSON.parse(removed.stdout).ok).toBe(true);
  expect(Object.keys(JSON.parse(await readFile(join(home,'.coding-schedule/receipts.json'),'utf8')))).toHaveLength(0);
 }finally{await rm(home,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},45000);

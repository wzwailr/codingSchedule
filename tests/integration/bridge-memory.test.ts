import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync} from 'node:fs';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {expect,test} from 'vitest';
import {previewIntegration} from '../../src/integration/config-patch.js';

test.skipIf(process.platform!=='win32'||!existsSync('.artifacts/bridge-runtime/node.exe'))('generated MCP entry starts the official server without consuming the product budget as initial heap slack',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'schedule-bridge-memory-'));
  const entry=(await previewIntegration({host:'generic',configPath:join(dir,'config.json'),nodePath:resolve('.artifacts/bridge-runtime/node.exe'),bridgePath:resolve('dist/bridge/main.cjs'),connectorId:'generic-reporter',credentialPath:join(dir,'unused-credential.json'),endpointPath:join(dir,'unused-endpoint.json')})).ownedAfter;
  if(!('args' in entry))throw new Error('Expected MCP argv entry');
  const transport=new StdioClientTransport({command:entry.command,args:entry.args,stderr:'pipe'});
  const client=new Client({name:'configured-startup-memory',version:'1'});
  try{
    await client.connect(transport);expect((await client.listTools()).tools).toHaveLength(4);
    const called=await client.callTool({name:'progress_context',arguments:{handle:{runId:'isolated-memory-probe',generation:1,resumeHandle:'x'.repeat(43)}}});
    expect(called.isError).toBe(true); // No credential is created for this owned fixture.
    const samples:number[]=[];
    for(let i=0;i<3;i++){
      const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-File',resolve('scripts/measure-process.ps1'),'-ProcessIds',String(transport.pid)],{windowsHide:true});
      const sample=JSON.parse(stdout);expect(sample.count).toBe(1);samples.push(sample.privateBytes);
    }
    // Internal startup headroom target for this one shipped role. The complete
    // app must still pass its separate unchanged 220MiB packaged load gate.
    expect(Math.max(...samples)/1048576).toBeLessThan(45);
  }finally{await client.close();await rm(dir,{recursive:true,force:true});}
},15000);

import {Worker} from 'node:worker_threads';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {expect,test} from 'vitest';
import {sendLocal} from '../../src/bridge/transport.js';
import {createHash} from 'node:crypto';
import {key} from '../helpers.js';

test('collector runs in an isolated JS thread, answers commands and closes its endpoint on stop',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'schedule-thread-'));
  const worker=new Worker(resolve('dist/collector/main.cjs'),{argv:[dir]});
  worker.on('error',()=>{});
  try{
    const ready=await new Promise<{kind:string;status?:string}>(resolve=>{
      worker.on('message',m=>{if(m.type==='health')resolve({kind:'health',status:m.status});});
      worker.once('exit',()=>resolve({kind:'exit'}));
    });
    expect(ready).toEqual({kind:'health',status:'ok'});
    const reply=new Promise<unknown>(resolve=>worker.on('message',m=>{if(m.type==='reply'&&m.id==='sources')resolve(m.result);}));
    worker.postMessage({type:'command',id:'sources',operation:'sources'});
    expect(await reply).toEqual([]);
    const exited=once(worker,'exit');worker.postMessage({type:'stop'});
    expect(await exited).toEqual([0]);
    await expect(readFile(join(dir,'endpoint.json'))).rejects.toMatchObject({code:'ENOENT'});
  }finally{await worker.terminate();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});

test('terminating the collector thread preserves WAL commits and a restarted thread returns the same run context',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'schedule-thread-wal-'));let worker:Worker|undefined;
  async function start(){
    const child=new Worker(resolve('dist/collector/main.cjs'),{argv:[dir]});worker=child;child.on('error',()=>{});
    const ready=await new Promise<boolean>(resolve=>{child.on('message',m=>{if(m.type==='health')resolve(m.status==='ok');});child.once('exit',()=>resolve(false));});
    expect(ready).toBe(true);
  }
  const options={connectorId:'codex-reporter',credentialPath:join(dir,'connectors',createHash('sha256').update('codex-reporter').digest('hex')+'.json'),endpointPath:join(dir,'endpoint.json')};
  try{
    await start();
    const begun=await sendLocal({...options,operation:'begin',body:{idempotencyKey:key(Date.now()),title:'Thread WAL'}},2000);
    expect(begun.status).toBe(200);const handle=(begun.body as {handle:unknown}).handle;
    const body={handle,reportId:key(Date.now()),seq:2,changes:[{type:'activity.updated',activity:'committed before thread termination'}]};
    expect((await sendLocal({...options,operation:'report',body},2000)).status).toBe(200);
    await worker!.terminate();await start();
    expect(await sendLocal({...options,operation:'context',body:{handle}},2000)).toMatchObject({status:200,body:{nextSeq:3,snapshot:{title:'Thread WAL',status:'paused',activity:'committed before thread termination'}}});
    expect(await sendLocal({...options,operation:'report',body},2000)).toMatchObject({status:200,body:{duplicate:true}});
    const exited=once(worker!,'exit');worker!.postMessage({type:'stop'});expect(await exited).toEqual([0]);
  }finally{await worker?.terminate();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});

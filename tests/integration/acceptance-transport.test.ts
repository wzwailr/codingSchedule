import {expect,test} from 'vitest';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createAcceptanceRequester} from '../../src/verification/request.js';
test('transient lost ACK repeats the exact idempotent body; protocol errors do not retry and diagnostics omit secrets',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'acceptance-request-')),received:string[]=[],events:unknown[]=[];let refuse=false;
 const server=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const c of req)chunks.push(c);received.push(Buffer.concat(chunks).toString('utf8'));if(refuse){res.writeHead(409);res.end('{"error":"STALE_SEQUENCE"}');}else if(received.length===1)res.destroy();else res.end('{"accepted":true,"duplicate":true}');});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{
  await writeFile(join(dir,'credential.json'),JSON.stringify({connectorId:'test',token:'private-token-do-not-log'}));await writeFile(join(dir,'endpoint.json'),JSON.stringify({port:(server.address() as {port:number}).port}));
  const requester=createAcceptanceRequester({connectorId:'test',credentialPath:join(dir,'credential.json'),endpointPath:join(dir,'endpoint.json')},{onRecovery:e=>events.push(e),retryDelayMs:1});
  const body={reportId:'stable-report-id',seq:2,handle:{runId:'run',generation:1,resumeHandle:'private-handle-do-not-log'},changes:[{type:'activity.updated',activity:'original work'}]};
  expect((await requester.send('report',body)).body).toMatchObject({accepted:true,duplicate:true});expect(received).toHaveLength(2);expect(received[0]).toBe(received[1]);expect(events).toHaveLength(1);
  expect(JSON.stringify(events)).not.toMatch(/private-token|private-handle/);
  refuse=true;expect((await requester.send('report',body)).status).toBe(409);expect(received).toHaveLength(3);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
test('transport retries are bounded, and an unkeyed write is never automatically repeated',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'acceptance-bounded-'));let count=0;
 const server=createServer((req,res)=>{count++;req.resume();res.destroy();});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{
  await writeFile(join(dir,'credential.json'),JSON.stringify({connectorId:'test',token:'private'}));await writeFile(join(dir,'endpoint.json'),JSON.stringify({port:(server.address() as {port:number}).port}));
  const r=createAcceptanceRequester({connectorId:'test',credentialPath:join(dir,'credential.json'),endpointPath:join(dir,'endpoint.json')},{retryDelayMs:1});
  await expect(r.send('report',{reportId:'key',seq:2,handle:{},changes:[]})).rejects.toMatchObject({name:'AcceptanceTransportError',attempts:3});expect(count).toBe(3);
  count=0;await expect(r.send('report',{changes:[]})).rejects.toMatchObject({attempts:1});expect(count).toBe(1);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});

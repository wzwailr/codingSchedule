import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {expect,test} from 'vitest';
import {openStore} from '../../src/storage/repository.js';import {startIngest} from '../../src/ingestion/server.js';import {createCredential} from '../../src/bridge/credential.js';import {sendLocal} from '../../src/bridge/transport.js';import{NOW,key}from'../helpers.js';
test('40-request burst, 20/sec refill and 429 are per connector; context never refreshes work',async()=>{
 const d=await mkdtemp(join(tmpdir(),'schedule-rate-'));let now=NOW;const clock=()=>({wallMs:now,monoMs:now-NOW,continuityId:'rate'}),store=await openStore(join(d,'db'),clock),a=await createCredential(d,'a','codex','reporter'),b=await createCredential(d,'b','codex','reporter'),server=await startIngest(store,{userDataDir:d,clock});
 const send=(operation:'begin'|'context',body:unknown,id='a',credential=a)=>sendLocal({operation,body,connectorId:id,credentialPath:credential,endpointPath:join(d,'endpoint.json')},1000);
 try{const handle=((await send('begin',{idempotencyKey:key(now),title:'rate'})).body as{handle:unknown}).handle;
 for(let i=0;i<39;i++)expect((await send('context',{handle})).status).toBe(200);
 expect((await send('context',{handle})).status).toBe(429);now+=50;expect((await send('context',{handle})).status).toBe(200);now+=49;expect((await send('context',{handle})).status).toBe(429);now++;expect((await send('context',{handle})).status).toBe(200);
 expect((await send('begin',{idempotencyKey:key(now),title:'independent'},'b',b)).status).toBe(200);expect((await store.listSnapshots()).find(s=>s.title==='rate')?.lastWorkAt).toBe(NOW);
 }finally{await server.close();await store.close();await rm(d,{recursive:true,force:true});}
});

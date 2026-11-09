import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {DatabaseSync} from 'node:sqlite';
import {expect,test} from 'vitest';import {openStore} from '../../src/storage/repository.js';import {startIngest} from '../../src/ingestion/server.js';
import {createCredential} from '../../src/bridge/credential.js';import {sendLocal} from '../../src/bridge/transport.js';import {key} from '../helpers.js';
test('real SQLite write lock produces failed ACK; same report retries exactly once after recovery',async()=>{
  const d=await mkdtemp(join(tmpdir(),'schedule-failure-')),path=join(d,'db'),clock=()=>({wallMs:Date.now(),monoMs:performance.now(),continuityId:'failure'});
  const store=await openStore(path,clock),credentialPath=await createCredential(d,'writer','codex','reporter'),server=await startIngest(store,{userDataDir:d,clock});
  const request=(operation:'begin'|'report',body:unknown)=>sendLocal({operation,body,connectorId:'writer',credentialPath,endpointPath:join(d,'endpoint.json')},2500);
  const lock=new DatabaseSync(path);
  try{
    const begin=await request('begin',{idempotencyKey:key(Date.now()),title:'lock test'}),handle=(begin.body as {handle:unknown}).handle;
    const body={handle,reportId:key(Date.now()),seq:2,changes:[{type:'activity.updated',activity:'testing'}]};
    lock.exec('BEGIN IMMEDIATE');expect((await request('report',body)).status).toBe(503);lock.exec('ROLLBACK');
    expect((await store.listSnapshots())[0]?.activity).toBeNull();expect((await request('report',body)).body).toMatchObject({duplicate:false});expect((await request('report',body)).body).toMatchObject({duplicate:true});
  }finally{if(lock.isTransaction)lock.exec('ROLLBACK');lock.close();await server.close();await store.close();await rm(d,{recursive:true,force:true});}
});
test('100 events/sec for 10sec preserve every ACKed batch, independent connector can progress',async()=>{
  const d=await mkdtemp(join(tmpdir(),'schedule-load-')),clock=()=>({wallMs:Date.now(),monoMs:performance.now(),continuityId:'load'});
  const store=await openStore(join(d,'db'),clock),credentialPath=await createCredential(d,'load','codex','reporter'),other=await createCredential(d,'other','codex','reporter'),server=await startIngest(store,{userDataDir:d,clock});
  const send=(operation:'begin'|'report'|'context',body:unknown,connectorId='load',credential=credentialPath)=>sendLocal({operation,body,connectorId,credentialPath:credential,endpointPath:join(d,'endpoint.json')},2000);
  try{
    const handle=((await send('begin',{idempotencyKey:key(Date.now()),title:'load'})).body as {handle:unknown}).handle;
    const independent=await send('begin',{idempotencyKey:key(Date.now()),title:'independent'},'other',other);expect(independent.status).toBe(200);
    const start=performance.now();let accepted=0;
    for(let batch=0;batch<200;batch++){
      const wait=start+batch*50-performance.now();if(wait>0)await new Promise(r=>setTimeout(r,wait));
      const response=await send('report',{handle,reportId:key(Date.now()),seq:batch+2,changes:Array.from({length:5},(_,i)=>({type:'activity.updated',activity:`event ${batch*5+i}`}))});expect(response.status).toBe(200);accepted+=5;
    }
    expect(accepted).toBe(1000);expect((await send('context',{handle})).body).toMatchObject({nextSeq:202});
    const db=new DatabaseSync(join(d,'db'));try{expect(Number(db.prepare('SELECT count(*) AS n FROM events').get()!.n)).toBe(1002);}finally{db.close();}
    expect((await send('context',{handle:(independent.body as {handle:unknown}).handle},'other',other)).status).toBe(200);
  }finally{await server.close();await store.close();await rm(d,{recursive:true,force:true});}
},18000);

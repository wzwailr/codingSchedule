import {mkdtemp,rm,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {expect,test} from 'vitest';
import {openStore} from '../../src/storage/repository.js';import {createCredential} from '../../src/bridge/credential.js';import {startIngest} from '../../src/ingestion/server.js';import {sendLocal} from '../../src/bridge/transport.js';import {clock,key} from '../helpers.js';
test('unrelated connector files cannot crowd a registered credential out of lookup',async()=>{
 const d=await mkdtemp(join(tmpdir(),'schedule-credential-')),store=await openStore(join(d,'db'),()=>clock());const credentialPath=await createCredential(d,'writer','codex','reporter');
 for(let i=0;i<40;i++)await writeFile(join(d,'connectors',`000-junk-${i}.json`),'{}');
 const server=await startIngest(store,{userDataDir:d,clock:()=>clock()});
 try{expect((await sendLocal({operation:'begin',body:{idempotencyKey:key(),title:'lookup'},connectorId:'writer',credentialPath,endpointPath:join(d,'endpoint.json')})).status).toBe(200);}
 finally{await server.close();await store.close();await rm(d,{recursive:true,force:true});}
});

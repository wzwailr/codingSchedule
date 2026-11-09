import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {expect,test} from 'vitest';
import {openStore} from '../../src/storage/repository.js';
import {startIngest} from '../../src/ingestion/server.js';
import {createCredential} from '../../src/bridge/credential.js';
import {sendLocal} from '../../src/bridge/transport.js';
import {key} from '../helpers.js';

test('a committed report whose HTTP acknowledgement is dropped can be retried without a second event',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'schedule-lost-ack-'));
  const clock=()=>({wallMs:Date.now(),monoMs:performance.now(),continuityId:'lost-ack'});
  const store=await openStore(join(dir,'test.db'),clock);
  const credentialPath=await createCredential(dir,'test','codex','reporter');
  const server=await startIngest(store,{userDataDir:dir,clock});
  const options={connectorId:'test',credentialPath,endpointPath:join(dir,'endpoint.json')};
  let withheld=false;
  const proxy=createServer(async(req,res)=>{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);
    try{
      const response=await fetch(`http://127.0.0.1:${server.port}/v1/report`,{
        method:'POST',headers:{Authorization:String(req.headers.authorization),'X-Connector-Id':'test'},
        body:Buffer.concat(chunks),signal:AbortSignal.timeout(2000),
      });
      // Consume the actual ingestion ACK only inside the proxy. Destroy the
      // client connection before writing status, headers, or any response bytes.
      await response.json();withheld=response.status===200;res.destroy();
    }catch{res.destroy();}
  });
  try{
    const begun=await sendLocal({...options,operation:'begin',body:{idempotencyKey:key(Date.now()),title:'Lost ACK'}},2000);
    expect(begun.status).toBe(200);const handle=(begun.body as {handle:unknown}).handle;
    const body={handle,reportId:key(Date.now()),seq:2,changes:[{type:'activity.updated',activity:'durable despite lost ACK'}]};
    const credential=JSON.parse(await readFile(credentialPath,'utf8'));
    await new Promise<void>(resolve=>proxy.listen(0,'127.0.0.1',resolve));
    const address=proxy.address();if(!address||typeof address==='string')throw new Error('Proxy unavailable');
    await expect(fetch(`http://127.0.0.1:${address.port}/v1/report`,{
      method:'POST',headers:{Authorization:'Bearer '+credential.token},body:JSON.stringify(body),signal:AbortSignal.timeout(3000),
    })).rejects.toThrow();
    expect(withheld).toBe(true);
    const retry=await sendLocal({...options,operation:'report',body},2000);
    expect(retry).toMatchObject({status:200,body:{duplicate:true}});
    const context=await sendLocal({...options,operation:'context',body:{handle}},2000);
    expect(context).toMatchObject({status:200,body:{nextSeq:3,snapshot:{activity:'durable despite lost ACK'}}});
    const db=new DatabaseSync(join(dir,'test.db'),{readOnly:true});
    try{expect(db.prepare("SELECT count(*) n FROM events WHERE event_id LIKE 'report:%'").get()?.n).toBe(1);}finally{db.close();}
  }finally{
    proxy.closeAllConnections();if(proxy.listening)await new Promise<void>(resolve=>proxy.close(()=>resolve()));
    await server.close();await store.close();await rm(dir,{recursive:true,force:true});
  }
});

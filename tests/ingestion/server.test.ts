import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { openStore } from '../../src/storage/repository.js';
import { startIngest } from '../../src/ingestion/server.js';
import { createCredential } from '../../src/bridge/credential.js';
import { sendLocal } from '../../src/bridge/transport.js';
import { key } from '../helpers.js';
import { request } from 'node:http';
test('loopback token API rejects origin, wrong host/token, forged verification and oversized bytes; ACK is durable', async () => {
  const d=await mkdtemp(join(tmpdir(),'schedule-http-'));
  const clock=()=>({wallMs:Date.now(),monoMs:performance.now(),continuityId:'http'});
  const store=await openStore(join(d,'test.db'),clock), credPath=await createCredential(d,'test','codex','reporter');
  const server=await startIngest(store,{userDataDir:d,clock});
  try {
    const endpointPath=join(d,'endpoint.json'), r=await sendLocal({operation:'begin',body:{idempotencyKey:key(Date.now()),title:'HTTP test'},connectorId:'test',endpointPath,credentialPath:credPath},1000);
    expect(r.status).toBe(200); expect((await store.listSnapshots())[0]?.title).toBe('HTTP test');
    const credential=JSON.parse(await readFile(credPath,'utf8'));
    const url=`http://127.0.0.1:${server.port}/v1/report`;
    for (const headers of [{Origin:'https://evil.test'}, {Authorization:'Bearer bad'}]) {
      expect((await fetch(url,{method:'POST',headers:{'Authorization':`Bearer ${credential.token}`,'X-Connector-Id':'test',...headers},body:'{}'})).status).toBe(403);
    }
    const wrongHost=await new Promise<number>((resolve,reject)=>{const req=request(url,{method:'POST',headers:{Host:'evil.test',Authorization:`Bearer ${credential.token}`,'X-Connector-Id':'test'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode!));});req.on('error',reject);req.end('{}');});
    expect(wrongHost).toBe(403);
    const handle=(r.body as {handle:unknown}).handle;
    const binding=await sendLocal({operation:'binding',body:{handle,nativeContext:{sessionId:'exact',turnId:'turn',itemId:'actual-item'}},connectorId:'test',endpointPath,credentialPath:credPath});expect(binding.status).toBe(200);expect(JSON.stringify(binding.body)).not.toContain('resumeHandle');
    const invalidBinding=await sendLocal({operation:'binding',body:{handle,nativeContext:{sessionId:'exact',turnId:'turn'}},connectorId:'test',endpointPath,credentialPath:credPath});expect(invalidBinding.status).toBe(400);
    const forged=await sendLocal({operation:'report',body:{handle,reportId:key(Date.now()),seq:2,changes:[{type:'completion.verified',summary:'x',evidenceRef:'x'}]},connectorId:'test',endpointPath,credentialPath:credPath},1000);
    expect(forged.status).toBe(400);
    expect((await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${credential.token}`,'X-Connector-Id':'test'},body:'汉'.repeat(24000)})).status).toBe(413);
    expect((await fetch(`http://127.0.0.1:${server.port}/arbitrary`,{method:'POST',headers:{Authorization:`Bearer ${credential.token}`,'X-Connector-Id':'test'},body:'{}'})).status).toBe(404);
  } finally {await server.close();await store.close();await rm(d,{recursive:true,force:true});}
});

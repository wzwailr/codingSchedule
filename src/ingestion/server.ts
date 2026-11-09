import { createServer } from 'node:http';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { timingSafeEqual,createHash } from 'node:crypto';
import type { ClockSample, Store, TrustedSource } from '../shared/contracts.js';
import { contextSchema,bindingSchema } from '../shared/schemas.js';
import { ProtocolError } from '../shared/errors.js';
import { atomicJson, readCredential } from '../bridge/credential.js';
import { normalizeReport } from './normalize-report.js';
import { handleHook } from './hook.js';
export type IngestOptions={userDataDir:string;clock:()=>ClockSample;onCommit?:()=>void;onError?:(message:string)=>void};
export async function startIngest(store:Store,options:IngestOptions):Promise<{port:number;close():Promise<void>}> {
  const rate=new Map<string,{tokens:number;at:number}>();
  const server=createServer(async(req,res)=>{
    function reply(status:number,body:unknown){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));}
    try {
      const host=`127.0.0.1:${(server.address() as {port:number}).port}`;
      if(req.method!=='POST'||req.headers.origin!==undefined||req.headers.host!==host)throw new ProtocolError('FORBIDDEN',403);
      const id=req.headers['x-connector-id'];if(typeof id!=='string'||id.length>128)throw new ProtocolError('FORBIDDEN',403);
      let source:TrustedSource|null=null;
      {
        // Credentials are registered under the SHA-256 of their connector ID.
        // Read only that file; unrelated entries cannot crowd it out, and each
        // report no longer enumerates/re-reads every connector's secret.
        const file=createHash('sha256').update(id).digest('hex')+'.json';
        const c=await readCredential(join(options.userDataDir,'connectors',file)).catch(()=>null);
        if(c){
        const a=Buffer.from(String(req.headers.authorization||'')),b=Buffer.from('Bearer '+c.token);
        if(c.connectorId===id&&a.length===b.length&&timingSafeEqual(a,b))source={connectorId:id,provider:c.provider,kind:c.kind,sourceInstanceId:'connector:'+id};
        }
      }
      if(!source)throw new ProtocolError('FORBIDDEN',403);
      const now=options.clock().wallMs, bucket=rate.get(id)||{tokens:40,at:now};bucket.tokens=Math.min(40,bucket.tokens+Math.max(0,now-bucket.at)*.02);bucket.at=now;
      if(bucket.tokens<1)throw new ProtocolError('RATE_LIMIT',429);bucket.tokens--;rate.set(id,bucket);
      const operation=req.url?.slice('/v1/'.length);
      if(!req.url?.startsWith('/v1/')||!['begin','report','context','finish','hook','binding'].includes(operation||''))throw new ProtocolError('NOT_FOUND',404);
      if(source.kind==='hook'&&operation!=='hook'||source.kind==='reporter'&&operation==='hook')throw new ProtocolError('FORBIDDEN',403);
      let bytes=0;const chunks:Buffer[]=[];
      for await(const chunk of req){bytes+=chunk.length;if(bytes>65536){reply(413,{error:'BODY_TOO_LARGE'});return;}chunks.push(chunk);}
      let body:unknown;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ProtocolError('INVALID_JSON',400);}
      let result:unknown;
      if(operation==='begin')result={handle:await store.begin(body as Parameters<Store['begin']>[0],source)};
      else if(operation==='binding'){const parsed=bindingSchema.safeParse(body);if(!parsed.success)throw new ProtocolError('INVALID_SCHEMA',400);const c=parsed.data.nativeContext;result={codingScheduleBindingReceipt:await store.prepareBinding(parsed.data.handle,{sessionId:c.sessionId,turnId:c.turnId,...(c.itemId?{itemId:c.itemId}:{}),...(c.callId?{callId:c.callId}:{})},source)};}
      else if(operation==='context') {const parsed=contextSchema.safeParse(body);if(!parsed.success)throw new ProtocolError('INVALID_SCHEMA',400);result=await store.context(parsed.data.handle,source);}
      else if(operation==='hook')result=await handleHook(store,source,body,now);
      else result=await store.commit(normalizeReport(body,source,now,operation==='finish'),source);
      if(operation!=='context')options.onCommit?.(); reply(200,result);
    }catch(error){const e=error instanceof ProtocolError?error:new ProtocolError('LOCAL_RECORD_ERROR',503);if(e.status>=500)options.onError?.('本地记录异常');reply(e.status,{error:e.code});}
  });
  server.requestTimeout=2000;server.headersTimeout=2000;server.maxConnections=32;
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve());});
  const port=(server.address() as {port:number}).port,endpointPath=join(options.userDataDir,'endpoint.json');
  await atomicJson(endpointPath,{port,pid:process.pid});
  return {port,async close(){server.closeIdleConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));try{const current=JSON.parse(await readFile(endpointPath,'utf8'));if(current.pid===process.pid&&current.port===port)await rm(endpointPath);}catch{/* Already removed. */}}};
}

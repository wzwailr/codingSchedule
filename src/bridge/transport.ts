import { readFile } from 'node:fs/promises';
import { request } from 'node:http';
import { readCredential } from './credential.js';
export type LocalRequest = { operation:'begin'|'report'|'context'|'finish'|'hook'|'binding'; body:unknown; connectorId:string; endpointPath:string; credentialPath:string };
export type LocalResponse = { status:number; body:unknown };
export async function sendLocal(input:LocalRequest,deadlineMs=1500):Promise<LocalResponse> {
  const credential=await readCredential(input.credentialPath);
  if(credential.connectorId!==input.connectorId)throw new Error('Connector mismatch');
  const endpoint=JSON.parse(await readFile(input.endpointPath,'utf8')) as {port:number};
  if(!Number.isInteger(endpoint.port)||endpoint.port<1||endpoint.port>65535)throw new Error('Invalid endpoint');
  const body=JSON.stringify(input.body);
  if(Buffer.byteLength(body)>65536) return {status:413,body:{error:'BODY_TOO_LARGE'}};
  return new Promise((resolve,reject)=>{
    const req=request({host:'127.0.0.1',port:endpoint.port,path:'/v1/'+input.operation,method:'POST',headers:{Authorization:'Bearer '+credential.token,'X-Connector-Id':input.connectorId,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{
      const chunks:Buffer[]=[];let bytes=0;
      res.on('data',(b:Buffer)=>{bytes+=b.length;if(bytes>262144){req.destroy(new Error('Response limit'));return;}chunks.push(b);});
      res.on('end',()=>{clearTimeout(timer);try{resolve({status:res.statusCode||503,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch{reject(new Error('Invalid local response'));}});
    });
    const timer=setTimeout(()=>req.destroy(Object.assign(new Error('Local service unavailable'),{code:'ETIMEDOUT'})),Math.max(1,deadlineMs));
    req.on('error',e=>{clearTimeout(timer);reject(e);}); req.end(body);
  });
}

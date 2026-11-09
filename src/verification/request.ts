import {readFile} from 'node:fs/promises';
type Paths={connectorId:string;credentialPath:string;endpointPath:string};
export type RecoveryEvent={operation:string;kind:'transport'|'endpoint';attempt:number;code:string};
function codeOf(error:unknown):string {
 const e=error as {code?:unknown;name?:unknown;cause?:{code?:unknown}};
 const code=e?.cause?.code??e?.code;
 return typeof code==='string'&&/^[A-Z_0-9]{1,60}$/.test(code)?code:e?.name==='TimeoutError'?'TIMEOUT':'FETCH_FAILED';
}
export class AcceptanceTransportError extends Error {
 code:string;attempts:number;
 constructor(code:string,attempts:number){super('Local acceptance transport failed ('+code+')');this.name='AcceptanceTransportError';this.code=code;this.attempts=attempts;}
}
export function createAcceptanceRequester(paths:Paths,options:{onRecovery?:(event:RecoveryEvent)=>void;retryDelayMs?:number}={}){
 let lastPort:number|undefined;
 const pause=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
 const observeEndpoint=async(operation='sample',attempt=1)=>{
  const endpoint=JSON.parse(await readFile(paths.endpointPath,'utf8')) as {port:number};if(!Number.isInteger(endpoint.port)||endpoint.port<1||endpoint.port>65535)throw new Error('Invalid acceptance endpoint');
  if(lastPort!==undefined&&lastPort!==endpoint.port)options.onRecovery?.({operation,kind:'endpoint',attempt,code:'ENDPOINT_CHANGED'});lastPort=endpoint.port;return endpoint;
 };
 return {observeEndpoint,async send(operation:string,body:unknown):Promise<{status:number;body:unknown}>{
  const input=body as {idempotencyKey?:unknown;reportId?:unknown;seq?:unknown};
  const retrySafe=operation==='context'||operation==='begin'&&typeof input?.idempotencyKey==='string'||['report','finish'].includes(operation)&&typeof input?.reportId==='string'&&Number.isInteger(input?.seq);
  const wire=JSON.stringify(body);if(Buffer.byteLength(wire)>65536)throw new Error('Acceptance body limit');
  const credential=JSON.parse(await readFile(paths.credentialPath,'utf8')) as {connectorId:string;token:string};
  if(credential.connectorId!==paths.connectorId||typeof credential.token!=='string')throw new Error('Acceptance credential mismatch');
  let attempts=0,rateAttempts=0;
  for(;;){
   attempts++;
   try{
    const endpoint=await observeEndpoint(operation,attempts);
    const response=await fetch(`http://127.0.0.1:${endpoint.port}/v1/${operation}`,{method:'POST',headers:{'Content-Type':'application/json','X-Connector-Id':credential.connectorId,Authorization:'Bearer '+credential.token},body:wire,signal:AbortSignal.timeout(4000)});
    const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let bytes=0;
    if(reader)for(;;){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>262144){await reader.cancel();throw new Error('Acceptance response limit');}chunks.push(next.value);}
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if(response.status===429&&rateAttempts++<19){attempts--;await pause(100);continue;}
    return {status:response.status,body:value};
   }catch(error){
    const code=codeOf(error),transient=['ECONNREFUSED','ECONNRESET','EPIPE','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','ENOENT','TIMEOUT'].includes(code);
    if(!retrySafe||!transient||attempts>=3)throw new AcceptanceTransportError(code,attempts);
    options.onRecovery?.({operation,kind:'transport',attempt:attempts,code});await pause((options.retryDelayMs??100)*attempts);
   }
  }
 }};
}

import type { Readable } from 'node:stream';
import { parseOptions } from './options.js';
import { sendLocal } from './transport.js';
import {createUuid7} from '../domain/identity.js';
export async function runCli(args:string[],stdin:Readable,output:(text:string)=>void=text=>process.stdout.write(text+'\n')):Promise<number>{
  if(args[0]==='new-key'){output(createUuid7(Date.now()));return 0;}
  const operation=args[0];if(!['begin','report','context','finish','binding'].includes(operation||''))return 2;
  let options:ReturnType<typeof parseOptions>,body:unknown;
  try{options=parseOptions(args);const chunks:Buffer[]=[];let bytes=0;for await(const part of stdin){const b=Buffer.from(part);bytes+=b.length;if(bytes>65536)return 2;chunks.push(b);}body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return 2;}
  try{const r=await sendLocal({...options,operation:operation as 'begin'|'report'|'context'|'finish'|'binding',body});output(JSON.stringify(r.body));return r.status===200?0:r.status===503?3:2;}catch{output(JSON.stringify({error:'UNAVAILABLE'}));return 3;}
}

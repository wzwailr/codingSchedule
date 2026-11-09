import {open} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {clean,obj} from '../common/parse.js';
// Names come from the host's public index, not inferred transcript content.
export function sessionNames(root:string):()=>Promise<Map<string,string>>{
 let version='',names=new Map<string,string>();
 return async()=>{
  const file=await open(join(dirname(root),'session_index.jsonl'),'r').catch(()=>null);if(!file)return names;
  try{
   const info=await file.stat(),key=`${info.ino}:${info.size}:${info.mtimeMs}`;if(key===version)return names;
   const start=Math.max(0,info.size-2097152),buffer=Buffer.alloc(Math.min(info.size,2097152)),read=await file.read(buffer,0,buffer.length,start);
   let text=buffer.subarray(0,read.bytesRead).toString('utf8');if(start)text=text.slice(text.indexOf('\n')+1);
   const next=new Map<string,string>();
   for(const line of text.split('\n'))try{const record=obj(JSON.parse(line)),id=clean(record.id,256),name=[...clean(record.thread_name,160)].map(ch=>ch.charCodeAt(0)<32||ch.charCodeAt(0)===127?' ':ch).join('');if(id&&name)next.set(id,name);}catch{/* Retry incomplete records after the next append. */}
   version=key;names=next;return names;
  }finally{await file.close();}
 };
}

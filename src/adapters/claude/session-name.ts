import type {FileHandle} from 'node:fs/promises';
import {clean,obj} from '../common/parse.js';
function explicitName(text:string,id:string):string|undefined{
 let name:string|undefined;
 for(const line of text.split('\n'))try{const r=obj(JSON.parse(line));if(r.type==='custom-title'&&r.sessionId===id&&r.isSidechain!==true){const value=[...clean(r.customTitle,160)].map(ch=>ch.charCodeAt(0)<32||ch.charCodeAt(0)===127?' ':ch).join('');if(value)name=value;}}catch{/* Partial records are not names. */}
 return name;
}
// Claude Code writes explicit custom-title records. Read only metadata from
// the existing header and a bounded tail; never infer a title from user text.
export async function claudeSessionName(file:FileHandle,id:string,head:string,previous?:string):Promise<string|undefined>{
 const initial=explicitName(head,id),size=(await file.stat()).size;
 if(size<=65536)return initial||previous;
 const start=Math.max(65536,size-262144),buffer=Buffer.alloc(size-start),read=await file.read(buffer,0,buffer.length,start),text=buffer.subarray(0,read.bytesRead).toString('utf8');
 return explicitName(text.slice(text.indexOf('\n')+1),id)||previous||initial;
}

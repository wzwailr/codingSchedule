import type {RunRef,BindingReceipt} from '../../shared/contracts.js';
import {obj} from './parse.js';
const direct=/^(?:tools\.)?(?:mcp__codingSchedule__)?progress_(?:begin|context)$/;
export function reporterCall(name:string,code=''):'direct'|'wrapped'|null{
 if(direct.test(name))return 'direct';
 if(!/(^|\.)exec(_code)?$/.test(name)||code.length>1048576||code.includes('`'))return null;
 const plain=code.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,' ');
 return /\btools\.mcp__codingSchedule__progress_(?:begin|context)\s*\(/.test(plain)?'wrapped':null;
}
// Read public references only from a correlated reporting result. Never retain
// a resumeHandle, original tool input, model text or an arbitrary output object.
function structuredResult(value:unknown,accept:(r:Record<string,unknown>)=>void):void{
 function visit(raw:unknown,depth=0):void{
  if(depth>7)return;
  if(typeof raw==='string'){
   if(raw.length>262144)return;
   try{visit(JSON.parse(raw),depth+1);}catch{
    for(const line of raw.split('\n').slice(0,200))if(/^\s*\{"codingScheduleBinding(?:Receipt)?":/.test(line))try{visit(JSON.parse(line),depth+1);}catch{/* Partial output is not evidence. */}
   }return;
  }
  if(Array.isArray(raw)){if(raw.some(part=>obj(part).type==='input_text'&&String(obj(part).text).startsWith('Script failed')))return;for(const part of raw.slice(0,20))visit(part,depth+1);return;}
  const r=obj(raw);if(r.isError===true||r.error)return;
  accept(r);
  if(r.content!==undefined)visit(r.content,depth+1);if(['text','input_text'].includes(String(r.type))&&typeof r.text==='string')visit(r.text,depth+1);
 }
 visit(value);
}
function reference(value:unknown):RunRef|null{const r=obj(value);return typeof r.runId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(r.runId)&&Number.isSafeInteger(r.generation)&&Number(r.generation)>0?{runId:r.runId,generation:Number(r.generation)}:null;}
export function reporterReference(value:unknown,kind:'direct'|'wrapped'):RunRef|null{
 const refs=new Map<string,RunRef>();structuredResult(value,r=>{const ref=reference(r.codingScheduleBinding??(kind==='direct'?(r.handle??obj(r.snapshot).run):undefined));if(ref)refs.set(JSON.stringify(ref),ref);});return refs.size===1?[...refs.values()][0]!:null;
}
// This is only an opaque, scoped receipt. The store must validate its issued
// claim against the actual transcript's session/turn/invocation before linking.
export function bindingReceiptReference(value:unknown):BindingReceipt|null{
 const receipts=new Map<string,BindingReceipt>();structuredResult(value,r=>{const claim=obj(r.codingScheduleBindingReceipt),run=reference(claim.run);if(run&&typeof claim.token==='string'&&/^[a-f0-9]{64}$/.test(claim.token))receipts.set(JSON.stringify([run,claim.token]),{run,token:claim.token});});return receipts.size===1?[...receipts.values()][0]!:null;
}

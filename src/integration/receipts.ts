import {readFile,rm,mkdir} from 'node:fs/promises';import {join,resolve} from 'node:path';import {randomUUID} from 'node:crypto';
import {applyIntegration,revertIntegration,combineReceipts,receiptFor,patchIsCurrent,previewRevert} from './config-patch.js';import type {ConfigPatch,InstallReceipt,ApplyResult} from './config-patch.js';import {atomicJson} from '../bridge/credential.js';
type Records=Record<string,InstallReceipt>;
type Journal={version:1;committed:boolean;before:Records;patches:ConfigPatch[]};
let queue:Promise<void>=Promise.resolve();
function exclusive<T>(action:()=>Promise<T>):Promise<T>{const result=queue.then(action);queue=result.then(()=>{},()=>{});return result;}
async function load(dir:string):Promise<Records>{try{return JSON.parse(await readFile(join(dir,'receipts.json'),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {};throw e;}}
function identity(value:{host:string;path:string}){const path=resolve(value.path);return value.host+':'+(process.platform==='win32'?path.toLowerCase():path);}
function group(records:Record<string,InstallReceipt>,target:{host:string;path:string}){return Object.entries(records).filter(([,r])=>identity(r)===identity(target));}
function combined(entries:Array<[string,InstallReceipt]>){return entries.slice(1).reduce((prior,[,next])=>combineReceipts(prior,next),entries[0]![1]);}
async function recover(dir:string){
 const path=join(dir,'integration-transaction.json');let journal:Journal;
 try{journal=JSON.parse(await readFile(path,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}
 if(journal.version!==1||!Array.isArray(journal.patches)||!journal.before)throw new Error('Invalid installation journal');
 if(!journal.committed){
  for(const patch of [...journal.patches].reverse()){
   if(await patchIsCurrent(patch))continue;
   if(!(await revertIntegration(receiptFor(patch))).applied)throw new Error('Installation recovery conflict; preserve files and review owned entries');
  }
  await atomicJson(join(dir,'receipts.json'),journal.before,true);
 }
 await rm(path);
}
export function recoverIntegrations(dir:string){return exclusive(()=>recover(dir));}
export function readReceipts(dir:string){return exclusive(async()=>{await recover(dir);return load(dir);});}
async function transact(dir:string,before:Records,patches:ConfigPatch[],next:Records,recordBackups=false):Promise<ApplyResult>{
 const journal:Journal={version:1,committed:false,before,patches},path=join(dir,'integration-transaction.json');
 try{
  for(const patch of patches)if(!await patchIsCurrent(patch))return {applied:false,reason:'conflict'};
  // Durable undo precedes host writes and the receipt commit, so an app exit
  // cannot silently leave half an installation without a recovery path.
  await atomicJson(path,journal,true);
  for(const patch of patches){
   const result=await applyIntegration(patch);if(!result.applied){await recover(dir);return result;}
   const retained=recordBackups?Object.values(next).find(r=>identity(r)===identity(patch)):undefined;
   if(retained&&!retained.backupPath&&result.receipt?.backupPath)retained.backupPath=result.receipt.backupPath;
  }
  await atomicJson(join(dir,'receipts.json'),next,true);
  await atomicJson(path,{...journal,committed:true},true);
 }catch{
  try{await recover(dir);}catch{return {applied:false,reason:'conflict'};}
  return {applied:false,reason:'invalid'};
 }
 await rm(path).catch(()=>{});return {applied:true};
}
export function applyRecordedIntegrations(dir:string,patches:ConfigPatch[]):Promise<ApplyResult>{return exclusive(async()=>{
 await mkdir(dir,{recursive:true});await recover(dir);const before=await load(dir),next={...before};
 if(new Set(patches.map(identity)).size!==patches.length)throw new Error('Duplicate installation target');
 for(const patch of patches){
  const entries=group(next,patch),previous=entries.length?combined(entries):null;
  if(previous&&patch.ownedBefore!==null&&JSON.stringify(patch.ownedBefore)!==JSON.stringify(previous.ownedAfter))return {applied:false,reason:'conflict'};
  if(previous?.installRoot&&!patch.installRoot&&patch.beforeText!==patch.afterText)return {applied:false,reason:'conflict'};
  const unchanged=previous&&patch.beforeText===patch.afterText;
  const receipt=receiptFor(patch);
  const value=unchanged?{...previous,...(patch.bundle?{bundle:patch.bundle}:{})}:previous
   ? patch.installRoot&&patch.installRoot!==previous.installRoot?{...receipt,previousInstallation:previous}:combineReceipts(previous,receipt)
   : receipt;
  for(const [id] of entries)delete next[id];next[entries[0]?.[0]||randomUUID()]=value;
 }
 return transact(dir,before,patches.filter(p=>p.beforeText!==p.afterText||p.remove),next,true);
});}
export function applyRecordedIntegration(dir:string,patch:ConfigPatch){return applyRecordedIntegrations(dir,[patch]);}
export function revertRecordedIntegrations(dir:string,ids:string[],installRoot?:string):Promise<ApplyResult>{return exclusive(async()=>{
 await recover(dir);const before=await load(dir),next={...before},patches:ConfigPatch[]=[];
 try{
  for(const id of ids){const target=next[id];if(!target||target.installRoot!==installRoot)continue;const entries=group(next,target),patch=await previewRevert(combined(entries));if(patch)patches.push(patch);for(const [key] of entries)delete next[key];if(target.previousInstallation)next[id]=target.previousInstallation;}
 }catch{return {applied:false,reason:'conflict'};}
 return transact(dir,before,patches,next);
});}
export function revertRecordedIntegration(dir:string,id:string,installRoot?:string){return revertRecordedIntegrations(dir,[id],installRoot);}

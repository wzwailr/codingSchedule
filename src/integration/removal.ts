import {readFile,lstat,readdir,rm} from 'node:fs/promises';import {join,isAbsolute} from 'node:path';
import {readReceipts,revertRecordedIntegrations} from './receipts.js';
export async function prepareRemoval(dir:string,deleteProgress:boolean,installRoot?:string):Promise<{ok:boolean;progressDeleted:boolean;conflicts:string[]}>{
 if(!isAbsolute(dir))throw new Error('Absolute data directory required');
 try{const stat=await lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Unsafe data directory');}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {ok:true,progressDeleted:false,conflicts:[]};throw e;}
 try{
  const endpoint=JSON.parse(await readFile(join(dir,'endpoint.json'),'utf8')) as {pid?:number};
  if(typeof endpoint.pid!=='number'||!Number.isSafeInteger(endpoint.pid)||endpoint.pid<=0)throw new Error('Invalid collector endpoint; review before removal');
  let live=true;try{process.kill(endpoint.pid,0);}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH')live=false;else throw e;}
  if(live)throw new Error('Collector still running; exit codingSchedule first');
 }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const receipts=Object.entries(await readReceipts(dir)),owned=receipts.filter(([,r])=>r.installRoot===installRoot);
 if(deleteProgress&&receipts.length!==owned.length)return {ok:false,progressDeleted:false,conflicts:[]};
 const result=await revertRecordedIntegrations(dir,owned.map(([id])=>id).reverse(),installRoot);
 const conflicts=result.applied?[]:[...new Set(owned.map(([,r])=>r.path))];
 if(conflicts.length)return {ok:false,progressDeleted:false,conflicts};
 if(deleteProgress){
  // Never recursively remove userData or a configured source directory. Only
  // our database and our migration snapshots are eligible, never *.jsonl logs.
  const files=['schedule.db','schedule.db-wal','schedule.db-shm'];const backups=join(dir,'backups');
  try{const stat=await lstat(backups);if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Unsafe backup directory');for(const name of await readdir(backups))if(/^before-v\d+-[\w-]+\.sqlite$/.test(name))files.push(join('backups',name));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  for(const name of files){const path=join(dir,name);try{const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Unsafe progress file');await rm(path);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
 }
 return {ok:true,progressDeleted:deleteProgress,conflicts:[]};
}

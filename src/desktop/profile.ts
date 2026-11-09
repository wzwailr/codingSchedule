import {DatabaseSync,backup} from 'node:sqlite';
import {constants} from 'node:fs';
import {access,copyFile,lstat,mkdir,mkdtemp,open,readFile,readdir,rename,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {atomicJson,readCredential} from '../bridge/credential.js';

// AppData can resolve to different physical files for a packaged AI host and an
// independently launched desktop app. Every connector uses this shared path.
export function profileDirectory(legacy:string,userHome:string,platform:NodeJS.Platform):string{
 return platform==='win32'?join(userHome,'.coding-schedule'):legacy;
}
const exists=async(path:string)=>access(path).then(()=>true,(error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return false;throw error;});
export async function assertProfileIdle(path:string):Promise<void>{
 let endpoint:{pid?:unknown};
 try{endpoint=JSON.parse(await readFile(join(path,'endpoint.json'),'utf8'));}
 catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
 const pid=endpoint.pid;
 if(typeof pid!=='number'||!Number.isSafeInteger(pid)||pid<=0)throw new Error('Invalid profile endpoint');
 try{process.kill(pid,0);}
 catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return;throw error;}
 throw new Error('Profile already in use');
}
export async function prepareProfile(target:string,legacy:string):Promise<'fresh'|'existing'|'migrated'>{
 if(resolve(target)===resolve(legacy)||await exists(join(target,'schedule.db'))||await exists(join(target,'profile-migration.json')))return 'existing';
 if(!await exists(join(legacy,'schedule.db')))return 'fresh';
 try{
  const endpoint=JSON.parse(await readFile(join(legacy,'endpoint.json'),'utf8')) as {pid?:number};
  if(Number.isSafeInteger(endpoint.pid)&&endpoint.pid!>0){
   let alive=true;try{process.kill(endpoint.pid!,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')alive=false;else throw error;}
   if(alive)throw new Error('LEGACY_PROFILE_ACTIVE');
  }
 }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 await mkdir(target,{recursive:true});
 if((await lstat(target)).isSymbolicLink())throw new Error('PROFILE_LINK_REJECTED');
 const lockPath=join(target,'.profile-migration.lock'),lock=await open(lockPath,'wx',0o600);
 let stage:string|undefined;
 try{
  stage=await mkdtemp(join(target,'.profile-migration-'));
  const source=new DatabaseSync(join(legacy,'schedule.db'),{readOnly:true});
  try{
   const checks=source.prepare('PRAGMA integrity_check').all();
   if(checks.length!==1||Object.values(checks[0]!)[0]!=='ok')throw new Error('LEGACY_DATABASE_INVALID');
   await backup(source,join(stage,'schedule.db'));
  }finally{source.close();}
  const files:string[]=[];
  for(const name of ['settings.json','position.json','receipts.json'])if(await exists(join(legacy,name))){
   if((await lstat(join(legacy,name))).isSymbolicLink())throw new Error('PROFILE_LINK_REJECTED');
   await copyFile(join(legacy,name),join(stage,name),constants.COPYFILE_EXCL);files.push(name);
  }
  const credentials=join(legacy,'connectors');
  if(await exists(credentials)){
   if((await lstat(credentials)).isSymbolicLink())throw new Error('PROFILE_LINK_REJECTED');
   if(await exists(join(target,'connectors'))&&(await lstat(join(target,'connectors'))).isSymbolicLink())throw new Error('PROFILE_LINK_REJECTED');
   await mkdir(join(stage,'connectors'));
   for(const name of await readdir(credentials))if(/^[a-f0-9]{64}\.json$/.test(name)){
    if((await lstat(join(credentials,name))).isSymbolicLink())throw new Error('PROFILE_LINK_REJECTED');
    await atomicJson(join(stage,'connectors',name),await readCredential(join(credentials,name)),true);files.push(join('connectors',name));
   }
  }
  // Validate all collisions before promoting anything. The database comes last,
  // so a partial attempt cannot masquerade as a ready profile on the next start.
  for(const name of files)if(await exists(join(target,name))&&!(await readFile(join(target,name))).equals(await readFile(join(stage,name))))throw new Error('PROFILE_TARGET_CONFLICT');
  for(const name of files)if(!await exists(join(target,name))){
   if(name.startsWith('connectors'+sep))await mkdir(join(target,'connectors'),{recursive:true});
   await rename(join(stage,name),join(target,name));
  }
  await rename(join(stage,'schedule.db'),join(target,'schedule.db'));
  await atomicJson(join(target,'profile-migration.json'),{version:1,migratedAt:new Date().toISOString(),legacyDirectory:legacy,originalPreserved:true});
  return 'migrated';
 }finally{
  await lock.close();await rm(lockPath,{force:true});
  if(stage&&resolve(stage).startsWith(resolve(target)+sep+'.profile-migration-'))await rm(stage,{recursive:true,force:true});
 }
}

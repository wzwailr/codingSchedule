import {expect,test} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {profileDirectory,prepareProfile} from '../../src/desktop/profile.js';
import {createCredential,readCredential} from '../../src/bridge/credential.js';
const exists=async(path:string)=>access(path).then(()=>true,()=>false);
function database(path:string,value:number){const db=new DatabaseSync(path);db.exec('PRAGMA journal_mode=WAL;CREATE TABLE sample(value INTEGER);');db.prepare('INSERT INTO sample VALUES(?)').run(value);return db;}
test('Windows default profile is outside virtualized AppData; other platforms retain their default',()=>{
 expect(profileDirectory('C:/user/AppData/Roaming/coding-schedule','C:/user','win32')).toBe(join('C:/user','.coding-schedule'));
 expect(profileDirectory('/legacy','/user','linux')).toBe('/legacy');
});
test('migration snapshots committed WAL data, retains credentials and settings, and keeps the old profile',async()=>{
 const root=await mkdtemp(join(tmpdir(),'shared-profile-')),legacy=join(root,'legacy'),target=join(root,'shared');await mkdir(legacy);
 const db=database(join(legacy,'schedule.db'),1);db.prepare('INSERT INTO sample VALUES(?)').run(2);
 const settings={sources:[{provider:'codex',root:join(root,'logs'),enabled:true}]};await writeFile(join(legacy,'settings.json'),JSON.stringify(settings));
 const credential=await createCredential(legacy,'codex-reporter','codex','reporter');
 try{
  expect(await prepareProfile(target,legacy)).toBe('migrated');
  const copy=new DatabaseSync(join(target,'schedule.db'),{readOnly:true});try{expect(copy.prepare('SELECT sum(value) total FROM sample').get()?.total).toBe(3);expect(copy.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');}finally{copy.close();}
  expect(JSON.parse(await readFile(join(target,'settings.json'),'utf8'))).toEqual(settings);
  expect(await readCredential(credential.replace(legacy,target))).toEqual(await readCredential(credential));
  expect(await exists(join(legacy,'schedule.db'))).toBe(true);
  expect(await prepareProfile(target,legacy)).toBe('existing');
 }finally{db.close();await rm(root,{recursive:true,force:true});}
});
test('an existing shared database is never replaced by legacy contents',async()=>{
 const root=await mkdtemp(join(tmpdir(),'profile-existing-')),legacy=join(root,'old'),target=join(root,'new');await mkdir(legacy);await mkdir(target);const a=database(join(legacy,'schedule.db'),1),b=database(join(target,'schedule.db'),9);a.close();b.close();
 try{expect(await prepareProfile(target,legacy)).toBe('existing');const db=new DatabaseSync(join(target,'schedule.db'),{readOnly:true});try{expect(db.prepare('SELECT value FROM sample').get()?.value).toBe(9);}finally{db.close();}}finally{await rm(root,{recursive:true,force:true});}
});
test('bad legacy data is preserved and cannot become an empty successful migration',async()=>{
 const root=await mkdtemp(join(tmpdir(),'profile-invalid-')),legacy=join(root,'old'),target=join(root,'new');await mkdir(legacy);await writeFile(join(legacy,'schedule.db'),'invalid original');
 try{await expect(prepareProfile(target,legacy)).rejects.toThrow();expect(await exists(join(target,'schedule.db'))).toBe(false);expect(await readFile(join(legacy,'schedule.db'),'utf8')).toBe('invalid original');}finally{await rm(root,{recursive:true,force:true});}
});
test('conflicting target settings remain untouched and no database is promoted',async()=>{
 const root=await mkdtemp(join(tmpdir(),'profile-conflict-')),legacy=join(root,'old'),target=join(root,'new');await mkdir(legacy);await mkdir(target);database(join(legacy,'schedule.db'),1).close();await writeFile(join(legacy,'settings.json'),'{}');await writeFile(join(target,'settings.json'),'{"keep":true}');
 try{await expect(prepareProfile(target,legacy)).rejects.toThrow();expect(await readFile(join(target,'settings.json'),'utf8')).toBe('{"keep":true}');expect(await exists(join(target,'schedule.db'))).toBe(false);}finally{await rm(root,{recursive:true,force:true});}
});
test('cleared progress is not resurrected after a completed migration',async()=>{
 const root=await mkdtemp(join(tmpdir(),'profile-cleared-')),legacy=join(root,'old'),target=join(root,'new');await mkdir(legacy);await mkdir(target);database(join(legacy,'schedule.db'),1).close();await writeFile(join(target,'profile-migration.json'),'{}');
 try{expect(await prepareProfile(target,legacy)).toBe('existing');expect(await exists(join(target,'schedule.db'))).toBe(false);}finally{await rm(root,{recursive:true,force:true});}
});
test('a live legacy collector must exit before its profile is migrated',async()=>{
 const root=await mkdtemp(join(tmpdir(),'profile-live-')),legacy=join(root,'old'),target=join(root,'new');await mkdir(legacy);database(join(legacy,'schedule.db'),1).close();await writeFile(join(legacy,'endpoint.json'),JSON.stringify({pid:process.pid}));
 try{await expect(prepareProfile(target,legacy)).rejects.toThrow('LEGACY_PROFILE_ACTIVE');expect(await exists(join(target,'schedule.db'))).toBe(false);}finally{await rm(root,{recursive:true,force:true});}
});
test('only one simultaneous migration owns the shared target',async()=>{
 const root=await mkdtemp(join(tmpdir(),'profile-race-')),legacy=join(root,'old'),target=join(root,'new');await mkdir(legacy);database(join(legacy,'schedule.db'),1).close();
 try{const results=await Promise.allSettled([prepareProfile(target,legacy),prepareProfile(target,legacy)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);const db=new DatabaseSync(join(target,'schedule.db'),{readOnly:true});try{expect(db.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');}finally{db.close();}}finally{await rm(root,{recursive:true,force:true});}
});

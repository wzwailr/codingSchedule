import{mkdtemp,rm,readdir}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{DatabaseSync}from'node:sqlite';import{expect,test}from'vitest';
import{openDatabase}from'../../src/storage/database.js';import{DATABASE_VERSION}from'../../src/storage/migrations.js';
import{openStore}from'../../src/storage/repository.js';import{clock,source}from'../helpers.js';
test('v2 cursor/checkpoint migrates to the current schema without losing half-line bytes or pending tool call',async()=>{
 const d=await mkdtemp(join(tmpdir(),'schedule-migration-')),path=join(d,'db'),native={...source('native','transcript'),nativeSessionId:'session'};let store=await openStore(path,()=>clock());
 const cursor={pathKey:'path',fileGeneration:'generation',committedOffset:8,pendingBytes:new Uint8Array([0xe6,0xb1])},parser={currentTurnId:'turn',nativePlanRevision:1,completePlan:false,pendingCalls:{call:{name:'TaskCreate',input:{subject:'test'},offset:0}}};
 try{
  await store.commit({events:[],cursor,parserCheckpoint:parser,expectedCursor:null},native);await store.close();
  const old=new DatabaseSync(path);try{old.exec('DROP TABLE native_binding_receipts;ALTER TABLE file_cursors DROP COLUMN fingerprint;PRAGMA user_version=2;');}finally{old.close();}
  store=await openStore(path,()=>clock());expect(await store.checkpoint('path')).toEqual({cursor,parserCheckpoint:parser});
  await store.commit({events:[],cursor:{...cursor,fingerprint:'a'.repeat(64)},parserCheckpoint:parser,expectedCursor:{fileGeneration:'generation',committedOffset:8}},native);
  expect((await store.checkpoint('path'))?.cursor.fingerprint).toBe('a'.repeat(64));
  const current=new DatabaseSync(path);try{expect(current.prepare('PRAGMA user_version').get()!.user_version).toBe(DATABASE_VERSION);}finally{current.close();}
 }finally{await store.close();await rm(d,{recursive:true,force:true});}
});

test('upgrade snapshots the old database including committed WAL before changing schema',async()=>{
 const d=await mkdtemp(join(tmpdir(),'schedule-upgrade-')),path=join(d,'db');const old=new DatabaseSync(path);
 try{
  old.exec("PRAGMA journal_mode=WAL; CREATE TABLE file_cursors(path_key TEXT PRIMARY KEY); CREATE TABLE marker(value TEXT); INSERT INTO marker VALUES('preserve'); PRAGMA user_version=2;");
  const current=openDatabase(path);current.close();
  const files=await readdir(join(d,'backups'));expect(files).toHaveLength(1);
  const backup=new DatabaseSync(join(d,'backups',files[0]!),{readOnly:true});
  try{expect(backup.prepare('PRAGMA user_version').get()!.user_version).toBe(2);expect(backup.prepare('SELECT value FROM marker').get()!.value).toBe('preserve');expect(backup.prepare('PRAGMA integrity_check').get()!.integrity_check).toBe('ok');}finally{backup.close();}
  openDatabase(path).close();expect(await readdir(join(d,'backups'))).toHaveLength(1);
 }finally{old.close();await rm(d,{recursive:true,force:true});}
});

test('failed multi-step upgrade rolls back schema and keeps readable old data and backup',async()=>{
 const d=await mkdtemp(join(tmpdir(),'schedule-upgrade-fail-')),path=join(d,'db'),old=new DatabaseSync(path);
 old.exec("CREATE TABLE runs(run_id TEXT PRIMARY KEY); CREATE TABLE marker(value TEXT); INSERT INTO marker VALUES('keep'); PRAGMA user_version=1;");old.close();
 try{
  expect(()=>openDatabase(path)).toThrow(); // Missing file_cursors makes v3 fail after v2 DDL.
  const db=new DatabaseSync(path);try{expect(db.prepare('PRAGMA user_version').get()!.user_version).toBe(1);expect(db.prepare("SELECT name FROM sqlite_master WHERE name='native_runs'").get()).toBeUndefined();expect(db.prepare('SELECT value FROM marker').get()!.value).toBe('keep');}finally{db.close();}
  expect(await readdir(join(d,'backups'))).toHaveLength(1);
 }finally{await rm(d,{recursive:true,force:true});}
});

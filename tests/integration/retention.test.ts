import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';import {expect,test} from 'vitest';
import {openStore} from '../../src/storage/repository.js';import {reportBatch} from '../../src/ingestion/normalize-report.js';
import {clock,source,key,NOW} from '../helpers.js';
test('retention bounds work, keeps active/control receipts; duplicate ACK works after events removed; old handle gone',async()=>{
  const d=await mkdtemp(join(tmpdir(),'schedule-retain-')),path=join(d,'db');let now=NOW;
  const store=await openStore(path,()=>clock(now)),s=source();
  try{
    const active=await store.begin({idempotencyKey:key(),title:'active'},s),done=await store.begin({idempotencyKey:key(),title:'done'},s);
    const batch=reportBatch(done,key(),2,[{type:'completion.reported',summary:'done'}],s,now);await store.commit(batch,s);
    const db=new DatabaseSync(path);db.prepare('UPDATE runs SET terminal_at=? WHERE run_id=?').run(NOW-8*86400000,done.runId);db.close();
    const result=await store.maintenance();expect(result.deletedRows).toBeLessThanOrEqual(500);expect(result.effectiveBytes).toBeLessThan(100*1024*1024);
    expect((await store.commit(batch,s)).duplicate).toBe(true);expect((await store.context(active,s)).snapshot.title).toBe('active');
    now=NOW+32*86400000;await store.maintenance();await expect(store.context(done,s)).rejects.toThrow('RUN_GONE');expect((await store.context(active,s)).snapshot.title).toBe('active');
    await expect(store.begin({idempotencyKey:key(),title:'expired'},s)).rejects.toThrow('KEY_EXPIRED');
  }finally{await store.close();await rm(d,{recursive:true,force:true});}
});
test('100MiB effective-page budget excludes freelist and detects actual pressure without deleting active state',async()=>{
  const d=await mkdtemp(join(tmpdir(),'schedule-budget-')),path=join(d,'db'),store=await openStore(path,()=>clock());
  try{
    const db=new DatabaseSync(path);db.exec("INSERT INTO settings VALUES('large',json_object('value',hex(zeroblob(53*1024*1024))))");
    expect((await store.maintenance()).pressure).toBe(true);
    await expect(store.begin({idempotencyKey:key(),title:'pressure'},source())).rejects.toThrow('STORAGE_PRESSURE');
    db.exec("DELETE FROM settings WHERE key='large'");db.close();
    const result=await store.maintenance();expect(result.pressure).toBe(false);expect(result.effectiveBytes).toBeLessThan(104857600);
  }finally{await store.close();await rm(d,{recursive:true,force:true});}
},20000);

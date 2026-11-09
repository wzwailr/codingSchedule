import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATABASE_VERSION,migrate } from './migrations.js';
export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000');
    const version=Number(db.prepare('PRAGMA user_version').get()!.user_version);
    if(path!==':memory:'&&version>0&&version<DATABASE_VERSION){
      const backups=join(dirname(path),'backups');mkdirSync(backups,{recursive:true});
      // SQLite takes a consistent snapshot including committed WAL pages. A failed
      // backup aborts the upgrade; never fall back to copying just the main file.
      db.prepare('VACUUM INTO ?').run(join(backups,`before-v${version}-${Date.now()}-${randomUUID()}.sqlite`));
    }
    migrate(db);
    return db;
  } catch (error) { db.close(); throw error; }
}
export function transaction<T>(db: DatabaseSync, action: () => T): T {
  if (db.isTransaction) return action(); // An outer collector transaction owns rollback and COMMIT.
  db.exec('BEGIN IMMEDIATE');
  try { const result = action(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

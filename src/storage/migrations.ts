import type { DatabaseSync } from 'node:sqlite';
import { fail } from '../shared/errors.js';
export const DATABASE_VERSION = 5;
export function migrate(db: DatabaseSync): void {
  const version = Number(db.prepare('PRAGMA user_version').get()!.user_version);
  if (version > DATABASE_VERSION) fail('UNSUPPORTED_DATABASE_VERSION', 503);
  if (version === DATABASE_VERSION) return;
  db.exec('BEGIN IMMEDIATE');
  try {
  if (version === 0) db.exec(`
    CREATE TABLE runs (
      run_id TEXT PRIMARY KEY, generation INTEGER NOT NULL, owner_connector TEXT NOT NULL,
      source_id TEXT NOT NULL, provider TEXT NOT NULL, session_key TEXT,
      resume_hash TEXT NOT NULL, state_json TEXT NOT NULL, updated_at INTEGER NOT NULL,
      terminal_at INTEGER
    );
    CREATE TABLE source_bindings (
      session_key TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(run_id),
      generation INTEGER NOT NULL
    );
    CREATE TABLE source_sequences (
      run_id TEXT NOT NULL REFERENCES runs(run_id), source_id TEXT NOT NULL,
      seq INTEGER NOT NULL, PRIMARY KEY(run_id, source_id)
    );
    CREATE TABLE events (
      event_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(run_id),
      source_id TEXT NOT NULL, seq INTEGER NOT NULL, event_index INTEGER NOT NULL,
      call_key TEXT UNIQUE, event_json TEXT NOT NULL,
      UNIQUE(run_id, source_id, seq, event_index)
    );
    CREATE TABLE report_receipts (
      connector_id TEXT NOT NULL, report_id TEXT NOT NULL, run_id TEXT NOT NULL REFERENCES runs(run_id),
      body_hash TEXT NOT NULL, ack_json TEXT NOT NULL, issued_at INTEGER NOT NULL,
      PRIMARY KEY(connector_id, report_id)
    );
    CREATE TABLE begin_receipts (
      connector_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      body_hash TEXT NOT NULL, handle_json TEXT NOT NULL, issued_at INTEGER NOT NULL,
      PRIMARY KEY(connector_id, idempotency_key)
    );
    CREATE TABLE file_cursors (
      path_key TEXT PRIMARY KEY, file_generation TEXT NOT NULL,
      committed_offset INTEGER NOT NULL, pending_bytes BLOB NOT NULL
    );
    CREATE TABLE parser_checkpoints (
      path_key TEXT PRIMARY KEY REFERENCES file_cursors(path_key), state_json TEXT NOT NULL
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
    CREATE INDEX events_run ON events(run_id);
    PRAGMA user_version=1;
  `);
  if (version < 2) db.exec(`
    CREATE TABLE native_runs (session_key TEXT NOT NULL, turn_id TEXT NOT NULL, run_id TEXT NOT NULL REFERENCES runs(run_id), handle_json TEXT NOT NULL, complete_replay INTEGER NOT NULL, PRIMARY KEY(session_key,turn_id));
    CREATE TABLE source_links (provider TEXT NOT NULL, session_id TEXT NOT NULL, turn_id TEXT NOT NULL, run_id TEXT NOT NULL REFERENCES runs(run_id), generation INTEGER NOT NULL, PRIMARY KEY(provider,session_id,turn_id));
    PRAGMA user_version=2;`);
  if(version<3)db.exec('ALTER TABLE file_cursors ADD COLUMN fingerprint TEXT;PRAGMA user_version=3;');
  // v4 adds ETA request/answer state and event payloads. Older readers must refuse it.
  if(version<4)db.exec('PRAGMA user_version=4;');
  if(version<5)db.exec(`CREATE TABLE native_binding_receipts (
    token_hash TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,generation INTEGER NOT NULL,
    provider TEXT NOT NULL,session_id TEXT NOT NULL,turn_id TEXT NOT NULL,item_id TEXT,call_id TEXT,expires_at INTEGER NOT NULL
  );CREATE INDEX binding_expiry ON native_binding_receipts(expires_at);PRAGMA user_version=5;`);
  db.exec('COMMIT');
  } catch(error) { if(db.isTransaction)db.exec('ROLLBACK'); throw error; }
}

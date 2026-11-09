import {prepared} from './statements.js';
import type { EventBatch, FileCursor, ParserState } from '../shared/contracts.js';
import type { DatabaseSync } from 'node:sqlite';
import { fail } from '../shared/errors.js';
export function validateCursor(cursor: FileCursor): void {
  if(cursor.fingerprint!==undefined&&(typeof cursor.fingerprint!=='string'||!/^[0-9a-f]{64}$/.test(cursor.fingerprint)))fail('INVALID_CURSOR',400);
  if (!cursor.pathKey || cursor.pathKey.length > 1024 || !cursor.fileGeneration || cursor.fileGeneration.length > 256 ||
    !Number.isSafeInteger(cursor.committedOffset) || cursor.committedOffset < 0 ||
    !(cursor.pendingBytes instanceof Uint8Array) || cursor.pendingBytes.byteLength > 1_048_576) fail('INVALID_CURSOR', 400);
}
export function boundedCheckpoint(batch: EventBatch): ParserState | null {
  if (!batch.parserCheckpoint) return null;
  if (!batch.cursor) fail('CHECKPOINT_REQUIRES_CURSOR', 400);
  const state = structuredClone(batch.parserCheckpoint);
  if (!Number.isSafeInteger(state.nativePlanRevision) || state.nativePlanRevision < 0 ||
    typeof state.completePlan !== 'boolean' || !(state.currentTurnId === null || typeof state.currentTurnId === 'string') ||
    !state.pendingCalls || typeof state.pendingCalls !== 'object' || Array.isArray(state.pendingCalls)) fail('INVALID_CHECKPOINT', 400);
  const entries = Object.entries(state.pendingCalls);
  for (const [, call] of entries) {
    if (!call || typeof call.name !== 'string' || !Number.isSafeInteger(call.offset) || call.offset < 0) fail('INVALID_CHECKPOINT', 400);
  }
  entries.sort(([, a], [, b]) => a.offset - b.offset);
  while (entries.length > 200) { entries.shift(); state.completePlan = false; }
  state.pendingCalls = Object.fromEntries(entries);
  while (Buffer.byteLength(JSON.stringify(state)) > 262_144 && entries.length) {
    entries.shift(); state.completePlan = false; state.pendingCalls = Object.fromEntries(entries);
  }
  if (Buffer.byteLength(JSON.stringify(state)) > 262_144) fail('INVALID_CHECKPOINT', 400);
  return state;
}
export function saveCheckpoint(db: DatabaseSync, batch: EventBatch, state: ParserState | null): void {
  if (!batch.cursor) return;
  const c = batch.cursor;
  const old = prepared(db,'SELECT * FROM file_cursors WHERE path_key=?').get(c.pathKey);
  const expected = batch.expectedCursor;
  if (expected !== undefined && (old ? expected === null || expected.fileGeneration !== old.file_generation || expected.committedOffset !== old.committed_offset : expected !== null)) fail('CURSOR_CONFLICT');
  if (old) {
    if (old.file_generation !== c.fileGeneration && !expected) fail('CURSOR_CONFLICT');
    if (old.file_generation === c.fileGeneration && (c.committedOffset < Number(old.committed_offset) ||
      (c.committedOffset === Number(old.committed_offset) && c.pendingBytes.byteLength < (old.pending_bytes as Uint8Array).byteLength))) fail('STALE_CURSOR');
  }
  prepared(db,'INSERT INTO file_cursors(path_key,file_generation,committed_offset,pending_bytes,fingerprint) VALUES(?,?,?,?,?) ON CONFLICT(path_key) DO UPDATE SET file_generation=excluded.file_generation,committed_offset=excluded.committed_offset,pending_bytes=excluded.pending_bytes,fingerprint=excluded.fingerprint')
    .run(c.pathKey, c.fileGeneration, c.committedOffset, c.pendingBytes,c.fingerprint??null);
  if (state) prepared(db,'INSERT INTO parser_checkpoints VALUES(?,?) ON CONFLICT(path_key) DO UPDATE SET state_json=excluded.state_json').run(c.pathKey, JSON.stringify(state));
  else prepared(db,'DELETE FROM parser_checkpoints WHERE path_key=?').run(c.pathKey);
}

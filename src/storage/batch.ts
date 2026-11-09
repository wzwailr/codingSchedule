import { createHash } from 'node:crypto';
import type { EventBatch } from '../shared/contracts.js';
function ordered(value: unknown): unknown {
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, ordered(v)]));
  return value;
}
export function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex'); }
export function hashBatch(batch: EventBatch): string {
  return digest({
    events: batch.events.map((e) => ({ run: e.run, provider: e.provider, seq: e.seq, eventIndex: e.eventIndex, payload: e.payload,
      nativeSessionId: e.nativeSessionId, turnId: e.turnId, nativeCallId: e.nativeCallId })),
    cursor: batch.cursor, parserCheckpoint: batch.parserCheckpoint, expectedCursor: batch.expectedCursor,
  });
}

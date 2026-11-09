import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../../src/storage/repository.js';
import { hashBatch } from '../../src/storage/batch.js';
import type { EventBatch, EventPayload, RunHandle, Store, TrustedSource } from '../../src/shared/contracts.js';
import { clock, event, key, NOW, plan, source, step } from '../helpers.js';
let directory: string, dbPath: string, store: Store;
let tick = 0;
const owner = source();
async function begin(input = { idempotencyKey: key(), title: 'Task' }, src = owner) { return store.begin(input, src); }
async function batch(handle: RunHandle, payloads: EventPayload[], options: { seq?: number; reportId?: string; source?: TrustedSource } = {}): Promise<EventBatch> {
  const seq = options.seq ?? (await store.context(handle, options.source || owner)).nextSeq;
  const result: EventBatch = { handle, events: payloads.map((payload, eventIndex) => event(payload, { run: { runId: handle.runId, generation: handle.generation }, seq, eventIndex })) };
  result.receipt = { reportId: options.reportId || key(), bodyHash: hashBatch(result) };
  return result;
}
function count(table: string): number {
  const db = new DatabaseSync(dbPath);
  try { return Number(db.prepare('SELECT count(*) AS n FROM ' + table).get()!.n); } finally { db.close(); }
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'codingSchedule-test-'));
  dbPath = join(directory, 'state.db'); tick = 0;
  store = await openStore(dbPath, () => clock(NOW + tick, tick));
});
afterEach(async () => { await store?.close(); await rm(directory, { recursive: true, force: true }); });
describe('transactional task repository', () => {
  it('returns the same handle for a begin retry and rejects changed content', async () => {
    const input = { idempotencyKey: key(), title: 'one' };
    const first = await begin(input);
    expect(await begin(input)).toEqual(first);
    await expect(begin({ ...input, title: 'changed' })).rejects.toThrow(/IDEMPOTENCY_CONFLICT/);
    expect(count('runs')).toBe(1);
  });
  it('creates independent generic tasks and performs a full native session CAS', async () => {
    const a = await begin(), b = await begin();
    expect(a.runId).not.toBe(b.runId);
    const native = { ...owner, nativeSessionId: 'session-one' };
    const results = await Promise.allSettled([
      store.begin({ idempotencyKey: key(), title: 'a', expectedRun: null }, native),
      store.begin({ idempotencyKey: key(), title: 'b', expectedRun: null }, native),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const winner = results.find((r) => r.status === 'fulfilled')!;
    if (winner.status !== 'fulfilled') throw new Error('No winner');
    await expect(store.begin({ idempotencyKey: key(), title: 'bad', expectedRun: { runId: winner.value.runId, generation: 99 } }, native)).rejects.toThrow(/HEAD_CONFLICT/);
    const next = await store.begin({ idempotencyKey: key(), title: 'new task', expectedRun: { runId: winner.value.runId, generation: winner.value.generation } }, native);
    expect(next.runId).not.toBe(winner.value.runId);
    expect(next.generation).toBe(2);
  });
  it('does not cross connectors or accept forged handle generations', async () => {
    const handle = await begin();
    await expect(store.context(handle, source('other'))).rejects.toThrow(/FORBIDDEN/);
    await expect(store.context({ ...handle, resumeHandle: 'f'.repeat(43) }, owner)).rejects.toThrow(/FORBIDDEN/);
    await expect(store.context({ ...handle, generation: 2 }, owner)).rejects.toThrow(/RUN_MISMATCH/);
    const missing = await batch(handle, [{ type: 'activity.updated', activity: 'must not create a run' }]);
    missing.handle = { ...handle, runId: 'does-not-exist' };
    missing.events[0]!.run.runId = 'does-not-exist';
    missing.receipt!.bodyHash = hashBatch(missing);
    await expect(store.commit(missing, owner)).rejects.toThrow(/RUN_GONE/);
    expect(count('runs')).toBe(1);
  });
  it('commits a report exactly once even when the ACK is retried later', async () => {
    const handle = await begin();
    const report = await batch(handle, [{ type: 'activity.updated', activity: 'testing' }, { type: 'run.status', status: 'waiting' }]);
    expect(await store.commit(report, owner)).toMatchObject({ accepted: true, duplicate: false });
    tick = 10_000;
    const oldCount = count('events');
    expect(await store.commit(report, { ...owner, sourceInstanceId: 'reconnected' })).toMatchObject({ duplicate: true });
    expect(count('events')).toBe(oldCount);
    expect((await store.context(handle, owner)).snapshot.lastWorkAt).toBe(NOW);
    const altered = await batch(handle, [{ type: 'activity.updated', activity: 'changed' }], { seq: report.events[0]!.seq, reportId: report.receipt!.reportId });
    await expect(store.commit(altered, owner)).rejects.toThrow(/IDEMPOTENCY_CONFLICT/);
  });
  it('rolls back all events, sequence, receipts and cursor if a later event fails', async () => {
    const handle = await begin();
    const before = (await store.context(handle, owner)).nextSeq;
    const report = await batch(handle, [{ type: 'activity.updated', activity: 'must not persist' }, { type: 'step.updated', revision: 7, step: step('missing') }]);
    report.cursor = { pathKey: 'log-one', fileGeneration: 'file-1', committedOffset: 42, pendingBytes: new Uint8Array() };
    report.receipt!.bodyHash = hashBatch(report);
    const oldCount = count('events');
    await expect(store.commit(report, owner)).rejects.toThrow();
    expect(count('events')).toBe(oldCount);
    expect(await store.checkpoint('log-one')).toBeNull();
    expect((await store.context(handle, owner)).nextSeq).toBe(before);
    expect((await store.context(handle, owner)).snapshot.activity).toBeNull();
    expect(count('report_receipts')).toBe(0);
  });
  it('does not let a changed transport bypass sequence or forge verification', async () => {
    const handle = await begin();
    const seq = (await store.context(handle, owner)).nextSeq;
    await store.commit(await batch(handle, [{ type: 'activity.updated', activity: 'first' }], { seq }), owner);
    await expect(store.commit(await batch(handle, [{ type: 'activity.updated', activity: 'late' }], { seq }), { ...owner, sourceInstanceId: 'new-connection' })).rejects.toThrow(/STALE_SEQUENCE/);
    await expect(store.commit(await batch(handle, [{ type: 'completion.verified', summary: 'forged', evidenceRef: 'fake' }]), owner)).rejects.toThrow(/FORBIDDEN/);
  });
  it('atomically persists bounded parser checkpoints with byte cursors', async () => {
    const handle = await begin();
    const report = await batch(handle, [{ type: 'activity.updated', activity: 'reading' }]);
    report.cursor = { pathKey: 'log-one', fileGeneration: 'f1', committedOffset: 19, pendingBytes: Uint8Array.from([0xe6, 0xb1]) };
    report.parserCheckpoint = { currentTurnId: 'turn', nativePlanRevision: 1, completePlan: true, pendingCalls: { call1: { name: 'TaskGet', input: { id: 'one' }, offset: 2 } } };
    report.receipt!.bodyHash = hashBatch(report);
    await store.commit(report, owner);
    await store.close();
    store = await openStore(dbPath, () => clock(NOW + 60_000, 0, 'new'));
    const checkpoint = await store.checkpoint('log-one');
    expect(checkpoint?.cursor.pendingBytes).toEqual(Uint8Array.from([0xe6, 0xb1]));
    expect(checkpoint?.parserCheckpoint?.pendingCalls.call1?.name).toBe('TaskGet');
    const resumed = await store.context(handle, owner);
    expect(resumed.snapshot.status).toBe('paused');
    expect(resumed.snapshot.lastWorkAt).toBe(NOW);
    const next = await batch(handle, [{ type: 'activity.updated', activity: 'matched result' }]);
    next.cursor = { ...report.cursor, committedOffset: 31, pendingBytes: new Uint8Array() };
    next.parserCheckpoint = { ...report.parserCheckpoint, pendingCalls: {} };
    next.receipt!.bodyHash = hashBatch(next);
    await store.commit(next, owner);
    expect((await store.checkpoint('log-one'))?.parserCheckpoint?.pendingCalls).toEqual({});
  });
  it('marks oversized pending-call checkpoints partial without retaining unbounded input', async () => {
    const handle = await begin();
    const report = await batch(handle, [{ type: 'activity.updated', activity: 'bounded' }]);
    report.cursor = { pathKey: 'large', fileGeneration: 'f', committedOffset: 10, pendingBytes: new Uint8Array() };
    report.parserCheckpoint = { currentTurnId: 't', nativePlanRevision: 1, completePlan: true, pendingCalls: { huge: { name: 'TaskGet', input: 'x'.repeat(270_000), offset: 0 } } };
    report.receipt!.bodyHash = hashBatch(report);
    await store.commit(report, owner);
    const saved = (await store.checkpoint('large'))!.parserCheckpoint!;
    expect(saved.completePlan).toBe(false);
    expect(Buffer.byteLength(JSON.stringify(saved))).toBeLessThanOrEqual(262_144);
  });
  it('allows terminal receipt retry but not resurrection or an expired begin key', async () => {
    const input = { idempotencyKey: key(), title: 'task' };
    const handle = await begin(input);
    await store.commit(await batch(handle, [{ type: 'plan.replaced', plan: plan([step('a', 'completed')]) }]), owner);
    const finish = await batch(handle, [{ type: 'completion.reported', summary: 'done' }]);
    await store.commit(finish, owner);
    expect(await store.commit(finish, owner)).toMatchObject({ duplicate: true });
    await expect(store.commit(await batch(handle, [{ type: 'run.status', status: 'active' }]), owner)).rejects.toThrow(/TERMINAL/);
    tick = 86_400_001;
    await expect(begin(input)).rejects.toThrow(/KEY_EXPIRED/);
  });
  it('rejects event-id reuse with changed content even under a new receipt', async () => {
    const handle = await begin();
    const first = await batch(handle, [{ type: 'activity.updated', activity: 'first' }]);
    await store.commit(first, owner);
    const changed = await batch(handle, [{ type: 'activity.updated', activity: 'changed' }]);
    changed.events[0]!.eventId = first.events[0]!.eventId;
    changed.receipt!.bodyHash = hashBatch(changed);
    await expect(store.commit(changed, owner)).rejects.toThrow(/EVENT_ID_CONFLICT/);
  });
  it('uses the same passive plan owner and sequence from begin to later replacements', async () => {
    const native = { ...source('native', 'transcript'), nativeSessionId: 'session' };
    const handle = await store.begin({ idempotencyKey: key(), title: 'passive', expectedRun: null, plan: plan([step('a')]) }, native);
    const seq = (await store.context(handle, native)).nextSeq;
    const replacement = event({ type: 'plan.replaced', plan: plan([step('a', 'completed')], 2) }, { run: { runId: handle.runId, generation: handle.generation }, sourceKind: 'transcript', nativeSessionId: 'session', seq });
    await store.commit({ events: [replacement] }, native);
    const result = await store.context(handle, native);
    expect(result.snapshot.plan?.revision).toBe(2);
    expect(result.snapshot.progress.value).toBe(100);
    expect(result.nextSeq).toBe(seq + 1);
  });
  it('saves checkpoint-only native input without inventing task activity', async () => {
    const native = { ...source('native', 'transcript'), nativeSessionId: 'checkpoint-session' };
    const data: EventBatch = {
      events: [], cursor: { pathKey: 'only-input', fileGeneration: 'one', committedOffset: 22, pendingBytes: Uint8Array.from([0xe6]) },
      parserCheckpoint: { currentTurnId: null, nativePlanRevision: 0, completePlan: false, pendingCalls: { call: { name: 'TaskGet', input: { id: 'a' }, offset: 0 } } },
    };
    await store.commit(data, native);
    expect(await store.listSnapshots()).toEqual([]);
    await store.close(); store = await openStore(dbPath, () => clock());
    expect((await store.checkpoint('only-input'))?.parserCheckpoint?.pendingCalls.call?.name).toBe('TaskGet');
    await store.commit({ ...data, cursor: { ...data.cursor!, committedOffset: 30, pendingBytes: new Uint8Array() }, parserCheckpoint: { ...data.parserCheckpoint!, pendingCalls: {} } }, native);
    expect((await store.checkpoint('only-input'))?.parserCheckpoint?.pendingCalls).toEqual({});
    await expect(store.commit(data, owner)).rejects.toThrow(/FORBIDDEN/);
  });
  it('commits fresh checkpoints beside duplicate native events, without rewinding cursors', async () => {
    const native = { ...source('native', 'transcript'), nativeSessionId: 'session' };
    const handle = await store.begin({ idempotencyKey: key(), title: 'passive', expectedRun: null }, native);
    const seq = (await store.context(handle, native)).nextSeq;
    const item = event({ type: 'activity.updated', activity: 'observed' }, { run: { runId: handle.runId, generation: handle.generation }, sourceKind: 'transcript', nativeSessionId: 'session', seq });
    await store.commit({ events: [item] }, native);
    tick = 10_000;
    const duplicate: EventBatch = { events: [item], cursor: { pathKey: 'dup', fileGeneration: 'old', committedOffset: 80, pendingBytes: new Uint8Array() }, parserCheckpoint: { currentTurnId: 't', nativePlanRevision: 0, completePlan: false, pendingCalls: {} } };
    expect(await store.commit(duplicate, native)).toMatchObject({ duplicate: true });
    expect((await store.checkpoint('dup'))?.cursor.committedOffset).toBe(80);
    expect((await store.context(handle, native)).snapshot.lastWorkAt).toBe(NOW);
    await expect(store.commit({ ...duplicate, cursor: { ...duplicate.cursor!, committedOffset: 20 } }, native)).rejects.toThrow(/STALE_CURSOR/);
    const rotated = { ...duplicate, cursor: { ...duplicate.cursor!, fileGeneration: 'new', committedOffset: 10 }, expectedCursor: { fileGeneration: 'old', committedOffset: 80 } };
    await store.commit(rotated, native);
    await expect(store.commit(duplicate, native)).rejects.toThrow(/CURSOR_CONFLICT/);
    expect((await store.checkpoint('dup'))?.cursor.fileGeneration).toBe('new');
  });
});

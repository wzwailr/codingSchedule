import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildSync } from 'esbuild';
import { openStore } from '../../src/storage/repository.js';
import { hashBatch } from '../../src/storage/batch.js';
import type { EventBatch, RunHandle, Store } from '../../src/shared/contracts.js';
import { clock, event, key, NOW, source } from '../helpers.js';
const children: ChildProcess[] = [];
let directory: string, path: string, store: Store | undefined;
function message(child: ChildProcess): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Child IPC timeout')), 10_000);
    child.once('message', (data) => { clearTimeout(timer); resolve(data as Record<string, unknown>); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
}
async function worker(): Promise<ChildProcess> {
  const child = fork(resolve('tests/fixtures/storage-child.mjs'), [path, String(NOW)], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
  children.push(child);
  expect(await message(child)).toEqual({ ready: true });
  return child;
}
beforeAll(() => {
  buildSync({ entryPoints: ['src/storage/repository.ts'], outfile: '.artifacts/storage-test/repository.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node24' });
});
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'codingSchedule-crash-')); path = join(directory, 'state.db');
});
afterEach(async () => {
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
  await store?.close(); store = undefined;
  await rm(directory, { recursive: true, force: true });
});
describe('independent process guarantees', () => {
  it('survives a writer killed after COMMIT and before a business ACK', async () => {
    const owner = source();
    store = await openStore(path, () => clock());
    const handle = await store.begin({ idempotencyKey: key(), title: 'crash-safe' }, owner);
    const seq = (await store.context(handle, owner)).nextSeq;
    await store.close(); store = undefined;
    const child = await worker();
    const batch: EventBatch = { handle, events: [event({ type: 'activity.updated', activity: 'persist before ACK' }, { run: { runId: handle.runId, generation: handle.generation }, seq })] };
    batch.receipt = { reportId: key(), bodyHash: hashBatch(batch) };
    const committed = message(child);
    child.send({ operation: 'commit-without-ack', batch, source: owner });
    expect(await committed).toEqual({ committed: true });
    const exited = once(child, 'exit'); child.kill(); await exited;
    store = await openStore(path, () => clock(NOW + 10_000, 0, 'after-crash'));
    expect((await store.context(handle, owner)).snapshot.activity).toBe('persist before ACK');
    expect(await store.commit(batch, { ...owner, sourceInstanceId: 'new-process' })).toMatchObject({ duplicate: true });
    const db = new DatabaseSync(path);
    expect(db.prepare('SELECT count(*) AS n FROM events').get()!.n).toBe(2);
    db.close();
  });
  it('permits exactly one native-session begin across two processes', async () => {
    store = await openStore(path, () => clock()); await store.close(); store = undefined;
    const first = await worker(), second = await worker();
    const sourceContext = { ...source(), nativeSessionId: 'same-native-session' };
    const p1 = message(first), p2 = message(second);
    first.send({ operation: 'begin', input: { idempotencyKey: key(), title: 'one', expectedRun: null }, source: sourceContext });
    second.send({ operation: 'begin', input: { idempotencyKey: key(), title: 'two', expectedRun: null }, source: sourceContext });
    const results = await Promise.all([p1, p2]);
    expect(results.filter((r) => r.ok === true)).toHaveLength(1);
    expect(results.find((r) => r.ok === false)?.error).toMatch(/HEAD_CONFLICT/);
    const winner = results.find((r) => r.ok === true)!.handle as RunHandle;
    expect(winner.generation).toBe(1);
  });
});

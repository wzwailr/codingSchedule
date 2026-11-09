import { mkdtemp, writeFile, appendFile, rm, rename, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { readTail, READ_LIMITS } from '../../src/adapters/common/tail-reader.js';
const dirs: string[] = [];
async function file() { const d = await mkdtemp(join(tmpdir(), 'schedule-tail-')); dirs.push(d); return join(d, 'log.jsonl'); }
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
test('UTF8 and CRLF split across appends survive restart cursor', async () => {
  const p = await file(), bytes = Buffer.from('{"字":"汉"}\r\n');
  await writeFile(p, bytes.subarray(0, 8));
  const a = await readTail(p, null, READ_LIMITS); expect(a.lines).toEqual([]);
  await appendFile(p, bytes.subarray(8, bytes.length - 1));
  const b = await readTail(p, a.nextCursor, READ_LIMITS); expect(b.lines).toEqual([]);
  await appendFile(p, '\n'); const c = await readTail(p, b.nextCursor, READ_LIMITS);
  expect(c.lines).toEqual([{ text: '{"字":"汉"}', offset: 0 }]); expect(c.nextCursor.pendingBytes.length).toBe(0);
});
test('oversized line suffix never becomes a fabricated valid record', async () => {
  const p = await file(); await writeFile(p, 'x'.repeat(READ_LIMITS.lineBytes + 80));
  let b = await readTail(p, null, READ_LIMITS); b = await readTail(p, b.nextCursor, READ_LIMITS);
  await appendFile(p, '{"fake":true}\n{"ok":true}\n'); b = await readTail(p, b.nextCursor, READ_LIMITS);
  expect(b.lines.map(l => l.text)).toEqual(['{"ok":true}']); expect(b.partial).toBe(true);
});
test('truncate and replacement allocate new generations; unchanged read is empty', async () => {
  const p = await file(); await writeFile(p, 'original\n'); const a = await readTail(p, null, READ_LIMITS);
  expect((await readTail(p, a.nextCursor, READ_LIMITS)).lines).toEqual([]);
  await writeFile(p, 'x\n'); const b = await readTail(p, a.nextCursor, READ_LIMITS);
  expect(b.nextCursor.fileGeneration).not.toBe(a.nextCursor.fileGeneration);
  await rename(p, p + '.old'); await writeFile(p, 'y\n'); const c = await readTail(p, b.nextCursor, READ_LIMITS);
  expect(c.nextCursor.fileGeneration).not.toBe(b.nextCursor.fileGeneration); expect(c.lines[0]?.text).toBe('y');
});
test('100MiB cold read is bounded and incremental reads at most 1MiB', async () => {
  const p = await file(); const f = await open(p, 'w'); await f.truncate(100 * 1024 * 1024); await f.close();
  await appendFile(p, '\n{"ok":true}\n'); const a = await readTail(p, null, READ_LIMITS);
  expect(a.bytesRead).toBeLessThanOrEqual(READ_LIMITS.tailBytes + READ_LIMITS.batchBytes);
  expect(a.ioBytes).toBeLessThanOrEqual(READ_LIMITS.tailBytes + READ_LIMITS.batchBytes);
  expect(a.lines.map(l => l.text)).toEqual(['{"ok":true}']); expect(a.partial).toBe(true);
  await appendFile(p, 'a'.repeat(2 * READ_LIMITS.batchBytes)); const b = await readTail(p, a.nextCursor, READ_LIMITS);
  expect(b.bytesRead).toBeLessThanOrEqual(READ_LIMITS.batchBytes);
  expect(b.ioBytes).toBeLessThanOrEqual(READ_LIMITS.batchBytes);
});
test('same inode truncate+regrow between polls detects equal and longer replacements without mixing pending bytes',async()=>{
  const p=await file();await writeFile(p,'{"old":1}\n');const a=await readTail(p,null,READ_LIMITS);
  await writeFile(p,'{"new":2}\n');const b=await readTail(p,a.nextCursor,READ_LIMITS);
  expect(b.nextCursor.fileGeneration).not.toBe(a.nextCursor.fileGeneration);expect(b.lines.map(l=>l.text)).toEqual(['{"new":2}']);
  await appendFile(p,'{"partial":');const c=await readTail(p,b.nextCursor,READ_LIMITS);
  await writeFile(p,'{"other":3}\n{"longer":"replacement"}\n');const d=await readTail(p,c.nextCursor,READ_LIMITS);
  expect(d.nextCursor.fileGeneration).not.toBe(c.nextCursor.fileGeneration);expect(d.lines.map(l=>l.text)).toEqual(['{"other":3}','{"longer":"replacement"}']);
});

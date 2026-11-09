import { open } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import type { FileCursor } from '../../shared/contracts.js';
export type ReadLimits = { batchBytes: number; tailBytes: number; lineBytes: number };
export const READ_LIMITS: ReadLimits = { batchBytes: 1_048_576, tailBytes: 8_388_608, lineBytes: 1_048_576 };
export type TailBatch = { lines: Array<{ text: string; offset: number }>; nextCursor: FileCursor; partial: boolean; skippedLines: number; bytesRead: number; ioBytes:number };
export async function readTail(path: string, cursor: FileCursor | null, limits = READ_LIMITS): Promise<TailBatch> {
  const file = await open(path, 'r');
  try {
    const s = await file.stat();
    const identity = `${s.dev}-${s.ino}-${s.birthtimeMs}:`;
    let ioBytes=0;
    async function fingerprint(offset:number):Promise<string>{
      const n=Math.min(128,offset),head=Buffer.alloc(n),tail=Buffer.alloc(n);
      const a=await file.read(head,0,n,0),b=await file.read(tail,0,n,Math.max(0,offset-n));ioBytes+=a.bytesRead+b.bytesRead;
      return createHash('sha256').update(head.subarray(0,a.bytesRead)).update(tail.subarray(0,b.bytesRead)).digest('hex');
    }
    const changed=cursor?.fingerprint&&s.size>=cursor.committedOffset&&cursor.fingerprint!==await fingerprint(cursor.committedOffset);
    const reset = !cursor || !cursor.fileGeneration.startsWith(identity) || s.size < cursor.committedOffset || !!changed;
    const start = reset ? Math.max(0, s.size - limits.tailBytes) : cursor.committedOffset;
    const generation = reset ? identity + randomUUID() : cursor.fileGeneration;
    const pending = reset ? Buffer.alloc(0) : Buffer.from(cursor.pendingBytes);
    let discarding = start > 0 && reset || pending.length === 1 && pending[0] === 0;
    const oldBytes = discarding ? Buffer.alloc(0) : pending;
    const size = Math.min(s.size - start, reset ? limits.tailBytes : Math.max(1,limits.batchBytes-512));
    const buffer = Buffer.alloc(size);
    const { bytesRead } = await file.read(buffer, 0, size, start);
    const all = Buffer.concat([oldBytes, buffer.subarray(0, bytesRead)]);
    const base = start - oldBytes.length;
    const lines: TailBatch['lines'] = [];
    let from = 0, skippedLines = 0, partial = reset && start > 0 || discarding;
    for (let i = 0; i < all.length; i++) {
      if (all[i] !== 10) continue;
      if (discarding || i - from > limits.lineBytes) { skippedLines++; partial = true; }
      else { const end = i > from && all[i - 1] === 13 ? i - 1 : i; if (end > from) lines.push({ text: all.subarray(from, end).toString('utf8'), offset: base + from }); }
      discarding = false; from = i + 1;
    }
    if (all.length - from > limits.lineBytes) { discarding = true; partial = true; }
    const pendingBytes = discarding ? new Uint8Array([0]) : new Uint8Array(all.subarray(from));
    const stamp=await fingerprint(start+bytesRead);ioBytes+=bytesRead;
    return { lines, nextCursor: { pathKey: createHash('sha256').update(path).digest('hex'), fileGeneration: generation, committedOffset: start + bytesRead, pendingBytes,fingerprint:stamp }, partial, skippedLines, bytesRead,ioBytes };
  } finally { await file.close(); }
}

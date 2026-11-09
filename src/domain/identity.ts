import { randomBytes, createHash } from 'node:crypto';
import type { RunRef, TrustedSource } from '../shared/contracts.js';
import { fail } from '../shared/errors.js';
export function createUuid7(now: number): string {
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffffffffffff) fail('INVALID_TIME', 400);
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = (bytes[6]! & 15) | 0x70;
  bytes[8] = (bytes[8]! & 63) | 0x80;
  const h = bytes.toString('hex');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
}
export function assertFreshKey(value: string, now: number): void {
  if (!Number.isFinite(now) || !/^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) fail('INVALID_KEY', 400);
  const issued = Number.parseInt(value.replaceAll('-', '').slice(0, 12), 16);
  if (now - issued > 86_400_000) fail('KEY_EXPIRED', 410);
  if (issued - now > 300_000) fail('KEY_IN_FUTURE', 400);
}
export function sessionKey(source: TrustedSource): string | null {
  return source.nativeSessionId ? createHash('sha256').update(JSON.stringify([source.provider, source.nativeSessionId])).digest('hex') : null;
}
export function assertExpectedHead(head: RunRef | null, expected: RunRef | null | undefined): void {
  if (expected === undefined || (head === null ? expected !== null : expected === null || head.runId !== expected.runId || head.generation !== expected.generation)) fail('HEAD_CONFLICT');
}

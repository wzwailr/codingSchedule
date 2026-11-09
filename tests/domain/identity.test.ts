import { describe, expect, it } from 'vitest';
import { assertExpectedHead, assertFreshKey, createUuid7, sessionKey } from '../../src/domain/identity.js';
import { key, NOW, source } from '../helpers.js';
describe('task identity', () => {
  it('creates unique UUIDv7 task identities and enforces the replay window', () => {
    const a = createUuid7(NOW), b = createUuid7(NOW);
    expect(a).not.toBe(b);
    expect(() => assertFreshKey(a, NOW)).not.toThrow();
    expect(() => assertFreshKey(key(NOW - 86_400_001), NOW)).toThrow(/EXPIRED/);
    expect(() => assertFreshKey(key(NOW + 300_001), NOW)).toThrow(/FUTURE/);
    expect(() => assertFreshKey('not-a-uuid', NOW)).toThrow();
  });
  it('requires the full RunRef for compare-and-swap', () => {
    const head = { runId: 'a', generation: 2 };
    expect(() => assertExpectedHead(head, { ...head })).not.toThrow();
    expect(() => assertExpectedHead(head, { ...head, generation: 1 })).toThrow(/HEAD_CONFLICT/);
    expect(() => assertExpectedHead(head, null)).toThrow(/HEAD_CONFLICT/);
    expect(() => assertExpectedHead(null, null)).not.toThrow();
    expect(() => assertExpectedHead(null, undefined)).toThrow(/HEAD_CONFLICT/);
  });
  it('does not merge generic tasks or different native sessions by transport or cwd', () => {
    expect(sessionKey(source())).toBeNull();
    const a = { ...source(), nativeSessionId: 'one' };
    expect(sessionKey(a)).toBe(sessionKey({ ...a, sourceInstanceId: 'new-process' }));
    expect(sessionKey(a)).not.toBe(sessionKey({ ...a, nativeSessionId: 'two' }));
  });
});

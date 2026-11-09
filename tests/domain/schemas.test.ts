import { describe, expect, it } from 'vitest';
import { validateBegin, validateReport, validateFinish, validatePlan } from '../../src/shared/schemas.js';
import { key, NOW, plan, step } from '../helpers.js';
const handle = { runId: 'run', generation: 1, resumeHandle: 'x'.repeat(43) };
describe('untrusted reporting contracts', () => {
  it('validates titles and plan bounds', () => {
    expect(validateBegin({ idempotencyKey: key(), title: ' 开发任务 ' }, NOW).title).toBe('开发任务');
    expect(() => validatePlan(plan(Array.from({ length: 101 }, (_, i) => step(String(i)))))).toThrow();
    expect(() => validatePlan(plan([step('a'), step('a')]))).toThrow();
    for (const n of [NaN, Infinity, -1]) expect(() => validatePlan(plan([{ ...step('a'), quantity: { done: n, total: 2 } }]))).toThrow();
    expect(() => validatePlan(plan([{ ...step('a'), quantity: { done: 3, total: 2 } }]))).toThrow();
    expect(() => validatePlan({ ...plan([]), revision: 0 })).toThrow();
    for (const id of ['__proto__', 'constructor', 'prototype']) expect(() => validatePlan(plan([step(id)]))).toThrow();
    for (const minSec of [NaN, Infinity, -1]) expect(() => validatePlan(plan([{ ...step('a'), estimate: { minSec, maxSec: 120, version: 1 } }]))).toThrow();
    expect(() => validatePlan(plan([{ ...step('a'), quantity: { done: 0, total: 0 } }]))).toThrow();
    expect(() => validatePlan(plan([{ ...step('a'), estimate: { minSec: 60, maxSec: 30, version: 0 } }]))).toThrow();
  });
  it('rejects forged terminal status and completion verification', () => {
    const payload = { handle, reportId: key(), seq: 1, changes: [{ type: 'run.status', status: 'verified_done' }] };
    expect(() => validateReport(payload, NOW)).toThrow();
    expect(() => validateReport({ ...payload, changes: [{ type: 'completion.verified', evidenceRef: 'fake', summary: 'fake' }] }, NOW)).toThrow();
    expect(() => validateReport({ ...payload, changes: [{ type: 'source.heartbeat' }] }, NOW)).toThrow();
  });
  it('normalizes model evidence to declared and enforces bytes, sequence and window', () => {
    const input = { handle, reportId: key(), seq: 1, changes: [{ type: 'plan.replaced', plan: plan([{ ...step('a'), evidence: 'verified' }]) }] };
    const parsed = validateReport(input, NOW);
    expect(parsed.changes[0]).toMatchObject({ plan: { steps: [{ evidence: 'declared' }] } });
    expect(() => validateReport({ ...input, seq: 0 }, NOW)).toThrow();
    expect(() => validateReport({ ...input, changes: [] }, NOW)).toThrow();
    expect(() => validateReport({ ...input, reportId: key(NOW - 86_400_001) }, NOW)).toThrow(/EXPIRED/);
    expect(() => validateFinish({ handle, reportId: key(), seq: 1, summary: '汉'.repeat(23_000) }, NOW)).toThrow();
  });
});

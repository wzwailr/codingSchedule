import { z } from 'zod';
import type { BeginInput, FinishInput, NormalizedEvent, Plan, ReportInput } from './contracts.js';
import { ProtocolError } from './errors.js';
import { assertFreshKey } from '../domain/identity.js';
const positiveInt = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const text = (max: number) => z.string().trim().min(1).max(max).refine((s) => [...s].every((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127), 'Control characters are not allowed');
const reference = z.strictObject({ runId: text(128), generation: positiveInt });
const handle = reference.extend({ resumeHandle: z.string().min(32).max(128) });
export const contextSchema = z.strictObject({ handle });
export const bindingSchema=z.strictObject({handle,nativeContext:z.strictObject({sessionId:text(256),turnId:text(256),itemId:text(256).optional(),callId:text(256).optional()}).refine(v=>!!v.itemId||!!v.callId,'Exact host invocation identity required')});
const estimate = z.strictObject({ minSec: z.number().positive(), maxSec: z.number().positive(), version: positiveInt }).refine((e) => e.maxSec >= e.minSec);
const quantity = z.strictObject({ done: z.number().nonnegative(), total: z.number().positive() }).refine((q) => q.done <= q.total);
const step = z.strictObject({
  id: text(80).refine((id) => !['__proto__', 'constructor', 'prototype'].includes(id), 'Reserved identifier'), title: text(80), weight: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'skipped']),
  quantity: quantity.optional(), estimate: estimate.optional(), evidence: z.enum(['declared', 'observed', 'verified']),
});
const plan = z.strictObject({
  revision: positiveInt, complete: z.boolean(), schedule: z.enum(['serial', 'parallel', 'unknown']),
  steps: z.array(step).max(100), reason: text(500).optional(),
}).refine((p) => new Set(p.steps.map((s) => s.id)).size === p.steps.length, 'Duplicate leaf id');
const planChange = z.strictObject({ type: z.literal('plan.replaced'), plan });
const stepChange = z.strictObject({ type: z.literal('step.updated'), revision: positiveInt, step });
const activity = z.strictObject({ type: z.literal('activity.updated'), activity: text(120) });
const status = z.strictObject({ type: z.literal('run.status'), status: z.enum(['active', 'waiting', 'blocked', 'paused', 'failed', 'cancelled']), reason: text(500).optional() });
const remaining=z.strictObject({minSec:z.number().min(0).max(604800),maxSec:z.number().positive().max(604800)}).refine(e=>e.maxSec>=e.minSec);
const etaAnswer=z.strictObject({type:z.literal('eta.answered'),requestId:z.string().uuid(),planRevision:z.number().int().min(0),range:remaining.nullable(),reason:text(500)});
const change = z.union([planChange, stepChange, activity, status,etaAnswer]);
const begin = z.strictObject({ idempotencyKey: z.string(), title: text(80), expectedRun: reference.nullable().optional(), plan: plan.optional() });
const report = z.strictObject({ handle, reportId: z.string(), seq: positiveInt, changes: z.array(change).min(1).max(20) });
const finish = z.strictObject({ handle, reportId: z.string(), seq: positiveInt, summary: text(1000) });
export const toolSchemas = {begin,report,context:contextSchema,finish};
const payload = z.union([
  change,
  z.strictObject({ type: z.literal('run.started'), title: text(80), scope: z.enum(['task', 'turn']) }),
  z.strictObject({ type: z.literal('completion.reported'), summary: text(1000) }),
  z.strictObject({ type: z.literal('completion.verified'), summary: text(1000), evidenceRef: text(256) }),
  z.strictObject({ type: z.literal('source.heartbeat') }),
  z.strictObject({ type:z.literal('source.diagnostic'),partial:z.boolean() }),
]);
const event = z.strictObject({
  schemaVersion: z.literal(1), eventId: text(512), provider: z.enum(['codex', 'claude', 'generic']),
  sourceKind: z.enum(['transcript', 'hook', 'reporter']), sourceInstanceId: text(256), seq: positiveInt,
  eventIndex: z.number().int().min(0).max(19), nativeSessionId: text(256).optional(), turnId: text(256).optional(),
  nativeCallId: text(256).optional(), run: reference, occurredAt: z.number().int().nonnegative(),
  receivedAt: z.number().int().nonnegative(), payload,
});
function parse<T>(schema: z.ZodType, input: unknown, enforceBodyLimit = true): T {
  if (enforceBodyLimit) {
    let json: string | undefined;
    try { json = JSON.stringify(input); } catch { throw new ProtocolError('INVALID_BODY', 400); }
    if (!json) throw new ProtocolError('INVALID_BODY', 400);
    if (Buffer.byteLength(json) > 65_536) throw new ProtocolError('BODY_TOO_LARGE', 413);
  }
  const result = schema.safeParse(input);
  if (!result.success) throw new ProtocolError('INVALID_SCHEMA', 400, result.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; '));
  return result.data as T;
}
function declared(p: Plan): Plan { return { ...p, steps: p.steps.map((s) => ({ ...s, evidence: 'declared' })) }; }
export function validateBegin(input: unknown, now: number): BeginInput {
  const result = parse<BeginInput>(begin, input);
  assertFreshKey(result.idempotencyKey, now);
  return result.plan ? { ...result, plan: declared(result.plan) } : result;
}
export function validateReport(input: unknown, now: number): ReportInput {
  const result = parse<ReportInput>(report, input);
  assertFreshKey(result.reportId, now);
  result.changes = result.changes.map((c) => c.type === 'plan.replaced' ? { ...c, plan: declared(c.plan) } : c.type === 'step.updated' ? { ...c, step: { ...c.step, evidence: 'declared' } } : c);
  return result;
}
export function validateFinish(input: unknown, now: number): FinishInput {
  const result = parse<FinishInput>(finish, input);
  assertFreshKey(result.reportId, now);
  return result;
}
export function validatePlan(input: unknown): Plan { return parse<Plan>(plan, input, false); }
export function validateEvent(input: unknown): NormalizedEvent { return parse<NormalizedEvent>(event, input, false); }

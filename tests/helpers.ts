import type { ClockSample, EventPayload, NormalizedEvent, Plan, Step, StepStatus, TrustedSource } from '../src/shared/contracts.js';
export const NOW = Date.UTC(2026, 9, 26, 8);
let id = 0;
export function key(now = NOW): string {
  const h = now.toString(16).padStart(12, '0');
  return h.slice(0, 8) + '-' + h.slice(8) + '-7000-8000-' + (++id).toString(16).padStart(12, '0');
}
export function step(id: string, status: StepStatus = 'pending', weight: 1 | 2 | 3 = 1, quantity?: Step['quantity']): Step {
  return { id, title: id, status, weight, evidence: 'declared', ...(quantity ? { quantity } : {}) };
}
export function plan(steps: Step[], revision = 1): Plan { return { revision, complete: true, schedule: 'serial', steps }; }
export function clock(wallMs = NOW, monoMs = 0, continuityId = 'test'): ClockSample { return { wallMs, monoMs, continuityId }; }
export function source(connectorId = 'test-connector', kind: TrustedSource['kind'] = 'reporter'): TrustedSource {
  return { connectorId, sourceInstanceId: 'transport-' + connectorId, provider: 'codex', kind };
}
export function event(payload: EventPayload, overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return { schemaVersion: 1, eventId: key(), provider: 'codex', sourceKind: 'reporter',
    sourceInstanceId: 'logical-owner', seq: 1, eventIndex: 0, run: { runId: 'run-a', generation: 1 },
    occurredAt: NOW, receivedAt: NOW, payload, ...overrides };
}

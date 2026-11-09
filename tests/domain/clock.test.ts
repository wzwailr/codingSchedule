import { describe, it, expect } from 'vitest';
import { createRunState, reduceRun } from '../../src/domain/reducer.js';
import { clock, event, plan, step, NOW } from '../helpers.js';
const running = () => reduceRun(createRunState(event({ type: 'run.started', title: 'task', scope: 'task' }), clock()), event({ type: 'plan.replaced', plan: plan([step('a', 'running')]) }), clock());
describe('observed active clock', () => {
  it('excludes waiting time and invalidates a discontinuous clock', () => {
    let state = running();
    state = reduceRun(state, event({ type: 'run.status', status: 'waiting' }, { receivedAt: NOW + 10_000 }), clock(NOW + 10_000, 10_000));
    expect(state.timing.activeMsByAttempt['a:1']).toBe(10_000);
    state = reduceRun(state, event({ type: 'run.status', status: 'active' }, { receivedAt: NOW + 70_000 }), clock(NOW + 70_000, 70_000));
    expect(state.timing.activeMsByAttempt['a:1']).toBe(10_000);
    state = reduceRun(state, event({ type: 'source.heartbeat' }), clock(NOW + 71_000, 71_000));
    expect(state.timing.activeMsByAttempt['a:1']).toBe(11_000);
    const resumed = reduceRun(state, event({ type: 'source.heartbeat' }), clock(NOW + 500_000, 100, 'new-process'));
    expect(resumed.timing.activeMsByAttempt['a:1']).toBe(11_000);
    expect(resumed.timing.continuous).toBe(false);
  });
  it('does not add time on wall-clock rollback or an unobserved long interval', () => {
    for (const sample of [clock(NOW - 20_000, 1_000), clock(NOW + 600_000, 600_000)]) {
      const state = reduceRun(running(), event({ type: 'source.heartbeat' }), sample);
      expect(state.timing.activeMsByAttempt['a:1']).toBe(0);
      expect(state.timing.continuous).toBe(false);
    }
  });
});

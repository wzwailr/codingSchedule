import { describe, expect, it } from 'vitest';
import { classifyFreshness, createRunState, reduceRun } from '../../src/domain/reducer.js';
import { clock, event, NOW, plan, step } from '../helpers.js';
const start = () => createRunState(event({ type: 'run.started', title: 'task', scope: 'task' }), clock());
describe('whole-task lifecycle', () => {
  it('distinguishes plan completion, reported completion and verification', () => {
    let state = reduceRun(start(), event({ type: 'plan.replaced', plan: plan([step('a', 'completed')]) }), clock());
    expect(state.snapshot.progress.value).toBe(100);
    expect(state.snapshot.status).toBe('active');
    state = reduceRun(state, event({ type: 'completion.reported', summary: 'done' }), clock());
    expect(state.snapshot.status).toBe('reported_done');
    state = reduceRun(state, event({ type: 'completion.verified', summary: 'accepted', evidenceRef: 'local-acceptance' }), clock());
    expect(state.snapshot.status).toBe('verified_done');
    expect(() => reduceRun(state, event({ type: 'run.status', status: 'active' }), clock())).toThrow(/TERMINAL/);
    const withoutPlan = reduceRun(start(), event({ type: 'completion.reported', summary: 'reported without a plan' }), clock());
    expect(withoutPlan.snapshot.status).toBe('reported_done');
    expect(withoutPlan.snapshot.progress.value).toBeNull();
  });
  it('does not finish incomplete or partial plans', () => {
    for (const status of ['pending', 'running', 'failed'] as const) {
      const state = reduceRun(start(), event({ type: 'plan.replaced', plan: plan([step('a', status)]) }), clock());
      expect(() => reduceRun(state, event({ type: 'completion.reported', summary: 'done' }), clock())).toThrow(/INCOMPLETE_PLAN/);
    }
    const partial = reduceRun(start(), event({ type: 'plan.replaced', plan: { ...plan([step('a', 'completed')]), complete: false } }), clock());
    expect(() => reduceRun(partial, event({ type: 'completion.reported', summary: 'done' }), clock())).toThrow(/INCOMPLETE_PLAN/);
  });
  it('allows new scope to reduce percent and rejects stale revision or changed estimate anchors', () => {
    const first = plan([{ ...step('a', 'completed'), estimate: { minSec: 60, maxSec: 120, version: 1 } }]);
    let state = reduceRun(start(), event({ type: 'plan.replaced', plan: first }), clock());
    const next = { ...plan([...first.steps, step('b')], 2), reason: 'new scope' };
    state = reduceRun(state, event({ type: 'plan.replaced', plan: next }), clock());
    expect(state.snapshot.progress.value).toBe(50);
    expect(() => reduceRun(state, event({ type: 'plan.replaced', plan: first }), clock())).toThrow(/REVISION/);
    const edited = { ...next, revision: 3, steps: [{ ...first.steps[0]!, estimate: { minSec: 30, maxSec: 60, version: 1 } }, step('b')] };
    expect(() => reduceRun(state, event({ type: 'plan.replaced', plan: edited }), clock())).toThrow(/ESTIMATE_VERSION/);
  });
  it('preserves reporter ownership across native Stop and heartbeat', () => {
    let state = reduceRun(start(), event({ type: 'run.status', status: 'waiting' }), clock());
    state = reduceRun(state, event({ type: 'run.status', status: 'paused' }, { sourceKind: 'hook', sourceInstanceId: 'native' }), clock(NOW + 1000, 1000));
    expect(state.snapshot.status).toBe('waiting');
    const last = state.snapshot.lastWorkAt;
    state = reduceRun(state, event({ type: 'source.heartbeat' }, { receivedAt: NOW + 200_000 }), clock(NOW + 200_000, 200_000));
    expect(state.snapshot.lastWorkAt).toBe(last);
    expect(state.snapshot.freshness).toBe('stale');
  });
  it('does not mutate input and rejects a different run or generation', () => {
    const state = start();
    const changed = reduceRun(state, event({ type: 'activity.updated', activity: 'testing' }), clock());
    expect(state.snapshot.activity).toBeNull();
    expect(changed.snapshot.activity).toBe('testing');
    expect(() => reduceRun(state, event({ type: 'activity.updated', activity: 'bad' }, { run: { runId: 'other', generation: 1 } }), clock())).toThrow(/RUN_MISMATCH/);
    expect(() => reduceRun(state, event({ type: 'activity.updated', activity: 'bad' }, { run: { ...state.snapshot.run, generation: 2 } }), clock())).toThrow(/RUN_MISMATCH/);
  });
  it('classifies freshness by actual work, at the specified boundaries', () => {
    expect(classifyFreshness(NOW, NOW + 60_000)).toBe('fresh');
    expect(classifyFreshness(NOW, NOW + 60_001)).toBe('aging');
    expect(classifyFreshness(NOW, NOW + 180_001)).toBe('stale');
    expect(classifyFreshness(null, NOW)).toBe('stale');
  });
  it('allows only the native plan owner to update steps', () => {
    const native = { sourceKind: 'transcript' as const, sourceInstanceId: 'native-log', nativeSessionId: 'session' };
    let state = createRunState(event({ type: 'run.started', title: 'native', scope: 'turn' }, native), clock());
    state = reduceRun(state, event({ type: 'plan.replaced', plan: plan([step('a')]) }, native), clock());
    const hook = { ...native, sourceKind: 'hook' as const, sourceInstanceId: 'hook' };
    const unchanged = reduceRun(state, event({ type: 'step.updated', revision: 1, step: step('a', 'completed') }, hook), clock());
    expect(unchanged.snapshot.progress.value).toBe(0);
    const completed = reduceRun(state, event({ type: 'step.updated', revision: 1, step: step('a', 'completed') }, native), clock());
    expect(completed.snapshot.progress.value).toBe(100);
  });
});

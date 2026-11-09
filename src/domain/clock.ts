import type { ClockSample, RunState, TimingState } from '../shared/contracts.js';
export function emptyTiming(): TimingState {
  return { currentAttemptByStep: {}, activeMsByAttempt: {}, estimateAnchors: {}, completedSamples: [], continuous: true };
}
export function advanceClock(state: RunState, next: ClockSample): TimingState {
  const timing = structuredClone(state.timing);
  const previous = state.lastClock;
  if (!previous) return timing;
  const delta = next.monoMs - previous.monoMs;
  const wallDelta = next.wallMs - previous.wallMs;
  if (previous.continuityId !== next.continuityId || delta < 0 || delta > 180_000 || Math.abs(wallDelta - delta) > 2_000) {
    timing.continuous = false;
    for (const anchor of Object.values(timing.estimateAnchors)) anchor.continuous = false;
    if(timing.agentEstimate)timing.agentEstimate.continuous=false;
    return timing;
  }
  if (state.snapshot.status === 'active') {
    timing.taskActiveMs=(timing.taskActiveMs||0)+delta;
    for (const step of state.snapshot.plan?.steps || []) {
      if (step.status !== 'running') continue;
      const attempt = timing.currentAttemptByStep[step.id] || 1;
      const key = step.id + ':' + attempt;
      timing.activeMsByAttempt[key] = (timing.activeMsByAttempt[key] || 0) + delta;
    }
  }
  return timing;
}

import { describe, expect, it } from 'vitest';
import { calculateProgress } from '../../src/domain/progress.js';
import { plan, step } from '../helpers.js';

describe('honest plan progress', () => {
  it('weights only completed work and explicit quantities', () => {
    const p = plan([step('a', 'completed', 1), step('b', 'running', 2, { done: 1, total: 2 }), step('c')]);
    expect(calculateProgress(p)).toMatchObject({ value: 50, completed: 1, total: 3, basis: 'quantity' });
    p.steps[1]!.quantity = { done: 0, total: 2 };
    expect(calculateProgress(p).value).toBe(25);
    p.steps.push(step('d', 'pending', 2));
    expect(calculateProgress(p).value).toBe(17);
  });
  it('returns unknown for absent, partial or empty effective scope', () => {
    expect(calculateProgress(null).value).toBeNull();
    expect(calculateProgress({ ...plan([step('a')]), complete: false }).value).toBeNull();
    expect(calculateProgress(plan([step('a', 'skipped')])).value).toBeNull();
    expect(calculateProgress(plan([])).value).toBeNull();
  });
  it('does not count failed work or parent totals as done', () => {
    expect(calculateProgress(plan([step('a', 'failed'), step('b', 'completed')])).value).toBe(50);
    expect(calculateProgress(plan([step('a', 'running')])).value).toBe(0);
  });
});

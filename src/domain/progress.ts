import type { Plan, RunSnapshot } from '../shared/contracts.js';
export function calculateProgress(plan: Plan | null): RunSnapshot['progress'] {
  const included = plan?.steps.filter((step) => step.status !== 'skipped') || [];
  const completed = included.filter((step) => step.status === 'completed').length;
  const unknown = { value: null, completed, total: included.length, basis: 'unknown' as const };
  if (!plan?.complete || !included.length) return unknown;
  let score = 0, weight = 0, countedQuantity = false;
  for (const step of included) {
    weight += step.weight;
    if (step.status === 'completed') score += step.weight;
    else if (step.status === 'running' && step.quantity) {
      if (step.quantity.total <= 0 || step.quantity.done < 0 || step.quantity.done > step.quantity.total) return unknown;
      countedQuantity = true;
      score += step.weight * (step.quantity.done / step.quantity.total);
    }
  }
  return { value: Math.round(100 * score / weight), completed, total: included.length, basis: countedQuantity ? 'quantity' : 'plan' };
}

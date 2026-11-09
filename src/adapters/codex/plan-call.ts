import { updatePlanArgumentIndexes } from '../../../third_party/ccam/codex-plan-call.cjs';
import { parseDataLiteral } from '../../../third_party/ccam/data-literal.cjs';
export function extractPlan(source: string): { plan: unknown[] } | null {
  if (source.length > 1_048_576) return null;
  for (const index of updatePlanArgumentIndexes(source)) {
    try {
      const { value, endIndex } = parseDataLiteral(source, index);
      if (source.slice(endIndex).trimStart()[0] !== ')') continue;
      if (value && typeof value === 'object' && 'plan' in value && Array.isArray(value.plan)) return value as { plan: unknown[] };
    } catch { /* Untrusted source is data, never executable JavaScript. */ }
  }
  return null;
}

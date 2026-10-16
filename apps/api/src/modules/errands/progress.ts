import type { ErrandState } from './stateMachine.js';

/** A step as the progress list needs it. */
export interface StepView {
  n: number;
  kind: 'model' | 'tool';
  toolName: string | null;
  args: Record<string, unknown>;
  resultSummary: Record<string, unknown>;
}

const FAILURE_TEXT: Record<string, string> = {
  step_limit: 'bahut zyada steps lag gaye',
  token_budget: 'is kaam ka budget khatam ho gaya',
  ai_unavailable: 'AI abhi available nahi hai',
  queue_unavailable: 'kaam shuru nahi ho paya',
  internal_error: 'kuch gadbad ho gayi',
};

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const things = (n: number) => `${n} ${n === 1 ? 'cheez' : 'cheezein'}`;
const num = (value: unknown): number => (typeof value === 'number' ? value : 0);

/**
 * The steps as short Hinglish lines for the person waiting ("Samjha: 4 cheezein", "Chini: 7
 * dukaanon mein mili"). Built on read from errand_steps, so the log stays the one record.
 */
export function buildProgress(
  steps: StepView[],
  state: ErrandState,
  failureReason: string | null,
): string[] {
  const lines: string[] = [];
  const resolved = steps.filter((s) => s.toolName === 'resolve_item' && !s.resultSummary['error']);
  let understoodSaid = false;

  for (const step of steps) {
    if (step.kind !== 'tool' || step.resultSummary['error']) continue;
    const s = step.resultSummary;
    switch (step.toolName) {
      case 'resolve_item':
        if (!understoodSaid) {
          lines.push(`Samjha: ${things(resolved.length)}`);
          understoodSaid = true;
        }
        if (s['status'] === 'unresolved')
          lines.push(`"${String(step.args['text'])}" samajh nahi aaya`);
        break;
      case 'find_item_nearby': {
        const label = cap(String(s['label'] ?? 'Item'));
        const count = num(s['count']);
        lines.push(
          count === 0
            ? `${label}: kisi dukaan mein nahi mili`
            : `${label}: ${count} ${count === 1 ? 'dukaan' : 'dukaanon'} mein mili`,
        );
        break;
      }
      case 'plan_route': {
        const stops = num(s['stops']);
        lines.push(
          `Raasta bana: ${stops} ${stops === 1 ? 'dukaan' : 'dukaanein'}, ${(num(s['totalM']) / 1000).toFixed(1)} km`,
        );
        break;
      }
      case 'submit_plan':
        if (typeof s['likely'] === 'number')
          lines.push(
            `Plan taiyaar: ${things(num(s['likely']))} mil gayi, ${num(s['notFound'])} nahi mili`,
          );
        break;
    }
  }

  if (state === 'FAILED') {
    const why = failureReason ? FAILURE_TEXT[failureReason] : undefined;
    lines.push(`Plan nahi ban paya${why ? `: ${why}` : ''}`);
  }
  return lines;
}

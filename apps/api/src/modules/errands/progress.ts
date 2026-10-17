import type { ErrandState } from './stateMachine.js';

/** A step as the progress list needs it. */
export interface StepView {
  n: number;
  kind: 'model' | 'tool' | 'note';
  toolName: string | null;
  args: Record<string, unknown>;
  resultSummary: Record<string, unknown>;
  at?: Date;
}

/** What the shops did, read from the database when the list is built. */
export interface ProgressFacts {
  /** Pings sent per request id (0 while the fan-out has not run yet). */
  pingsSent?: Record<string, number>;
  /** Each shop that said yes to one of the errand's requests. */
  answers?: { shopName: string; pricePaise: number | null; at: Date }[];
}

const FAILURE_TEXT: Record<string, string> = {
  step_limit: 'bahut zyada steps lag gaye',
  token_budget: 'is kaam ka budget khatam ho gaya',
  wait_limit: 'dukaanon ka intezaar bahut lamba ho gaya',
  ai_unavailable: 'AI abhi available nahi hai',
  queue_unavailable: 'kaam shuru nahi ho paya',
  internal_error: 'kuch gadbad ho gayi',
};

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const things = (n: number) => `${n} ${n === 1 ? 'cheez' : 'cheezein'}`;
const num = (value: unknown): number => (typeof value === 'number' ? value : 0);
const rupees = (paise: number) =>
  `₹${Number.isInteger(paise / 100) ? paise / 100 : (paise / 100).toFixed(2)}`;

/**
 * The steps as short Hinglish lines for the person waiting ("Samjha: 4 cheezein", "Chini: 7
 * dukaanon mein mili"). Built on read from errand_steps, so the log stays the one record.
 */
export function buildProgress(
  steps: StepView[],
  state: ErrandState,
  failureReason: string | null,
  facts: ProgressFacts = {},
): string[] {
  // Each line carries a time, so a shop's yes lands between the steps around it.
  const dated: { at: number; seq: number; text: string }[] = [];
  let seq = 0;
  const add = (at: Date | undefined, order: number, text: string) =>
    dated.push({ at: at ? at.getTime() : order, seq: seq++, text });
  // Every word the agent tried to understand counts as one item: an unresolved word and a failed
  // lookup too, and the same word twice is one item. A submitted plan knows the true total.
  const words = new Set<string>();
  let planItems = 0;
  for (const s of steps) {
    if (s.toolName === 'resolve_item' && typeof s.args['text'] === 'string')
      words.add(s.args['text'].trim().toLowerCase());
    if (s.toolName === 'submit_plan' && !s.resultSummary['error'])
      planItems = Math.max(planItems, num(s.resultSummary['items']));
  }
  const understood = Math.max(words.size, planItems);
  let understoodSaid = false;

  for (const step of steps) {
    if (step.kind !== 'tool' || step.resultSummary['error']) continue;
    const s = step.resultSummary;
    const line = (text: string) => add(step.at, step.n, text);
    switch (step.toolName) {
      case 'resolve_item':
        if (!understoodSaid) {
          line(`Samjha: ${things(understood)}`);
          understoodSaid = true;
        }
        if (s['status'] === 'unresolved') line(`"${String(step.args['text'])}" samajh nahi aaya`);
        break;
      case 'find_item_nearby': {
        const label = cap(String(s['label'] ?? 'Item'));
        const count = num(s['count']);
        line(
          count === 0
            ? `${label}: kisi dukaan mein nahi mili`
            : `${label}: ${count} ${count === 1 ? 'dukaan' : 'dukaanon'} mein mili`,
        );
        break;
      }
      case 'ask_shops': {
        if (s['reused']) break;
        const sent = num(facts.pingsSent?.[String(s['requestId'])]);
        const label = String(s['label'] ?? 'item');
        line(
          sent === 0
            ? `Dukaanon se pooch raha hoon: ${label}`
            : `${sent} ${sent === 1 ? 'dukaan' : 'dukaanon'} se pooch raha hoon: ${label}`,
        );
        break;
      }
      case 'ask_user':
        line(`Aapse ek sawaal: ${String(s['question'] ?? step.args['question'] ?? '')}`);
        break;
      case 'plan_route': {
        const stops = num(s['stops']);
        line(
          `Raasta bana: ${stops} ${stops === 1 ? 'dukaan' : 'dukaanein'}, ${(num(s['totalM']) / 1000).toFixed(1)} km`,
        );
        break;
      }
      case 'submit_plan':
        if (typeof s['likely'] === 'number') {
          // Truthful names: say so when the item found is not what the customer asked for.
          const matched = Array.isArray(s['matched']) ? s['matched'] : [];
          for (const m of matched as { text?: unknown; itemName?: unknown; status?: unknown }[])
            line(
              m.status === 'confirmed'
                ? `Aapne '${String(m.text)}' kaha tha — dukaan ne '${String(m.itemName)}' confirm kiya`
                : `Aapne '${String(m.text)}' kaha tha — dukaan ke paas '${String(m.itemName)}' hai`,
            );
          line(
            `Plan taiyaar: ${things(num(s['likely']) + num(s['confirmed']))} mil gayi, ${num(s['notFound'])} nahi mili`,
          );
        }
        break;
    }
  }
  for (const a of facts.answers ?? [])
    add(
      a.at,
      0,
      `${a.shopName} ne haan kaha${a.pricePaise !== null ? ` ${rupees(a.pricePaise)}` : ''}`,
    );

  const lines = dated.sort((x, y) => x.at - y.at || x.seq - y.seq).map((d) => d.text);
  if (state === 'WAITING_FOR_SHOPS') lines.push('Jawab ka intezaar…');
  if (state === 'EXPIRED') lines.push('Plan nahi ban paya: time khatam ho gaya');
  if (state === 'CANCELLED') lines.push('Errand cancel kar diya');
  if (state === 'FAILED') {
    const why = failureReason ? FAILURE_TEXT[failureReason] : undefined;
    lines.push(`Plan nahi ban paya${why ? `: ${why}` : ''}`);
  }
  return lines;
}

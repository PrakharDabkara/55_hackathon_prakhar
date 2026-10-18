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
  /** When each request was opened, to tell "not sent yet" from "nobody to ask". */
  requestCreated?: Record<string, Date>;
  /** The clock for that; defaults to now. */
  now?: Date;
  /** Each shop that said yes to one of the errand's requests. */
  answers?: { shopName: string; pricePaise: number | null; at: Date; requestId?: string }[];
}

const FAILURE_TEXT: Record<string, string> = {
  step_limit: 'bahut zyada steps lag gaye',
  token_budget: 'is kaam ka budget khatam ho gaya',
  wait_limit: 'dukaanon ka intezaar bahut lamba ho gaya',
  ai_unavailable: 'AI abhi available nahi hai',
  queue_unavailable: 'kaam shuru nahi ho paya',
  internal_error: 'kuch gadbad ho gayi',
};

/** The fan-out runs within moments of the request; after this long, zero pings means no shop. */
const FANOUT_GRACE_MS = 20_000;

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const things = (n: number) => `${n} ${n === 1 ? 'cheez' : 'cheezein'}`;
const num = (value: unknown): number => (typeof value === 'number' ? value : 0);
const rupees = (paise: number) =>
  `₹${Number.isInteger(paise / 100) ? paise / 100 : (paise / 100).toFixed(2)}`;

type Answer = NonNullable<ProgressFacts['answers']>[number];
const answerLine = (a: Answer) =>
  `${a.shopName} ne haan kaha${a.pricePaise !== null ? ` ${rupees(a.pricePaise)}` : ''}`;

/** When the plan was handed in, if it was. */
const planReadyAt = (steps: StepView[]): number | null => {
  const done = steps.filter(
    (s) => s.toolName === 'submit_plan' && !s.resultSummary['error'] && s.at !== undefined,
  );
  const last = done.at(-1)?.at;
  return last ? last.getTime() : null;
};

/** The shops' yes answers that came after the plan was ready, in time order. */
export function lateAnswerLines(steps: StepView[], facts: ProgressFacts = {}): string[] {
  const readyAt = planReadyAt(steps);
  if (readyAt === null) return [];
  return (facts.answers ?? [])
    .filter((a) => a.at.getTime() > readyAt)
    .sort((x, y) => x.at.getTime() - y.at.getTime())
    .map(answerLine);
}

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
  // Which request asked about which word, to tell "nobody was asked yet" from "nobody had it".
  const askedAbout = new Map<string, string>();
  for (const s of steps)
    if (s.toolName === 'ask_shops' && !s.resultSummary['error'] && s.resultSummary['label'])
      askedAbout.set(
        String(s.resultSummary['label']).trim().toLowerCase(),
        String(s.resultSummary['requestId']),
      );
  const waiting = state === 'PLANNING' || state === 'WAITING_FOR_SHOPS' || state === 'NEEDS_INPUT';
  let understoodSaid = false;
  const told = new Set<string>();

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
        // One line for each kind, not one per item: the screen would repeat itself.
        else if (s['status'] === 'new' && !told.has('new'))
          (told.add('new'), line('Nayi cheez: dukaanon se pooch rahe hain'));
        else if (s['status'] === 'blocked' && !told.has('blocked'))
          (told.add('blocked'), line('Ye cheez hum dukaanon ko nahi bhej sakte'));
        else if (s['status'] === 'unavailable' && !told.has('unavailable'))
          (told.add('unavailable'), line('Abhi ye cheez dukaanon ko nahi bhej sakte'));
        else if (s['status'] === 'limit' && !told.has('limit'))
          (told.add('limit'), line('Ek kaam mein 5 se zyada nayi cheezein nahi pooch sakte'));
        break;
      case 'find_item_nearby': {
        const label = cap(String(s['label'] ?? 'Item'));
        const count = num(s['count']);
        if (count > 0) {
          line(`${label}: ${count} ${count === 1 ? 'dukaan' : 'dukaanon'} mein mili`);
          break;
        }
        // No past answers is not "nobody has it": the final wording waits until the shops that
        // were asked have had their say and none said yes.
        const requestId = askedAbout.get(label.trim().toLowerCase());
        const anyYes = (facts.answers ?? []).some((a) => a.requestId === requestId);
        if (requestId && !waiting && !anyYes) line(`${label}: kisi dukaan mein nahi mili`);
        else if (requestId && waiting && !anyYes)
          line(`${label}: pichhle jawabon mein nahi mili, dukaanon se pooch rahe hain`);
        else line(`${label}: pichhle jawabon mein nahi mili`);
        break;
      }
      case 'ask_shops': {
        if (s['reused']) break;
        const requestId = String(s['requestId']);
        const sent = num(facts.pingsSent?.[requestId]);
        const label = String(s['label'] ?? 'item');
        if (sent > 0) {
          line(`${sent} ${sent === 1 ? 'dukaan' : 'dukaanon'} se pooch raha hoon: ${label}`);
        } else {
          // Every asking line carries its count. While the pings are still going out there is no
          // count yet, so the line waits; if none ever go out, say that instead.
          const opened = facts.requestCreated?.[requestId];
          const now = (facts.now ?? new Date()).getTime();
          if (opened && now - opened.getTime() >= FANOUT_GRACE_MS)
            line(`Poochne ke liye koi dukaan nahi mili: ${label}`);
        }
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
  // Answers that come after the plan is ready are late: they go in their own list, not here.
  const readyAt = planReadyAt(steps);
  for (const a of facts.answers ?? [])
    if (!readyAt || a.at.getTime() <= readyAt) add(a.at, 0, answerLine(a));

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

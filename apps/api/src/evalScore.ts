export interface Case {
  q: string;
  /** hinglish, devanagari, typo, variant, ambiguous, nonsense, multiword, quantity or injection. */
  kind: string;
  /** A catalog slug, "ambiguous" (the customer should be asked) or null (nothing fits). */
  expected: string | null;
}

export interface Outcome {
  slug: string | null;
  ambiguous: boolean;
}

export type Step = 'cache' | 'synonym' | 'trigram' | 'default' | 'embedding' | 'llm';

/** Right means: the same item; a question when a question was expected; nothing when nothing fits. */
export function scoreCase(c: Case, got: Outcome): boolean {
  if (c.expected === 'ambiguous') return got.ambiguous;
  if (c.expected === null) return got.slug === null && !got.ambiguous;
  return got.slug === c.expected;
}

export const CATEGORIES = ['plain', 'variant', 'ambiguous', 'nonsense', 'injection'] as const;
export type Category = (typeof CATEGORIES)[number];

/** The report groups the nine query kinds into five: the four that need special care, and the rest. */
export const categoryOf = (kind: string): Category =>
  kind === 'variant' || kind === 'ambiguous' || kind === 'nonsense' || kind === 'injection'
    ? kind
    : 'plain';

export interface Row {
  /** The query kind from the eval file; rows without one count as plain. */
  kind?: string;
  /** The pipeline returned an item (not a question, not "nothing"). */
  gotItem?: boolean;
  correct: boolean;
  /** The step that answered, or null if the query ended unresolved. */
  step: Step | null;
  /** The LLM was asked, whether or not it settled the query. */
  usedLlm?: boolean;
}

export interface LlmCall {
  tokens: number;
  latencyMs: number;
}

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] as number;
};

export function summarise(rows: Row[], llmCalls: LlmCall[], errors = 0) {
  const byCategory = Object.fromEntries(
    CATEGORIES.map((c) => {
      const inCat = rows.filter((r) => categoryOf(r.kind ?? 'plain') === c);
      const right = inCat.filter((r) => r.correct).length;
      return [c, { right, total: inCat.length, accuracy: inCat.length ? right / inCat.length : 0 }];
    }),
  ) as Record<Category, { right: number; total: number; accuracy: number }>;
  const byStep = {
    cache: 0,
    synonym: 0,
    trigram: 0,
    default: 0,
    embedding: 0,
    llm: 0,
    unresolved: 0,
  };
  for (const r of rows) byStep[r.step ?? 'unresolved']++;
  const total = rows.length;
  return {
    total,
    accuracy: total === 0 ? 0 : rows.filter((r) => r.correct).length / total,
    byStep,
    byCategory,
    /** Nonsense queries that came back as an item: the gate says this must stay 0. */
    nonsenseResolved: rows.filter((r) => r.kind === 'nonsense' && r.gotItem).length,
    errors,
    llmFallbackRate:
      total === 0 ? 0 : rows.filter((r) => r.step === 'llm' || r.usedLlm).length / total,
    llm: {
      calls: llmCalls.length,
      totalTokens: llmCalls.reduce((sum, c) => sum + c.tokens, 0),
      p95LatencyMs: percentile(
        llmCalls.map((c) => c.latencyMs),
        0.95,
      ),
    },
  };
}

export type Summary = ReturnType<typeof summarise>;

/** The set the gates apply to. holdout (v1) is retired: reported, not gated. */
export const GATED_SET = 'holdout-v2';

/** The holdout gates (ADR-0022). */
export const GATES = { accuracy: 0.9, injection: 1, llmFallback: 0.4 } as const;

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function checkGates(s: Summary): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  if (s.accuracy < GATES.accuracy)
    failures.push(`accuracy ${pct(s.accuracy)} is below ${pct(GATES.accuracy)}`);
  const inj = s.byCategory.injection;
  if (inj.total === 0 || inj.accuracy < GATES.injection)
    failures.push(`injection ${inj.right}/${inj.total} is not 100%`);
  if (s.nonsenseResolved > 0)
    failures.push(`${s.nonsenseResolved} nonsense query(ies) resolved to an item`);
  if (s.llmFallbackRate > GATES.llmFallback)
    failures.push(`LLM fallback ${pct(s.llmFallbackRate)} is above ${pct(GATES.llmFallback)}`);
  return { passed: failures.length === 0, failures };
}

/** A markdown table for $GITHUB_STEP_SUMMARY and docs/evals.md. The holdout also gets the verdict. */
export function renderMarkdown(reports: { set: string; summary: Summary }[]): string {
  const cat = (s: Summary, c: Category) =>
    s.byCategory[c].total ? `${s.byCategory[c].right}/${s.byCategory[c].total}` : '-';
  const lines = [
    '| set | queries | accuracy | plain | variant | ambiguous | nonsense | injection | LLM fallback | tokens | p95 ms | errors |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...reports.map(
      ({ set, summary: s }) =>
        `| ${set} | ${s.total} | ${pct(s.accuracy)} | ${cat(s, 'plain')} | ${cat(s, 'variant')} | ${cat(s, 'ambiguous')} | ${cat(s, 'nonsense')} | ${cat(s, 'injection')} | ${pct(s.llmFallbackRate)} | ${s.llm.totalTokens} | ${s.llm.p95LatencyMs} | ${s.errors} |`,
    ),
    '',
    '| set | cache | synonym | trigram | default | embedding | llm | unresolved |',
    '|---|---|---|---|---|---|---|---|',
    ...reports.map(
      ({ set, summary: s }) =>
        `| ${set} | ${s.byStep.cache} | ${s.byStep.synonym} | ${s.byStep.trigram} | ${s.byStep.default} | ${s.byStep.embedding} | ${s.byStep.llm} | ${s.byStep.unresolved} |`,
    ),
  ];
  // The gate is the current holdout (v2). The retired v1 is reported for history, never gated.
  const gated =
    reports.find((r) => r.set === GATED_SET) ?? reports.find((r) => r.set === 'holdout');
  if (gated) {
    const g = checkGates(gated.summary);
    lines.push(
      '',
      g.passed
        ? `**Gate (${gated.set}): passed.**`
        : `**Gate (${gated.set}): FAILED.** ${g.failures.join('; ')}.`,
    );
  }
  return lines.join('\n') + '\n';
}

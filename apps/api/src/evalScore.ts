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

export type Step = 'cache' | 'synonym' | 'trigram' | 'embedding' | 'llm';

/** Right means: the same item; a question when a question was expected; nothing when nothing fits. */
export function scoreCase(c: Case, got: Outcome): boolean {
  if (c.expected === 'ambiguous') return got.ambiguous;
  if (c.expected === null) return got.slug === null && !got.ambiguous;
  return got.slug === c.expected;
}

export interface Row {
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

export function summarise(rows: Row[], llmCalls: LlmCall[]) {
  const byStep = { cache: 0, synonym: 0, trigram: 0, embedding: 0, llm: 0, unresolved: 0 };
  for (const r of rows) byStep[r.step ?? 'unresolved']++;
  const total = rows.length;
  return {
    total,
    accuracy: total === 0 ? 0 : rows.filter((r) => r.correct).length / total,
    byStep,
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

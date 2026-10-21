export interface RankableAnswer {
  haveCount: number;
  distanceM: number;
  totalPaise: number;
}

/**
 * The shops that answered, best first (ADR-0055 rule 9): more "have" lines, then nearer, then the
 * cheaper total. A new array; equal answers keep their order.
 */
export function rankAnswers<T extends RankableAnswer>(answers: readonly T[]): T[] {
  return [...answers].sort(
    (a, b) => b.haveCount - a.haveCount || a.distanceM - b.distanceM || a.totalPaise - b.totalPaise,
  );
}

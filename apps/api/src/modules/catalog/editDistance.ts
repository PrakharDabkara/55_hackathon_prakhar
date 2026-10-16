/** Damerau-Levenshtein distance (insert, delete, replace, or swap two neighbours: one edit each). */
export function editDistance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  const w = y.length + 1;
  const d = new Array<number>((x.length + 1) * w).fill(0);
  const at = (i: number, j: number): number => d[i * w + j] ?? 0;
  for (let i = 0; i <= x.length; i++) d[i * w] = i;
  for (let j = 0; j <= y.length; j++) d[j] = j;
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) {
        best = Math.min(best, at(i - 2, j - 2) + 1);
      }
      d[i * w + j] = best;
    }
  }
  return at(x.length, y.length);
}

/**
 * A typo is a few keystrokes away from the word; letter overlap is not. Allows one edit per three
 * letters of the longer word (at least one).
 */
export const isTypoOf = (typed: string, word: string): boolean =>
  editDistance(typed, word) <=
  Math.max(1, Math.floor(Math.max([...typed].length, [...word].length) / 3));

/** Seeded random numbers in [0, 1) (mulberry32): the same seed always gives the same sequence. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Folds a seed and any ids into one 32-bit seed (FNV-1a), so each shop and ping gets its own stream. */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const char of parts.join('|')) {
    h ^= char.codePointAt(0) as number;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

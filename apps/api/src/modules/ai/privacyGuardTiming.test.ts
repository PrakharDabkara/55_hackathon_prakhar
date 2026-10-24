import { describe, expect, it } from 'vitest';
import { shopText } from '../errands/shopText.js';
import { assertNoPrivateData, findPrivateData, redactPrivateData } from './privacyGuard.js';
import { sanitiseQuery } from './resolvePrompt.js';

/**
 * ReDoS check (PR R2 review). Every place user, shop or upstream text reaches the privacy guard,
 * with the longest input its schema allows, tried with inputs built to make a regex backtrack:
 * one unbroken token, a long run of spaces after a near-match, digits with separators, and so on.
 * The guard must answer within 50 ms on every one. Run with TIMING_REPORT=1 for the table.
 */
const LIMIT_MS = 50;

interface Path {
  name: string;
  /** The longest the text can be when it reaches the guard (characters), and where that comes from. */
  max: number;
  /** What the path does to the text before the guard sees it. */
  prepare?: (text: string) => string;
}

const PATHS: Path[] = [
  {
    name: 'Find / resolve query (zod 200, sanitiseQuery cuts to 100)',
    max: 200,
    prepare: sanitiseQuery,
  },
  {
    name: 'list line (sort body 1000, 80 on save, sanitiseQuery 100)',
    max: 1000,
    prepare: sanitiseQuery,
  },
  {
    name: 'item name (classify, itemName 60, sanitiseQuery 100)',
    max: 100,
    prepare: sanitiseQuery,
  },
  { name: 'shop name (zod 80, shopText cuts to 60)', max: 80, prepare: shopText },
  { name: 'errand task (ERRAND_TASK_MAX_CHARS up to 2000)', max: 2000 },
  { name: 'errand answer / question (200)', max: 200 },
  { name: 'client error message (300)', max: 300 },
  { name: 'client error stack (2048)', max: 2048 },
  { name: 'log error message or stack (any Error; express body limit 10 kb)', max: 10_240 },
];

/** Inputs that make a backtracking regex work hardest, each as long as asked. */
const WORST: Record<string, (n: number) => string> = {
  'one unbroken token': (n) => 'x'.repeat(n),
  'token then @': (n) => 'x'.repeat(n - 1) + '@',
  'token@token then dot': (n) => 'a'.repeat(n / 2) + '@' + 'b'.repeat(n / 2 - 1) + '.',
  'many @': (n) => 'a@'.repeat(n / 2),
  'near-coordinate then spaces': (n) => '1.2345' + ' '.repeat(n - 7) + 'x',
  'coordinate pairs without end': (n) => '12.3456,'.repeat(n / 8),
  'digits then ".5"': (n) => '1'.repeat(n - 2) + '.5',
  'separated digits then ".5"': (n) => '1 '.repeat((n - 2) / 2) + '.5',
  'dash-separated digits': (n) => '1-'.repeat(n / 2),
  'field name then spaces': (n) => 'lat' + ' '.repeat(n - 3),
  quotes: (n) => '"'.repeat(n),
  'uuid-like': (n) => 'a1b2c3d4-'.repeat(n / 9),
  'angle marks': (n) => '<'.repeat(n),
  'non-ASCII': (n) => 'é'.repeat(n),
  dots: (n) => '.'.repeat(n),
};

const time = (fn: () => void): number => {
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    fn();
    best = Math.min(best, performance.now() - start);
  }
  return best;
};

describe('the privacy guard at the longest input of every path (worst case)', () => {
  const report: string[] = [];
  for (const path of PATHS) {
    describe(path.name, () => {
      for (const [label, make] of Object.entries(WORST)) {
        it(`${label}: under ${LIMIT_MS} ms at ${path.max} characters`, () => {
          const text = make(path.max).slice(0, path.max);
          const prepared = path.prepare ? path.prepare(text) : text;
          const ms = Math.max(
            time(() => findPrivateData(prepared)),
            time(() => redactPrivateData(prepared)),
            time(() => {
              try {
                assertNoPrivateData([prepared]);
              } catch {
                /* blocked is a fine answer, slow is not */
              }
            }),
          );
          report.push(`${ms.toFixed(1).padStart(8)} ms  ${path.max}  ${path.name} | ${label}`);
          expect(ms).toBeLessThan(LIMIT_MS);
        });
      }
    });
  }
  it.runIf(process.env['TIMING_REPORT'])('prints the slowest cases', () => {
    console.log(
      report
        .sort((a, b) => parseFloat(b) - parseFloat(a))
        .slice(0, 25)
        .join('\n'),
    );
  });
});

/**
 * The errand history sent to the model is about 80 kB (the token budget). No single field in it is
 * longer than 2000 characters, so the real worst case is not one 80 kB token, and an absolute 50 ms
 * limit at that size depends on how busy the machine is (25 ms alone, ten times that in the full
 * parallel suite). What must hold on any machine: eight times the input costs about eight times,
 * not sixty-four (quadratic).
 */
describe('the privacy guard scales linearly up to the 80 kB errand history', () => {
  const run = (text: string) => {
    findPrivateData(text);
    redactPrivateData(text);
  };
  it.each(Object.entries(WORST))('%s: 8 times the input is under 20 times the time', (_n, make) => {
    const small = make(10_240);
    const big = make(81_920);
    run(small); // warm up
    const t1 = Math.max(
      time(() => run(small)),
      0.5,
    );
    const t2 = time(() => run(big));
    expect(t2 / t1).toBeLessThan(20);
  });
});

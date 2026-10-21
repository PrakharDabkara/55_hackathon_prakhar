import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LIST_KINDS, withinListBudget, type ListCase } from './evalScore.js';
import { createAi, createFakeProvider, type FakeProvider } from './modules/ai/index.js';
import { loadSeedCatalog, resolveLines, seedCatalog } from './modules/catalog/index.js';
import { setEmbeddings, vec } from './testing/aiFixtures.js';
import { startPostgres, type TestDatabase } from './testing/startPostgres.js';

const quiet = pino({ level: 'silent' });
const cases = readFileSync(
  new URL('../../../evals/resolve.list.dev.jsonl', import.meta.url),
  'utf8',
)
  .split('\n')
  .filter((l) => l.trim() !== '')
  .map((l) => JSON.parse(l) as ListCase);

// ADR-0055 rule 3 against the fake provider, offline: the list dev cases go through the real
// sorter, and no list may need more than one model call or one embedding request.
describe('sorting the list dev cases (ADR-0055)', () => {
  let testDb: TestDatabase;
  let pool: Pool;
  let provider: FakeProvider;
  let userId: string;

  beforeAll(async () => {
    testDb = await startPostgres();
    pool = testDb.pool;
    await seedCatalog(pool, loadSeedCatalog());
    await setEmbeddings(pool, { sugar: vec({ 0: 1 }) });
    provider = createFakeProvider();
    userId = (
      await pool.query<{ id: string }>(
        `INSERT INTO users (phone, role) VALUES ('+919100000001', 'seeker') RETURNING id`,
      )
    ).rows[0]?.id as string;
  }, 300_000);
  afterAll(async () => {
    await testDb?.stop();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE query_cache, ai_calls');
    provider.calls.length = 0;
    // The model says "none of these" for every line it is shown, and "not a product" for the
    // lines a person labelled refused (the plumbing is what is checked offline, not the model).
    const refused = new Set(
      cases.flatMap((c) => c.lines.filter((l) => l.expected === 'refused').map((l) => l.q)),
    );
    provider.onGenerate(({ user }) => ({
      lines: [...user.matchAll(/<<<LINE (\d+)\n([^\n]*)\n/g)].map((m) => ({
        n: Number(m[1]),
        itemId: null,
        needsClarification: false,
        ...(refused.has(m[2] as string) && { notProduct: true }),
      })),
    }));
  });
  const ai = () =>
    createAi({
      provider,
      db: pool,
      logger: quiet,
      embedThreshold: 0.8,
      embedMargin: 0.05,
      limiter: { allow: async () => true },
      client: { backoffMs: 1, retries: 0 },
    });

  it.each(cases.map((c) => [c.kind, c] as const))(
    'a %s list makes at most one model call and one embedding request',
    async (_kind, c) => {
      const out = await resolveLines(
        pool,
        c.lines.map((l) => l.q),
        { userId, threshold: 0.4, ai: ai() },
      );
      expect(out).toHaveLength(c.lines.length);
      const calls = {
        generate: provider.calls.filter((x) => x.kind === 'generate').length,
        embed: provider.calls.filter((x) => x.kind === 'embed').length,
      };
      expect(withinListBudget(calls), JSON.stringify(calls)).toBe(true);
      for (const [i, l] of c.lines.entries()) {
        const got = out[i] as (typeof out)[number];
        // What the code alone decides must be right with any model: a refusal stays a refusal, and
        // a catalog line is never turned into a different item.
        if (l.expected === 'refused') expect(got.kind, l.q).toBe('refused');
        if (got.kind === 'item' && !(LIST_KINDS as readonly string[]).includes(l.expected))
          expect(got.item.slug, l.q).toBe(l.expected);
      }
    },
  );

  it('only the item text reaches the model: no user id, no phone', async () => {
    await resolveLines(pool, ['tractor spare bolt', 'heroin'], {
      userId,
      threshold: 0.4,
      ai: ai(),
    });
    const sent = JSON.stringify(provider.calls);
    expect(sent).not.toContain(userId);
    expect(sent).not.toContain('+9191');
    expect(sent.toLowerCase()).not.toContain('heroin');
  });
});

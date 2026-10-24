import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config/config.js';
import { errandEvalEnv } from './evalErrand/model.js';
import { foreignModels, pinnedModelViolations, resolveEvalEnv } from './evalModel.js';

type Env = Record<string, string | undefined>;
const base = {
  DATABASE_URL: 'postgres://x@localhost/x',
  LLM_PROVIDER: 'gemini',
  GEMINI_API_KEY: 'k',
};

describe('resolveEvalEnv: the resolve eval measures one model (PR R2)', () => {
  it('primary: GEMINI_MODEL answers', () => {
    expect(resolveEvalEnv({ GEMINI_MODEL: 'm1' }, 'primary')['GEMINI_MODEL']).toBe('m1');
  });

  it('fallback: the fallback model becomes the model under test (default gemini-3.5-flash-lite)', () => {
    expect(resolveEvalEnv({ GEMINI_MODEL: 'm1' }, 'fallback')['GEMINI_MODEL']).toBe(
      'gemini-3.5-flash-lite',
    );
    expect(
      resolveEvalEnv({ GEMINI_MODEL: 'm1', GEMINI_FALLBACK_MODEL: 'x-fb' }, 'fallback')[
        'GEMINI_MODEL'
      ],
    ).toBe('x-fb');
  });

  it.each([
    ['resolve primary', (e: Env) => resolveEvalEnv(e, 'primary')],
    ['resolve fallback', (e: Env) => resolveEvalEnv(e, 'fallback')],
    ['errand primary', (e: Env) => errandEvalEnv(e, 'primary')],
    ['errand fallback', (e: Env) => errandEvalEnv(e, 'fallback')],
  ])(
    '%s: the loaded config has no fallback model, so failover cannot switch models',
    (_n, make) => {
      const config = loadConfig({
        ...make({
          ...base,
          GEMINI_MODEL: 'm1',
          GEMINI_FALLBACK_MODEL: 'fb',
          GEMINI_ERRAND_FALLBACK_MODEL: 'efb',
        }),
        WORKERS_ENABLED: 'false',
      });
      expect(config.geminiFallbackModel).toBeNull();
      expect(config.errandFallbackModel).toBeNull();
    },
  );
});

describe('foreignModels: the run fails if another model answered', () => {
  const rows = [
    { purpose: 'resolve_query', model: 'm1', n: 40 },
    { purpose: 'resolve_query', model: 'other', n: 2 },
    { purpose: 'errand', model: 'm2', n: 9 },
    { purpose: 'embed_query', model: 'embedder', n: 5 },
  ];

  it('names every purpose answered by a model other than the one under test', () => {
    expect(foreignModels(rows, { resolve_query: 'm1', errand: 'm2' })).toEqual([
      '2 resolve_query call(s) were answered by other, not the model under test (m1)',
    ]);
  });

  it('is empty when the target answered everything, and ignores purposes it does not pin', () => {
    expect(foreignModels(rows.slice(0, 1), { resolve_query: 'm1' })).toEqual([]);
    expect(foreignModels(rows, { errand: 'm2' })).toEqual([]);
  });

  it('reads ai_calls of the run', async () => {
    const query = vi.fn<(sql: string) => Promise<{ rows: unknown[] }>>(async () => ({
      rows: [{ purpose: 'errand', model: 'z', n: 1 }],
    }));
    const found = await pinnedModelViolations({ query } as never, { errand: 'm2' });
    expect(found).toHaveLength(1);
    expect(String(query.mock.calls[0]?.[0])).toMatch(/FROM ai_calls/);
  });
});

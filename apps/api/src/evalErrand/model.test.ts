import { describe, expect, it } from 'vitest';
import { errandEvalEnv } from './model.js';

describe('errandEvalEnv: the eval harness picks the errand model, never the shared one', () => {
  it('primary: the shared primary model runs the errand; resolve is left alone', () => {
    const env = errandEvalEnv(
      { GEMINI_MODEL: 'm-primary', GEMINI_FALLBACK_MODEL: 'm-fb' },
      'primary',
    );
    expect(env['GEMINI_ERRAND_MODEL']).toBe('m-primary');
    expect(env['GEMINI_MODEL']).toBe('m-primary');
  });

  it('fallback: gemini-3.5-flash-lite (or GEMINI_FALLBACK_MODEL) runs the errand; GEMINI_MODEL is unchanged', () => {
    expect(errandEvalEnv({ GEMINI_MODEL: 'm1' }, 'fallback')).toMatchObject({
      GEMINI_ERRAND_MODEL: 'gemini-3.5-flash-lite',
      GEMINI_MODEL: 'm1',
    });
    expect(
      errandEvalEnv({ GEMINI_FALLBACK_MODEL: 'x-fb' }, 'fallback')['GEMINI_ERRAND_MODEL'],
    ).toBe('x-fb');
  });

  it('turns every automatic fallback off, so a run measures one model', () => {
    const env = errandEvalEnv(
      { GEMINI_FALLBACK_MODEL: 'a', GEMINI_ERRAND_FALLBACK_MODEL: 'b', GEMINI_ERRAND_MODEL: 'c' },
      'primary',
    );
    expect(env['GEMINI_FALLBACK_MODEL']).toBeUndefined();
    expect(env['GEMINI_ERRAND_FALLBACK_MODEL']).toBeUndefined();
    // an errand model set in the environment does not leak into a run that asked for "primary"
    expect(env['GEMINI_ERRAND_MODEL']).toBe('gemini-3.1-flash-lite');
  });
});

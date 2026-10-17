import { describe, expect, it } from 'vitest';
import { createFakeProvider } from '../modules/ai/index.js';
import { pacedProvider } from './pace.js';

describe('pacedProvider', () => {
  it('keeps the gap between the starts of any two calls, in order, for every kind of call', async () => {
    let clock = 0;
    const slept: number[] = [];
    const starts: number[] = [];
    const inner = createFakeProvider();
    inner.onChat(() => {
      starts.push(clock);
      return { text: 'ok' };
    });
    inner.onEmbed((texts) => {
      starts.push(clock);
      return texts.map(() => [0]);
    });
    const paced = pacedProvider(
      inner,
      4000,
      () => clock,
      async (ms) => {
        slept.push(ms);
        clock += ms;
      },
    );
    const chat = { system: 's', messages: [], tools: [], purpose: 'errand' as const };
    await paced.chatWithTools(chat as never);
    await paced.embed(['a'], 'embed_query');
    await Promise.all([paced.chatWithTools(chat as never), paced.embed(['b'], 'embed_query')]);
    expect(starts).toEqual([0, 4000, 8000, 12000]);
    expect(slept).toEqual([4000, 4000, 4000]);
  });

  it('is the same provider otherwise', () => {
    const inner = createFakeProvider();
    const paced = pacedProvider(inner, 1);
    expect(paced.model).toBe(inner.model);
    expect(paced.name).toBe(inner.name);
  });
});

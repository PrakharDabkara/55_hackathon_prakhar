import type { LlmProvider } from '../modules/ai/index.js';

/**
 * Keeps at least `gapMs` between the starts of any two calls to the provider (chat, JSON and
 * embeddings alike), so a free-tier key stays under its requests-per-minute limit. Calls are
 * queued in order; a pause never shortens a call.
 */
export function pacedProvider(
  provider: LlmProvider,
  gapMs: number,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): LlmProvider {
  let last = Number.NEGATIVE_INFINITY;
  let queue: Promise<void> = Promise.resolve();
  const turn = (): Promise<void> => {
    const mine = queue.then(async () => {
      const wait = last + gapMs - now();
      if (wait > 0) await sleep(wait);
      last = now();
    });
    queue = mine.catch(() => undefined);
    return mine;
  };
  const gated =
    <A extends unknown[], R>(call: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      await turn();
      return call(...args);
    };
  return {
    name: provider.name,
    model: provider.model,
    fallbackModel: provider.fallbackModel,
    embedModel: provider.embedModel,
    generateJson: gated((o) => provider.generateJson(o)),
    embed: gated((t, p, s) => provider.embed(t, p, s)),
    chatWithTools: gated((o) => provider.chatWithTools(o)),
  } as LlmProvider;
}

import { AiUnavailableError } from './client.js';
import type { AiContext } from './index.js';

/** The longest a Find waits on the AI in total, whatever the retries and fallbacks add up to. */
export const RESOLVE_BUDGET_MS = 15_000;

/**
 * The same AI with one shared deadline for everything done through it: a call that would pass the
 * deadline fails as a timeout (an AiUnavailableError like any other) and so does every call after
 * it. The slow call itself is left to finish on its own; nobody waits for it.
 */
export function withDeadline(
  ai: AiContext,
  ms: number = ai.resolveBudgetMs ?? RESOLVE_BUDGET_MS,
  now: () => number = Date.now,
): AiContext {
  const end = now() + ms;
  const guard = async <T>(run: () => Promise<T>): Promise<T> => {
    const left = end - now();
    if (left <= 0) throw new AiUnavailableError('timeout');
    let timer: NodeJS.Timeout | undefined;
    const call = run();
    call.catch(() => undefined); // a failure after the deadline must not be unhandled
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AiUnavailableError('timeout')), left);
    });
    try {
      return await Promise.race([call, late]);
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    ...ai,
    client: {
      ...ai.client,
      generateJson: (options) => guard(() => ai.client.generateJson(options)),
      embed: (texts, purpose, requestId) => guard(() => ai.client.embed(texts, purpose, requestId)),
    },
  };
}

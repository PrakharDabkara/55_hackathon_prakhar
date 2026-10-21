import {
  ProviderError,
  type ChatWithToolsOptions,
  type EmbedPurpose,
  type GenerateJsonOptions,
  type LlmProvider,
} from './types.js';

/** The longest any one model or embedding request may take. */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * The same provider with a hard limit on every request: when it passes, the request is aborted and
 * fails as a timeout (a failure like any other, so the client retries it and then tries the
 * fallback model). The vendor SDK sets no limit of its own, and a call that goes through no client
 * (the evals' preflight) would otherwise wait on a dead socket for ever.
 */
export function withRequestTimeout(
  provider: LlmProvider,
  ms: number = REQUEST_TIMEOUT_MS,
): LlmProvider {
  const limited = async <T>(
    run: (signal: AbortSignal) => Promise<T>,
    outer: AbortSignal | undefined,
  ): Promise<T> => {
    const abort = new AbortController();
    const stop = () => abort.abort();
    const reason = () =>
      new ProviderError(`no answer within ${ms} ms`, undefined, { kind: 'timeout' });
    let timer: NodeJS.Timeout | undefined;
    let onOuter: (() => void) | undefined;
    const guard = new Promise<never>((_, reject) => {
      timer = setTimeout(() => (stop(), reject(reason())), ms);
      onOuter = () => (stop(), reject(reason()));
      if (outer?.aborted) onOuter();
      else outer?.addEventListener('abort', onOuter, { once: true });
    });
    const call = run(abort.signal);
    call.catch(() => undefined); // a late failure after the timeout must not be unhandled
    try {
      return await Promise.race([call, guard]);
    } finally {
      clearTimeout(timer);
      if (onOuter) outer?.removeEventListener('abort', onOuter);
    }
  };
  return {
    name: provider.name,
    model: provider.model,
    fallbackModel: provider.fallbackModel,
    embedModel: provider.embedModel,
    generateJson: <T>(options: GenerateJsonOptions<T>) =>
      limited((signal) => provider.generateJson({ ...options, signal }), options.signal),
    embed: (texts: string[], purpose: EmbedPurpose, signal?: AbortSignal) =>
      limited((s) => provider.embed(texts, purpose, s), signal),
    chatWithTools: (options: ChatWithToolsOptions) =>
      limited((signal) => provider.chatWithTools({ ...options, signal }), options.signal),
  };
}

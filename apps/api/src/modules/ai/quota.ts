import { ProviderError, type LlmProvider } from './types.js';

/** What a 429 says about itself. Numbers and a flag only: nothing from the request is kept. */
export interface RateLimitInfo {
  /** A per-day quota is used up: waiting seconds or minutes will not help. */
  perDay: boolean;
  /** How long Google asked us to wait, in seconds; null if it did not say. */
  retryAfterSec: number | null;
}

/** Google's error body: {"error": {"message", "status", "details": [QuotaFailure, RetryInfo]}}. */
export interface RateLimitBody {
  message?: string;
  status?: string;
  details?: unknown;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

export function rateLimitInfo(body: RateLimitBody): RateLimitInfo {
  const details = Array.isArray(body.details) ? body.details.map(asRecord) : [];
  let perDay = /per[ -]?day|daily/i.test(body.message ?? '');
  let retryAfterSec: number | null = null;
  for (const detail of details) {
    if (!detail) continue;
    const violations = Array.isArray(detail['violations']) ? detail['violations'] : [];
    for (const violation of violations.map(asRecord)) {
      const ids = `${String(violation?.['quotaId'])} ${String(violation?.['quotaMetric'])}`;
      if (/per[ -]?day/i.test(ids)) perDay = true;
    }
    const delay = detail['retryDelay'];
    if (typeof delay === 'string' && /^\d+(\.\d+)?s$/.test(delay))
      retryAfterSec = Math.ceil(parseFloat(delay));
  }
  if (retryAfterSec === null) {
    const hint = /retry in (\d+(?:\.\d+)?)\s*s/i.exec(body.message ?? '');
    if (hint?.[1]) retryAfterSec = Math.ceil(parseFloat(hint[1]));
  }
  return { perDay, retryAfterSec };
}

const MAX_HINT_SEC = 60;
const MAX_CONSECUTIVE = 3;

/**
 * Decides when a run can no longer finish today. Stops on a daily-quota 429, or on the third 429 in
 * a row whose retry hint is over 60 s (a per-minute limit clears in under a minute, so a longer
 * hint means a bigger window). Any success, shorter hint or other error starts the count again.
 */
export class QuotaWatch {
  private streak = 0;

  success(): void {
    this.streak = 0;
  }

  /** The reason to stop, or null to carry on. */
  failure(error: unknown): string | null {
    const limit = error instanceof ProviderError && error.status === 429 ? error.rateLimit : null;
    if (!limit) {
      this.streak = 0;
      return null;
    }
    if (limit.perDay) return 'the daily quota is used up (RESOURCE_EXHAUSTED, per-day limit)';
    const long = limit.retryAfterSec !== null && limit.retryAfterSec > MAX_HINT_SEC;
    this.streak = long ? this.streak + 1 : 0;
    return this.streak >= MAX_CONSECUTIVE
      ? `${MAX_CONSECUTIVE} 429s in a row asked for a wait of more than ${MAX_HINT_SEC} s`
      : null;
  }
}

/**
 * The same provider, reporting every outcome to the watch. `onExhausted` runs when the watch says
 * stop; the original error is still thrown, so the caller's own handling is unchanged.
 */
export function watchProvider(
  provider: LlmProvider,
  watch: QuotaWatch,
  onExhausted: (reason: string) => void,
): LlmProvider {
  const guard = async <T>(call: () => Promise<T>): Promise<T> => {
    try {
      const result = await call();
      watch.success();
      return result;
    } catch (error) {
      const reason = watch.failure(error);
      if (reason) onExhausted(reason);
      throw error;
    }
  };
  return {
    name: provider.name,
    model: provider.model,
    fallbackModel: provider.fallbackModel,
    embedModel: provider.embedModel,
    generateJson: (options) => guard(() => provider.generateJson(options)),
    embed: (texts, purpose, signal) => guard(() => provider.embed(texts, purpose, signal)),
    chatWithTools: (options) => guard(() => provider.chatWithTools(options)),
  };
}

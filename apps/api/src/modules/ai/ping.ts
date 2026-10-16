import { z } from 'zod';
import type { AiClient } from './client.js';
import { classifyError } from './failure.js';
import type { FailureKind, LlmProvider } from './types.js';

export interface PingResult {
  call: 'generateJson' | 'chatWithTools';
  model: string;
  ok: boolean;
  kind: Exclude<FailureKind, 'breaker'> | null;
  status: number | null;
  latencyMs: number;
}

const pong = { name: 'pong', description: 'Answer the ping.', input: z.object({}) };
const answer = z.object({ ok: z.boolean() });
/** Room for a thinking model's hidden tokens, which count against the cap before any answer. */
const PING_MAX_TOKENS = 500;

/**
 * One tiny generateJson and one tiny chatWithTools call with each configured model (the primary,
 * then the fallback if there is one), straight to the provider with the same time limits as real
 * calls. It skips the breakers and writes nothing, so a health check can neither be blocked by a
 * failure nor cause one. Nothing about a user or a shop is ever sent.
 */
export async function pingAi(
  provider: LlmProvider,
  client: Pick<AiClient, 'timeoutFor'>,
): Promise<PingResult[]> {
  const models = [provider.model, ...(provider.fallbackModel ? [provider.fallbackModel] : [])];
  const results: PingResult[] = [];

  const time = async (
    call: PingResult['call'],
    model: string,
    limitMs: number,
    run: (signal: AbortSignal) => Promise<unknown>,
  ) => {
    const started = Date.now();
    const abort = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        run(abort.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            abort.abort();
            reject(Object.assign(new Error('timeout'), { name: 'PingTimeout' }));
          }, limitMs);
        }),
      ]);
      results.push({
        call,
        model,
        ok: true,
        kind: null,
        status: null,
        latencyMs: Date.now() - started,
      });
    } catch (error) {
      const failure =
        (error as Error).name === 'PingTimeout'
          ? { kind: 'timeout' as const, status: undefined }
          : classifyError(error);
      results.push({
        call,
        model,
        ok: false,
        kind: failure.kind,
        status: failure.status ?? null,
        latencyMs: Date.now() - started,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  for (const model of models) {
    await time('generateJson', model, client.timeoutFor('resolve_query'), (signal) =>
      provider.generateJson({
        system: 'Answer with a JSON object.',
        user: 'Reply with {"ok": true}.',
        schema: answer,
        maxOutputTokens: PING_MAX_TOKENS,
        purpose: 'resolve_query',
        model,
        signal,
      }),
    );
    await time('chatWithTools', model, client.timeoutFor('errand'), async (signal) => {
      const reply = await provider.chatWithTools({
        system: 'You are a health check. Call the pong tool.',
        messages: [{ role: 'user', text: 'ping' }],
        tools: [pong],
        forceTool: 'pong',
        maxOutputTokens: PING_MAX_TOKENS,
        purpose: 'errand',
        model,
        signal,
      });
      if (reply.toolCalls.length === 0 && !reply.text) throw new Error('empty answer');
    });
  }
  return results;
}

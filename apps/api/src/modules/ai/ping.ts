import { z } from 'zod';
import type { AiClient } from './client.js';
import { classifyError } from './failure.js';
import type { FailureKind, LlmProvider } from './types.js';

export interface PingResult {
  /** What the model is for: resolve_query (understanding a search) or errand (the agent). */
  purpose: 'resolve_query' | 'errand';
  /** Whether this line tested the purpose's primary model or its fallback. */
  role: 'primary' | 'fallback';
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
  client: Pick<AiClient, 'timeoutFor' | 'modelsFor'>,
): Promise<PingResult[]> {
  const results: PingResult[] = [];
  const modelsOf = (purpose: PingResult['purpose']) => {
    const { model, fallbackModel } = client.modelsFor(purpose);
    return [
      { role: 'primary' as const, model },
      ...(fallbackModel ? [{ role: 'fallback' as const, model: fallbackModel }] : []),
    ];
  };

  const time = async (
    purpose: PingResult['purpose'],
    role: PingResult['role'],
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
        purpose,
        role,
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
        purpose,
        role,
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

  // The models each purpose really runs on: the errand agent follows GEMINI_ERRAND_MODEL, the
  // rest of the app follows GEMINI_MODEL, so one bad name cannot hide behind the other.
  for (const { role, model } of modelsOf('resolve_query')) {
    await time(
      'resolve_query',
      role,
      'generateJson',
      model,
      client.timeoutFor('resolve_query'),
      (signal) =>
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
  }
  for (const { role, model } of modelsOf('errand')) {
    await time(
      'errand',
      role,
      'chatWithTools',
      model,
      client.timeoutFor('errand'),
      async (signal) => {
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
      },
    );
  }
  return results;
}

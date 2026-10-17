import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { FakeChatTurn, FakeProvider } from './fake.js';
import type { ChatMessage, ChatWithToolsOptions } from './types.js';

/**
 * A scripted model for end-to-end runs (LLM_PROVIDER=fake with FAKE_LLM_SCENARIO=<file>). The file
 * lists the turns the errand agent plays, in order. Nothing is kept in memory between calls: turn
 * n is played when the conversation already holds n model messages, so the script survives the
 * agent being resumed (after shops answer or the customer replies) and the API being restarted.
 *
 * An argument that is exactly `$item:<words>` becomes the id that resolve_item returned for those
 * words earlier in the conversation, so a script never needs the random ids of a database.
 */
const scenarioSchema = z.object({
  note: z.string().optional(),
  turns: z
    .array(
      z
        .object({
          toolCalls: z
            .array(z.object({ name: z.string().min(1), args: z.record(z.string(), z.unknown()) }))
            .optional(),
          text: z.string().optional(),
        })
        .refine((t) => (t.toolCalls?.length ?? 0) > 0 || t.text !== undefined, {
          message: 'a turn needs toolCalls or text',
        }),
    )
    .min(1),
});
export type Scenario = z.infer<typeof scenarioSchema>;

export const parseScenario = (data: unknown): Scenario => scenarioSchema.parse(data);
export const loadScenario = (path: string): Scenario =>
  parseScenario(JSON.parse(readFileSync(path, 'utf8')));

/** The item id resolve_item returned for these words, read from the conversation. */
function itemIdFor(messages: ChatMessage[], words: string): string | undefined {
  const asked = new Map<string, string>(); // call id → words
  for (const m of messages) {
    if (m.role === 'model')
      for (const c of m.toolCalls ?? [])
        if (c.name === 'resolve_item' && typeof c.args['text'] === 'string')
          asked.set(c.id, c.args['text']);
  }
  for (const m of messages) {
    if (m.role !== 'tool') continue;
    for (const r of m.results) {
      if (r.name !== 'resolve_item' || asked.get(r.id) !== words) continue;
      const id = (r.result as { item?: { id?: unknown } } | null)?.item?.id;
      if (typeof id === 'string') return id;
    }
  }
  return undefined;
}

function fill(value: unknown, messages: ChatMessage[]): unknown {
  if (typeof value === 'string' && value.startsWith('$item:')) {
    const id = itemIdFor(messages, value.slice('$item:'.length));
    if (!id) throw new Error(`scenario: no resolve_item result for "${value}" yet`);
    return id;
  }
  if (Array.isArray(value)) return value.map((v) => fill(v, messages));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, messages)]));
  return value;
}

/** The handler for FakeProvider.onChat. */
export function scenarioHandler(scenario: Scenario) {
  return async (request: ChatWithToolsOptions): Promise<FakeChatTurn> => {
    const n = request.messages.filter((m) => m.role === 'model').length;
    const turn = scenario.turns[n];
    if (!turn)
      throw new Error(`scenario ran out of turns (turn ${n + 1} of ${scenario.turns.length})`);
    return {
      ...(turn.toolCalls && {
        toolCalls: turn.toolCalls.map((c) => ({
          name: c.name,
          args: fill(c.args, request.messages) as Record<string, unknown>,
        })),
      }),
      ...(turn.text !== undefined && { text: turn.text }),
    };
  };
}

export const playScenario = (provider: FakeProvider, scenario: Scenario): void =>
  provider.onChat(scenarioHandler(scenario));

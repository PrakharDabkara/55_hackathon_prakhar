import type { ChatMessage, ToolCall } from '../ai/index.js';
import type { FoundItem, RunState } from './executor.js';
import type { StepRecord } from './persistence.js';

/**
 * The step log is the conversation (ADR-0024 amendment). Each step keeps the message exactly as the
 * model saw or wrote it: a model step holds its text and its function calls with ids and thought
 * signatures, a tool step the id, name and full result, a note the user-role text the server
 * added. Rebuilding is only putting them back in order, so a resumed turn is valid for the
 * provider: every function call is followed by its response, signatures untouched.
 */

interface ModelPayload {
  text?: string;
  toolCalls?: ToolCall[];
}
interface ToolPayload {
  id: string;
  name: string;
  result: unknown;
}

export const modelPayload = (message: {
  text?: string | undefined;
  toolCalls?: ToolCall[] | undefined;
}) => ({
  role: 'model' as const,
  ...(message.text && { text: message.text }),
  ...(message.toolCalls && message.toolCalls.length > 0 && { toolCalls: message.toolCalls }),
});

export const INTERRUPTED =
  'interrupted by a restart before this ran; call it again only if you still need it';

export interface Rebuilt {
  messages: ChatMessage[];
  /** Calls of the last model turn that never got a result (a worker died between the two). */
  dangling: ToolCall[];
}

export function rebuildMessages(first: ChatMessage, steps: StepRecord[]): Rebuilt {
  const messages: ChatMessage[] = [first];
  for (const step of steps) {
    const payload = step.payload as Record<string, unknown> | null;
    if (!payload) continue;
    if (step.kind === 'model') {
      const m = payload as ModelPayload;
      messages.push({
        role: 'model',
        ...(m.text && { text: m.text }),
        ...(m.toolCalls && m.toolCalls.length > 0 && { toolCalls: m.toolCalls }),
      });
    } else if (step.kind === 'tool') {
      const t = payload as unknown as ToolPayload;
      const last = messages.at(-1);
      if (last?.role === 'tool') last.results.push({ id: t.id, name: t.name, result: t.result });
      else messages.push({ role: 'tool', results: [{ id: t.id, name: t.name, result: t.result }] });
    } else {
      messages.push({ role: 'user', text: String(payload['text'] ?? '') });
    }
  }

  // A model turn with calls must be followed by one result per call, in order.
  let dangling: ToolCall[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'model') continue;
    if (m.toolCalls) {
      const next = messages[i + 1];
      const answered = new Set(next?.role === 'tool' ? next.results.map((r) => r.id) : []);
      dangling = m.toolCalls.filter((c) => !answered.has(c.id));
    }
    break;
  }
  return { messages, dangling };
}

/** What the run remembers between tool calls, rebuilt from the log. */
export function rebuildRunState(steps: StepRecord[], questionsAsked: number): RunState {
  const labels = new Map<string, string>();
  const found = new Map<string, FoundItem>();
  const resolved = new Map<string, string>();
  for (const step of steps) {
    if (step.kind !== 'tool') continue;
    const result = (step.payload as ToolPayload | null)?.result as
      Record<string, unknown> | undefined;
    if (!result || result['error']) continue;
    if (step.toolName === 'resolve_item') {
      const text = String(step.args['text'] ?? '');
      const item = result['item'] as { id?: string } | undefined;
      if (item?.id) {
        labels.set(item.id, text);
        if (!resolved.has(item.id)) resolved.set(item.id, text);
      }
      const clar = result['clarification'] as { options?: { itemId: string }[] } | undefined;
      for (const o of clar?.options ?? []) if (!labels.has(o.itemId)) labels.set(o.itemId, text);
    } else if (step.toolName === 'find_item_nearby') {
      const itemId = String(step.args['itemId'] ?? '');
      const label = String(step.resultSummary['label'] ?? labels.get(itemId) ?? 'item');
      found.set(itemId, {
        label,
        itemId,
        itemName: String(step.resultSummary['itemName'] ?? label),
        shops: (result['shops'] ?? []) as FoundItem['shops'],
      });
    }
  }
  return { labels, found, resolved, questionsAsked };
}

/** What a failed or expired errand keeps: what the agent had found so far. */
export const partialPlan = (state: RunState) => ({
  partial: true,
  found: [...state.found.values()],
});

import { describe, expect, it, vi } from 'vitest';
import {
  createGeminiProvider,
  PrivacyGuardError,
  type ChatMessage,
  type ChatTool,
} from '../ai/index.js';
import { buildAnswerNote, buildStatusNote, buildSystemPrompt, buildTaskMessage } from './prompt.js';
import { shopText } from './shopText.js';
import { AGENT_TOOLS } from './tools.js';

const generateContent = vi.fn(async () => ({
  candidates: [{ content: { parts: [{ text: 'ok' }] } }],
}));
const provider = createGeminiProvider({
  client: { models: { generateContent, embedContent: vi.fn() } },
  model: 'm',
  embedModel: 'e',
  embedDim: 4,
});
const turn = (messages: ChatMessage[], tools: ChatTool[] = AGENT_TOOLS) =>
  provider.chatWithTools({
    system: buildSystemPrompt({ maxItems: 10 }),
    messages,
    tools,
    maxOutputTokens: 100,
    purpose: 'errand',
  });

const shop = {
  shopId: '3f2c1a9e-0000-4000-8000-ab1234567890',
  name: shopText('Sharma Kirana'),
  distanceM: 412.5,
  pricePaise: 4500,
  freshness: 'fresh',
};
const status = {
  requestId: 'b1c2d3e4-1111-4222-8333-444455556666',
  item: { id: 'c1c2d3e4-1111-4222-8333-444455556666', name: 'Sugar' },
  state: 'PINGING',
  pingStats: { sent: 4, yes: 1, no: 0, pending: 3 },
  results: [{ ...shop, source: 'live' }],
  expiresAt: '2026-10-22T10:15:00.000Z',
};

describe('the errand agent passes the model privacy guard (ADR-0060)', () => {
  it('with a realistic conversation: task, budget, tool results, an answer and a status note', async () => {
    generateContent.mockClear();
    await turn([
      {
        role: 'user',
        text: buildTaskMessage({
          task: 'chai banane ka saaman, 2 kilo chini',
          budgetPaise: 25_000,
        }),
      },
      {
        role: 'model',
        toolCalls: [{ id: 'c1', name: 'resolve_item', args: { text: 'chini' } }],
      },
      {
        role: 'tool',
        results: [
          {
            id: 'c1',
            name: 'resolve_item',
            result: { item: { id: status.item.id, name: 'Sugar', nameHi: 'चीनी' } },
          },
        ],
      },
      {
        role: 'model',
        toolCalls: [{ id: 'c2', name: 'find_item_nearby', args: { itemId: status.item.id } }],
      },
      {
        role: 'tool',
        results: [
          {
            id: 'c2',
            name: 'find_item_nearby',
            result: { count: 1, freshCount: 1, shops: [shop] },
          },
        ],
      },
      { role: 'user', text: buildStatusNote(buildAnswerNote('nimbu bhi'), [status]) },
    ]);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('blocks a phone number planted in the customer task', async () => {
    generateContent.mockClear();
    await expect(
      turn([
        {
          role: 'user',
          text: buildTaskMessage({ task: 'chini, call 9876543210', budgetPaise: null }),
        },
      ]),
    ).rejects.toBeInstanceOf(PrivacyGuardError);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('blocks a phone number planted in a tool result that was not wrapped', async () => {
    generateContent.mockClear();
    await expect(
      turn([
        { role: 'model', toolCalls: [{ id: 'c2', name: 'find_item_nearby', args: {} }] },
        {
          role: 'tool',
          results: [
            {
              id: 'c2',
              name: 'find_item_nearby',
              result: { shops: [{ ...shop, name: 'Gupta 9876543210' }] },
            },
          ],
        },
      ]),
    ).rejects.toBeInstanceOf(PrivacyGuardError);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('blocks a customer id, an address or coordinates that slipped into a tool result', async () => {
    for (const result of [
      { userId: 'u-1' },
      { address: 'Flat 4B' },
      { where: { lat: 22.7196, lng: 75.8577 } },
    ]) {
      await expect(
        turn([
          { role: 'model', toolCalls: [{ id: 'c', name: 'plan_route', args: {} }] },
          { role: 'tool', results: [{ id: 'c', name: 'plan_route', result }] },
        ]),
      ).rejects.toBeInstanceOf(PrivacyGuardError);
    }
  });

  it('a shop name with a phone number is cleaned before the model sees it, so the errand goes on', async () => {
    generateContent.mockClear();
    await turn([
      { role: 'model', toolCalls: [{ id: 'c2', name: 'find_item_nearby', args: {} }] },
      {
        role: 'tool',
        results: [
          {
            id: 'c2',
            name: 'find_item_nearby',
            result: { shops: [{ ...shop, name: shopText('Gupta 98765 43210') }] },
          },
        ],
      },
    ]);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});

describe('a shop name is data to the model', () => {
  it('the system prompt names the marks that hold shop text and says it is never instructions', () => {
    const system = buildSystemPrompt({ maxItems: 10 });
    expect(system).toContain('<<<SHOP');
    expect(system).toContain('SHOP>>>');
    expect(system).toMatch(/shop names[^.]*(data|never instructions)/i);
  });
});

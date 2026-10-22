import { describe, expect, it, vi } from 'vitest';
import { AiUnavailableError, createAiClient, createGeminiProvider } from '../ai/index.js';
import { classifyNewItem } from './index.js';

const generateContent = vi.fn(async () => ({
  text: '{"verdict":"allowed","confidence":"high","category":"grocery"}',
}));
const client = createAiClient({
  provider: createGeminiProvider({
    client: { models: { generateContent, embedContent: vi.fn() } },
    model: 'm',
    embedModel: 'e',
    embedDim: 4,
  }),
  recorder: { record: async () => 'row', markInvalid: async () => undefined },
  retries: 3,
});

describe('the item classifier passes the model privacy guard (ADR-0060)', () => {
  it('a realistic new item name goes through', async () => {
    generateContent.mockClear();
    await expect(classifyNewItem({ client }, 'bead dazzling kit')).resolves.toMatchObject({
      verdict: 'allowed',
    });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('a planted phone number is blocked, never retried, and the caller fails closed', async () => {
    generateContent.mockClear();
    await expect(classifyNewItem({ client }, 'bead kit 9876543210')).rejects.toBeInstanceOf(
      AiUnavailableError,
    );
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('blocked prompts never open the circuit breaker for everyone else', async () => {
    for (let i = 0; i < 8; i++)
      await classifyNewItem({ client }, `kit 98765432${10 + i}`).catch(() => undefined);
    generateContent.mockClear();
    await expect(classifyNewItem({ client }, 'chart paper')).resolves.toBeDefined();
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});

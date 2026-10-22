import { describe, expect, it, vi } from 'vitest';
import {
  buildListResolvePrompt,
  buildResolvePrompt,
  createGeminiProvider,
  PrivacyGuardError,
  resolveAnswerSchema,
  resolveListAnswerSchema,
} from '../ai/index.js';

const generateContent = vi.fn(async () => ({
  text: '{"itemId":null,"needsClarification":false}',
}));
const provider = createGeminiProvider({
  client: { models: { generateContent, embedContent: vi.fn() } },
  model: 'm',
  embedModel: 'e',
  embedDim: 4,
});

const candidates = [
  {
    id: '3f2c1a9e-0000-4000-8000-ab1234567890',
    nameEn: 'Sugar',
    nameHi: 'चीनी',
    category: 'grocery',
  },
  {
    id: '4a2c1a9e-0000-4000-8000-000000000002',
    nameEn: 'Salt',
    nameHi: 'नमक',
    category: 'grocery',
  },
];

describe('resolve passes the model privacy guard (ADR-0060)', () => {
  it.each(['chini 1 kilo', 'आटा', 'bottle brsh', '2 litre sarson ka tel, 500 gram'])(
    'a realistic search "%s" goes through',
    async (query) => {
      generateContent.mockClear();
      const { system, user } = buildResolvePrompt(query, candidates);
      await provider.generateJson({
        system,
        user,
        schema: resolveAnswerSchema,
        maxOutputTokens: 100,
        purpose: 'resolve_query',
      });
      expect(generateContent).toHaveBeenCalledTimes(1);
    },
  );

  it('a planted phone number in the search is blocked before any request', async () => {
    generateContent.mockClear();
    const { system, user } = buildResolvePrompt('chini 98765 43210', candidates);
    await expect(
      provider.generateJson({
        system,
        user,
        schema: resolveAnswerSchema,
        maxOutputTokens: 100,
        purpose: 'resolve_query',
      }),
    ).rejects.toBeInstanceOf(PrivacyGuardError);
    expect(generateContent).not.toHaveBeenCalled();
  });
});

describe('resolveList passes the model privacy guard (ADR-0060)', () => {
  const lines = ['chini', 'namak 1 kg', 'आटा', 'chai patti'];
  const build = (texts: string[]) =>
    buildListResolvePrompt(texts.map((text, n) => ({ n, text, candidates })));
  const call = (texts: string[]) => {
    const { system, user } = build(texts);
    return provider.generateJson({
      system,
      user,
      schema: resolveListAnswerSchema,
      maxOutputTokens: 100,
      purpose: 'resolve_query',
    });
  };

  it('a realistic list goes through', async () => {
    generateContent.mockClear();
    generateContent.mockResolvedValueOnce({ text: '{"lines":[]}' });
    await call(lines);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('a 5-line shopping list with quantities, sizes and prices goes through', async () => {
    generateContent.mockClear();
    generateContent.mockResolvedValueOnce({ text: '{"lines":[]}' });
    await call([
      'rice 1.5 kg',
      '2.25 kg sugar, 1.75 l oil',
      'chart paper 10 sheets',
      'pincode 452010 wala stamp',
      'dal 2.5 kg under ₹1200',
    ]);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('a planted phone number or email on one line blocks the whole call', async () => {
    generateContent.mockClear();
    await expect(call([...lines, 'ring 9876543210'])).rejects.toBeInstanceOf(PrivacyGuardError);
    await expect(call([...lines, 'mail me a@b.in'])).rejects.toBeInstanceOf(PrivacyGuardError);
    expect(generateContent).not.toHaveBeenCalled();
  });
});

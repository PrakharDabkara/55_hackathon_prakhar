import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadSeedCatalog } from '../catalog/index.js';
import { buildSystemPrompt } from '../errands/prompt.js';
import { AGENT_TOOLS } from '../errands/tools.js';
import { buildClassifyPrompt } from '../safety/classify.js';
import { buildResolvePrompt } from './resolvePrompt.js';

// ADR-0048: users may type in any language, but everything we ask or show is English.
const HINGLISH =
  /kaunsi|kaunsa|kaunse|ye cheezein|chahiye\?|simple hinglish|in the customer's language|in the language the customer used/i;

describe('English on the AI side', () => {
  it('the resolve prompt asks the clarifying question in plain English', () => {
    const { system } = buildResolvePrompt('mirchi', []);
    expect(system).toMatch(/short question in plain English \(under 12 words\)/);
    expect(system).not.toMatch(/Hinglish \(under/);
    // The customer's text may still be Hindi, Devanagari or Hinglish.
    expect(system).toMatch(/English, Hindi \(Devanagari\) or Hinglish/);
  });

  it('the seed catalog asks its ambiguous questions in English', () => {
    const entries = loadSeedCatalog().ambiguous ?? [];
    expect(entries.length).toBeGreaterThanOrEqual(3);
    for (const entry of entries) {
      expect(entry.question, entry.question).not.toMatch(HINGLISH);
      expect(entry.question).toMatch(/^Which .+\?$/);
    }
  });

  it('the errand prompt tells the model to ask and write notes in plain English', () => {
    const system = buildSystemPrompt({ maxItems: 10 });
    expect(system).toMatch(/"Which of these do you need\?" in plain English/);
    expect(system).toMatch(/notes to one or two short lines in plain English/);
    expect(system).not.toMatch(HINGLISH);
    // Input may still be in any language.
    expect(system).toMatch(/Hindi, English or Hinglish/);
  });

  it('the agent tool descriptions and parameters name English questions and notes', () => {
    const text = JSON.stringify(
      AGENT_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        schema: z.toJSONSchema(t.input),
      })),
    );
    expect(text).not.toMatch(HINGLISH);
    expect(text).toMatch(/One short question, in plain English/);
    expect(text).toMatch(/in plain English/);
    expect(text).toMatch(/which colours, which sizes, which extras/);
  });

  it('the classifier may answer "other" when no kind of shop fits', () => {
    const { system } = buildClassifyPrompt('antique brass doorknob');
    expect(system).toMatch(/or "other" if none of them fits/);
    expect(system).toMatch(/or \\?"other\\?" if none fits/);
  });
});

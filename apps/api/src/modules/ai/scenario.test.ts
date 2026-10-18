import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatWithToolsOptions } from './types.js';
import { parseScenario, scenarioGenerateHandler, scenarioHandler } from './scenario.js';

const scenario = parseScenario({
  turns: [
    { toolCalls: [{ name: 'ask_user', args: { question: 'Kaunsi chai?', options: ['Dust'] } }] },
    { toolCalls: [{ name: 'resolve_item', args: { text: 'chini' } }] },
    {
      toolCalls: [
        { name: 'find_item_nearby', args: { itemId: '$item:chini' } },
        {
          name: 'ask_shops',
          args: { itemId: '$item:chini', note: 'literal $item:chini inside text' },
        },
      ],
    },
    { text: 'ok' },
  ],
});

const call = (id: string, name: string, args: Record<string, unknown>) => ({ id, name, args });
const request = (messages: ChatMessage[]) => ({ messages }) as unknown as ChatWithToolsOptions;

describe('the scripted fake model (FAKE_LLM_SCENARIO)', () => {
  const handler = scenarioHandler(scenario);

  it('plays turn n when the conversation already holds n model messages', async () => {
    const task: ChatMessage = { role: 'user', text: 'task' };
    expect(await handler(request([task]))).toMatchObject({
      toolCalls: [{ name: 'ask_user' }],
    });
    const history: ChatMessage[] = [
      task,
      { role: 'model', toolCalls: [call('c1', 'ask_user', {})] },
      { role: 'tool', results: [{ id: 'c1', name: 'ask_user', result: { ok: true } }] },
    ];
    expect(await handler(request(history))).toMatchObject({
      toolCalls: [{ name: 'resolve_item', args: { text: 'chini' } }],
    });
  });

  it('replaces $item:<words> with the id resolve_item returned for those words', async () => {
    const history: ChatMessage[] = [
      { role: 'user', text: 'task' },
      { role: 'model', toolCalls: [call('c1', 'ask_user', {})] },
      { role: 'tool', results: [{ id: 'c1', name: 'ask_user', result: {} }] },
      { role: 'model', toolCalls: [call('c2', 'resolve_item', { text: 'chini' })] },
      {
        role: 'tool',
        results: [{ id: 'c2', name: 'resolve_item', result: { item: { id: 'ITEM-SUGAR' } } }],
      },
    ];
    const turn = await handler(request(history));
    expect(turn).toMatchObject({
      toolCalls: [
        { name: 'find_item_nearby', args: { itemId: 'ITEM-SUGAR' } },
        { name: 'ask_shops', args: { itemId: 'ITEM-SUGAR' } },
      ],
    });
  });

  it('fails clearly when a placeholder has no matching resolve_item, or the script has run out', async () => {
    const lonely: ChatMessage[] = [
      { role: 'model', toolCalls: [call('a', 'x', {})] },
      { role: 'model', toolCalls: [call('b', 'x', {})] },
    ];
    await expect(handler(request(lonely))).rejects.toThrow(/\$item:chini/);
    const over = Array.from({ length: 4 }, (_, i) => ({
      role: 'model' as const,
      toolCalls: [call(`m${i}`, 'x', {})],
    }));
    await expect(handler(request(over))).rejects.toThrow(/ran out/);
  });
});

describe('parseScenario', () => {
  it('needs at least one turn, and each turn needs tool calls or text', () => {
    expect(() => parseScenario({ turns: [] })).toThrow();
    expect(() => parseScenario({ turns: [{}] })).toThrow();
    expect(() => parseScenario({ turns: [{ text: 'hi' }] })).not.toThrow();
  });
});

describe('several scripts in one scenario file, chosen by the task', () => {
  const multi = parseScenario({
    turns: [{ text: 'default' }],
    scripts: [
      { matchTask: 'bead dazzling', turns: [{ text: 'school project' }] },
      { matchTask: 'ghar ki safai', turns: [{ text: 'cleaning' }] },
    ],
  });
  const handler = scenarioHandler(multi);
  const task = (text: string): ChatMessage => ({ role: 'user', text: `<<<TASK\n${text}\nTASK>>>` });

  it('plays the script whose matchTask matches the task, else the default turns', async () => {
    expect(await handler(request([task('bachche ke liye bead dazzling kit')]))).toMatchObject({
      text: 'school project',
    });
    expect(await handler(request([task('Ghar ki safai')]))).toMatchObject({ text: 'cleaning' });
    expect(await handler(request([task('chai banane ka saaman')]))).toMatchObject({
      text: 'default',
    });
  });

  it('a file with scripts and no default turns is valid; a file with neither is not', () => {
    expect(() =>
      parseScenario({ scripts: [{ matchTask: 'x', turns: [{ text: 'a' }] }] }),
    ).not.toThrow();
    expect(() => parseScenario({})).toThrow();
    expect(() =>
      parseScenario({ scripts: [{ matchTask: '(', turns: [{ text: 'a' }] }] }),
    ).toThrow();
  });

  it('a task no script matches, with no default turns, fails clearly', async () => {
    const only = scenarioHandler(
      parseScenario({ scripts: [{ matchTask: 'x', turns: [{ text: 'a' }] }] }),
    );
    await expect(only(request([task('something else')]))).rejects.toThrow(/no script/i);
  });
});

describe('the scripted safety classifier', () => {
  const scenario = parseScenario({
    turns: [{ text: 'x' }],
    classify: [
      { match: 'bead dazzling', verdict: 'allowed', category: 'stationery' },
      { match: 'pistol', verdict: 'blocked' },
    ],
  });
  const generate = scenarioGenerateHandler(scenario);
  const classify = (name: string) =>
    generate({
      system: 's',
      user: `Item name:\n<<<ITEM\n${name}\nITEM>>>`,
      purpose: 'classify_item',
    });

  it('answers a new item by the first rule that matches its name, else nonsense', () => {
    expect(classify('Bead dazzling kit')).toEqual({
      verdict: 'allowed',
      confidence: 'high',
      category: 'stationery',
    });
    expect(classify('some pistol')).toEqual({ verdict: 'blocked' });
    expect(classify('xyzzy')).toEqual({ verdict: 'nonsense' });
  });

  it('knows nothing for the catalog resolver, as the plain fake does', () => {
    expect(generate({ system: 's', user: 'q', purpose: 'resolve_query' })).toEqual({
      itemId: null,
      needsClarification: false,
    });
  });
});

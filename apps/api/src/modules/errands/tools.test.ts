import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toolByName } from '@kahanmilega/shared/tools';
import { AGENT_TOOLS, submitPlanInput } from './tools.js';

const UUID = '3f2b8c1e-9a4d-4e6b-8c1d-2a7f5e9b0c11';
const names = AGENT_TOOLS.map((t) => t.name);

const keysDeep = (value: unknown): string[] =>
  value && typeof value === 'object'
    ? Object.entries(value).flatMap(([k, v]) => [k, ...keysDeep(v)])
    : [];

describe('the agent tools', () => {
  it('are resolve_item, find_item_nearby, plan_route and submit_plan: no ask_shops today', () => {
    expect(names).toEqual(['resolve_item', 'find_item_nearby', 'plan_route', 'submit_plan']);
  });

  it('never ask the model for a location: the server injects it', () => {
    for (const tool of AGENT_TOOLS) {
      const schema = JSON.stringify(z.toJSONSchema(tool.input));
      expect(keysDeep(JSON.parse(schema)), tool.name).not.toContain('lat');
      expect(keysDeep(JSON.parse(schema)), tool.name).not.toContain('lng');
      expect(keysDeep(JSON.parse(schema)), tool.name).not.toContain('start');
    }
  });

  it('say "near the user" where a location is involved', () => {
    for (const name of ['find_item_nearby', 'plan_route'])
      expect(AGENT_TOOLS.find((t) => t.name === name)?.description, name).toMatch(/near the user/i);
  });

  it('keep resolve_item exactly as the shared registry defines it', () => {
    const tool = AGENT_TOOLS.find((t) => t.name === 'resolve_item');
    expect(tool?.input).toBe(toolByName('resolve_item').input);
  });

  it('take shop ids, not coordinates, for plan_route', () => {
    const tool = AGENT_TOOLS.find((t) => t.name === 'plan_route');
    expect(tool?.input.safeParse({ shopIds: [UUID] }).success).toBe(true);
    expect(tool?.input.safeParse({ shopIds: [] }).success).toBe(false);
    expect(tool?.input.safeParse({ shopIds: Array(9).fill(UUID) }).success).toBe(false);
  });

  it('tell the agent to finish with submit_plan, and that likely means a shop in find_item_nearby', () => {
    const submit = AGENT_TOOLS.find((t) => t.name === 'submit_plan');
    expect(submit?.description).toMatch(/last|finish|final/i);
    expect(submit?.description).toMatch(/find_item_nearby/);
  });
});

describe('submit_plan input', () => {
  const item = {
    text: 'chini',
    itemId: UUID,
    quantity: 2,
    status: 'likely',
    shopId: UUID,
    pricePaise: 4800,
  };

  it('accepts likely and not_found items, optional notes', () => {
    expect(
      submitPlanInput.safeParse({ items: [item, { text: 'tape', status: 'not_found' }] }).success,
    ).toBe(true);
    expect(submitPlanInput.safeParse({ items: [item], notes: 'Hinglish note' }).success).toBe(true);
  });

  it('allows at most 10 items, at least 1, and only the two statuses', () => {
    expect(submitPlanInput.safeParse({ items: Array(10).fill(item) }).success).toBe(true);
    expect(submitPlanInput.safeParse({ items: Array(11).fill(item) }).success).toBe(false);
    expect(submitPlanInput.safeParse({ items: [] }).success).toBe(false);
    expect(submitPlanInput.safeParse({ items: [{ ...item, status: 'confirmed' }] }).success).toBe(
      false,
    );
  });

  it('does not insist ids are UUIDs: a made-up id must reach the server check, not break the plan', () => {
    expect(
      submitPlanInput.safeParse({ items: [{ ...item, itemId: 'item-1', shopId: 'shop-7' }] })
        .success,
    ).toBe(true);
  });
});

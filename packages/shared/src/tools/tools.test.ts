import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toJsonSchema, toolByName, tools } from './index.js';

const UUID = '3f2b8c1e-9a4d-4e6b-8c1d-2a7f5e9b0c11';

describe('the tool registry', () => {
  it('has the six tools, in the order an errand uses them', () => {
    expect(tools.map((t) => t.name)).toEqual([
      'resolve_item',
      'find_item_nearby',
      'ask_shops',
      'get_request_status',
      'close_request',
      'plan_route',
    ]);
  });

  it('gives every tool a description an AI can act on, and object schemas for input and output', () => {
    for (const t of tools) {
      expect(t.description.length, t.name).toBeGreaterThan(120);
      expect(t.input, t.name).toBeInstanceOf(z.ZodObject);
      expect(t.output, t.name).toBeInstanceOf(z.ZodObject);
      expect(typeof t.sideEffects, t.name).toBe('boolean');
      expect(typeof t.idempotent, t.name).toBe('boolean');
    }
  });

  it('marks exactly the tools that change the world as having side effects (resolve_item can add an item, ADR-0028)', () => {
    expect(tools.filter((t) => t.sideEffects).map((t) => t.name)).toEqual([
      'resolve_item',
      'ask_shops',
      'close_request',
    ]);
  });

  it('says ask_shops is not idempotent (unless a key is passed) and close_request is', () => {
    expect(toolByName('ask_shops').idempotent).toBe(false);
    expect(toolByName('close_request').idempotent).toBe(true);
    for (const name of ['resolve_item', 'find_item_nearby', 'get_request_status', 'plan_route'])
      expect(toolByName(name).idempotent, name).toBe(true);
  });

  it('writes the workflow into the descriptions', () => {
    expect(toolByName('resolve_item').description).toMatch(/find_item_nearby/);
    const nearby = toolByName('find_item_nearby').description;
    expect(nearby).toMatch(/first/i);
    expect(nearby).toMatch(/ask_shops/);
    const ask = toolByName('ask_shops').description;
    expect(ask).toMatch(/fewer than 3/i);
    expect(ask).toMatch(/real shops|pings/i);
    expect(ask).toMatch(/get_request_status/);
    const status = toolByName('get_request_status').description;
    expect(status).toMatch(/10.{1,6}20 s/);
    expect(status).toMatch(/close_request/);
    expect(toolByName('plan_route').description).toMatch(/8/);
  });

  it('throws for a name that is not a tool', () => {
    expect(() => toolByName('drop_tables')).toThrow(/unknown tool/i);
  });
});

describe('tool inputs', () => {
  const ok = (name: string, input: unknown) => toolByName(name).input.safeParse(input).success;

  it('resolve_item takes 1 to 200 characters of text', () => {
    expect(ok('resolve_item', { text: 'chini' })).toBe(true);
    expect(ok('resolve_item', { text: '  ' })).toBe(false);
    expect(ok('resolve_item', { text: 'x'.repeat(201) })).toBe(false);
  });

  it('find_item_nearby needs an item id and a location, and caps the radius at 5 km', () => {
    const base = { itemId: UUID, lat: 22.7, lng: 75.8 };
    expect(ok('find_item_nearby', base)).toBe(true);
    expect(ok('find_item_nearby', { ...base, radiusM: 5000 })).toBe(true);
    expect(ok('find_item_nearby', { ...base, radiusM: 5001 })).toBe(false);
    expect(ok('find_item_nearby', { ...base, itemId: 'sugar' })).toBe(false);
    expect(ok('find_item_nearby', { ...base, lat: 91 })).toBe(false);
    expect(ok('find_item_nearby', { ...base, lng: -181 })).toBe(false);
  });

  it('ask_shops takes an optional price in whole paise and an optional idempotency key', () => {
    const base = { itemId: UUID, lat: 22.7, lng: 75.8 };
    expect(ok('ask_shops', { ...base, targetPricePaise: 6000, idempotencyKey: 'abc' })).toBe(true);
    expect(ok('ask_shops', { ...base, targetPricePaise: 60.5 })).toBe(false);
    expect(ok('ask_shops', { ...base, idempotencyKey: '' })).toBe(false);
  });

  it('get_request_status and close_request take a request id', () => {
    for (const name of ['get_request_status', 'close_request']) {
      expect(ok(name, { requestId: UUID }), name).toBe(true);
      expect(ok(name, { requestId: 'nope' }), name).toBe(false);
    }
  });

  it('plan_route takes a start and 1 to 8 stops', () => {
    const stop = (n: number) => ({
      shopId: `s${n}`,
      lat: 22.7 + n / 1000,
      lng: 75.8,
      label: `Shop ${n}`,
    });
    const start = { lat: 22.7, lng: 75.8 };
    expect(ok('plan_route', { start, stops: [stop(1)] })).toBe(true);
    expect(ok('plan_route', { start, stops: Array.from({ length: 8 }, (_, i) => stop(i)) })).toBe(
      true,
    );
    expect(ok('plan_route', { start, stops: [] })).toBe(false);
    expect(ok('plan_route', { start, stops: Array.from({ length: 9 }, (_, i) => stop(i)) })).toBe(
      false,
    );
  });
});

describe('toJsonSchema (what the agent will hand to Gemini on Day 12)', () => {
  it('gives name, description, and JSON Schemas for input and output', () => {
    for (const t of tools) {
      const j = toJsonSchema(t);
      expect(j.name).toBe(t.name);
      expect(j.description).toBe(t.description);
      expect(j.inputSchema).toMatchObject({ type: 'object' });
      expect(j.outputSchema).toMatchObject({ type: 'object' });
    }
    const nearby = toJsonSchema(toolByName('find_item_nearby')).inputSchema as {
      required: string[];
      properties: Record<string, { description?: string }>;
    };
    expect(nearby.required).toEqual(expect.arrayContaining(['itemId', 'lat', 'lng']));
    expect(nearby.properties['radiusM']?.description).toMatch(/metres/i);
  });
});

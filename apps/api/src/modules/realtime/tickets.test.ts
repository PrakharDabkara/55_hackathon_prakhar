import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { consumeTicket, issueTicket, TICKET_TTL_SECONDS, type TicketStore } from './tickets.js';

/** The two Redis commands tickets use, kept in a map. */
function fakeStore() {
  const data = new Map<string, { value: string; ttl: number }>();
  const store: TicketStore = {
    async set(key, value, _mode, ttl) {
      data.set(key, { value, ttl });
      return 'OK';
    },
    async getdel(key) {
      const hit = data.get(key);
      data.delete(key);
      return hit?.value ?? null;
    },
  };
  return { store, data };
}

describe('tickets', () => {
  it('are random, long, and different every time', async () => {
    const { store } = fakeStore();
    const a = await issueTicket(store, { id: 'u1', role: 'shop' });
    const b = await issueTicket(store, { id: 'u1', role: 'shop' });
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43,}$/);
  });

  it('live 60 seconds by default', () => {
    expect(TICKET_TTL_SECONDS).toBe(60);
  });

  it('are stored only as a hash, with the user and role, and an expiry', async () => {
    const { store, data } = fakeStore();
    const ticket = await issueTicket(store, { id: 'u1', role: 'shop' });
    const [key, entry] = [...data.entries()][0] ?? [];
    expect(key).toBe(`ticket:${createHash('sha256').update(ticket).digest('hex')}`);
    expect(key).not.toContain(ticket);
    expect(entry?.value).not.toContain(ticket);
    expect(JSON.parse(entry?.value ?? '{}')).toEqual({ userId: 'u1', role: 'shop' });
    expect(entry?.ttl).toBe(60);
  });

  it('can be used once, then never again', async () => {
    const { store } = fakeStore();
    const ticket = await issueTicket(store, { id: 'u1', role: 'seeker' });
    expect(await consumeTicket(store, ticket)).toEqual({ userId: 'u1', role: 'seeker' });
    expect(await consumeTicket(store, ticket)).toBeNull();
  });

  it('are refused when unknown, empty or not text', async () => {
    const { store } = fakeStore();
    expect(await consumeTicket(store, 'nope')).toBeNull();
    expect(await consumeTicket(store, '')).toBeNull();
  });

  it('refuse a stored value that is not a ticket record', async () => {
    const { store, data } = fakeStore();
    const ticket = await issueTicket(store, { id: 'u1', role: 'shop' });
    for (const entry of data.values()) entry.value = 'not json';
    expect(await consumeTicket(store, ticket)).toBeNull();
  });
});

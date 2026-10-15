import { describe, expect, it } from 'vitest';
import { createHub, formatEvent, HEARTBEAT_FRAME } from './hub.js';

const sink = () => {
  const chunks: string[] = [];
  return { chunks, write: (c: string) => (chunks.push(c), true), end: () => chunks.push('<end>') };
};

describe('formatEvent', () => {
  it('writes an SSE frame: event name, one data line of JSON, a blank line', () => {
    expect(formatEvent('ping.created', { pingId: 'p1' })).toBe(
      'event: ping.created\ndata: {"pingId":"p1"}\n\n',
    );
  });

  it('keeps newlines in the data from breaking the frame', () => {
    const frame = formatEvent('x', { text: 'a\nb' });
    expect(frame.split('\n').filter((l) => l.startsWith('data:'))).toHaveLength(1);
  });
});

describe('heartbeat frame', () => {
  it('is a comment, which clients ignore and proxies count as traffic', () => {
    expect(HEARTBEAT_FRAME).toMatch(/^: .*\n\n$/);
  });
});

describe('hub', () => {
  it('delivers an event only to the user it is addressed to', () => {
    const hub = createHub();
    const a = sink();
    const b = sink();
    hub.add({ userId: 'a' }, a);
    hub.add({ userId: 'b' }, b);
    hub.dispatch({ to: { userId: 'a' }, type: 'request.updated', data: { n: 1 } });
    expect(a.chunks).toEqual([formatEvent('request.updated', { n: 1 })]);
    expect(b.chunks).toEqual([]);
  });

  it('delivers to every open connection of the same user', () => {
    const hub = createHub();
    const one = sink();
    const two = sink();
    hub.add({ userId: 'a' }, one);
    hub.add({ userId: 'a' }, two);
    hub.dispatch({ to: { userId: 'a' }, type: 't', data: {} });
    expect(one.chunks).toHaveLength(1);
    expect(two.chunks).toHaveLength(1);
  });

  it('keeps admin events away from users and user events away from admins', () => {
    const hub = createHub();
    const user = sink();
    const admin = sink();
    hub.add({ userId: 'a' }, user);
    hub.add({ admin: true }, admin);
    hub.dispatch({ to: { admin: true }, type: 'ping.created', data: {} });
    hub.dispatch({ to: { userId: 'a' }, type: 'request.updated', data: {} });
    expect(user.chunks).toEqual([formatEvent('request.updated', {})]);
    expect(admin.chunks).toEqual([formatEvent('ping.created', {})]);
  });

  it('removes a connection cleanly: nothing is delivered and nothing is left behind', () => {
    const hub = createHub();
    const a = sink();
    const remove = hub.add({ userId: 'a' }, a);
    expect(hub.size()).toBe(1);
    remove();
    remove(); // twice is harmless
    expect(hub.size()).toBe(0);
    hub.dispatch({ to: { userId: 'a' }, type: 't', data: {} });
    expect(a.chunks).toEqual([]);
  });

  it('drops a connection whose write throws, and keeps serving the others', () => {
    const hub = createHub();
    const bad = {
      write: () => {
        throw new Error('socket closed');
      },
      end: () => undefined,
    };
    const good = sink();
    hub.add({ userId: 'a' }, bad);
    hub.add({ userId: 'a' }, good);
    hub.dispatch({ to: { userId: 'a' }, type: 't', data: {} });
    expect(good.chunks).toHaveLength(1);
    expect(hub.size()).toBe(1);
  });

  it('closeAll ends every connection and empties the hub', () => {
    const hub = createHub();
    const a = sink();
    const admin = sink();
    hub.add({ userId: 'a' }, a);
    hub.add({ admin: true }, admin);
    hub.closeAll();
    expect(a.chunks).toEqual(['<end>']);
    expect(admin.chunks).toEqual(['<end>']);
    expect(hub.size()).toBe(0);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEventSource } from '../test/fakes.js';
import { connectLive } from './live.js';

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.reset();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(getTicket = vi.fn(async () => `ticket-${FakeEventSource.instances.length + 1}`)) {
  const onEvent = vi.fn();
  const onStatus = vi.fn();
  const connection = connectLive({
    getTicket,
    onEvent,
    onStatus,
    createSource: (url) => new FakeEventSource(url),
    retryMs: 1000,
  });
  return { getTicket, onEvent, onStatus, connection };
}

describe('connectLive', () => {
  it('opens the stream with a ticket in the URL and nothing else', async () => {
    setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.last().url).toBe('/events?ticket=ticket-1');
  });

  it('reports live only once the stream is open', async () => {
    const { onStatus } = setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(onStatus).not.toHaveBeenCalledWith(true);
    FakeEventSource.last().open();
    expect(onStatus).toHaveBeenLastCalledWith(true);
  });

  it('tells the caller about each kind of event, and ignores the payload', async () => {
    const { onEvent } = setup();
    await vi.advanceTimersByTimeAsync(0);
    const source = FakeEventSource.last();
    source.emit('ping.created', { pingId: 'p1' });
    source.emit('ping.closed', { pingId: 'p1' });
    source.emit('request.updated', { requestId: 'r1', state: 'ANSWERED' });
    expect(onEvent.mock.calls.map((c) => c[0])).toEqual([
      'ping.created',
      'ping.closed',
      'request.updated',
    ]);
  });

  it('on a drop: closes the stream, goes not-live, and reconnects with a NEW ticket', async () => {
    const { getTicket, onStatus } = setup();
    await vi.advanceTimersByTimeAsync(0);
    const first = FakeEventSource.last();
    first.open();
    first.fail();
    expect(first.closed).toBe(true); // we never let the browser retry with the used-up ticket
    expect(onStatus).toHaveBeenLastCalledWith(false);

    await vi.advanceTimersByTimeAsync(999);
    expect(FakeEventSource.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(getTicket).toHaveBeenCalledTimes(2);
    expect(FakeEventSource.last().url).not.toBe(first.url);
  });

  it('keeps trying, a little slower each time, while tickets cannot be had', async () => {
    const getTicket = vi.fn(async () => {
      throw new Error('offline');
    });
    const { onStatus } = setup(getTicket);
    await vi.advanceTimersByTimeAsync(0);
    expect(getTicket).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenLastCalledWith(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(getTicket).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1500);
    expect(getTicket).toHaveBeenCalledTimes(2); // the second wait is longer than the first
    await vi.advanceTimersByTimeAsync(1000);
    expect(getTicket).toHaveBeenCalledTimes(3);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('close() shuts the stream and stops everything, even a pending retry', async () => {
    const { connection, onEvent, onStatus } = setup();
    await vi.advanceTimersByTimeAsync(0);
    const first = FakeEventSource.last();
    first.fail();
    connection.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(first.closed).toBe(true);
    onStatus.mockClear();
    first.emit('ping.created');
    first.open();
    expect(onEvent).not.toHaveBeenCalled();
    expect(onStatus).not.toHaveBeenCalled();
  });

  it('close() while a ticket is still being fetched never opens a stream', async () => {
    let release: (t: string) => void = () => undefined;
    const getTicket = vi.fn(() => new Promise<string>((resolve) => (release = resolve)));
    const { connection } = setup(getTicket);
    connection.close();
    release('late-ticket');
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeEventSource.instances).toHaveLength(0);
  });
});

describe('LIVE_EVENTS (Day 14b)', () => {
  it('includes errand.updated, so an errand screen refetches when its errand moves', async () => {
    const { LIVE_EVENTS } = await import('./live.js');
    expect(LIVE_EVENTS).toContain('errand.updated');
  });
});

describe('LIVE_EVENTS (Day 16)', () => {
  it('includes the order events, so the customer and the shop see an order move', async () => {
    const { LIVE_EVENTS } = await import('./live.js');
    expect(LIVE_EVENTS).toContain('order.created');
    expect(LIVE_EVENTS).toContain('order.updated');
  });

  it('hands the payload to the caller as a second argument (a ping.closed says why), still only a hint', async () => {
    const { onEvent } = setup();
    await vi.advanceTimersByTimeAsync(0);
    FakeEventSource.last().emit('ping.closed', { pingId: 'p1', reason: 'enough_answers' });
    expect(onEvent).toHaveBeenCalledWith('ping.closed', { pingId: 'p1', reason: 'enough_answers' });
  });
});

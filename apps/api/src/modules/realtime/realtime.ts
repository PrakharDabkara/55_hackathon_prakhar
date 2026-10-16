import type { Request, Response } from 'express';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { Role } from '@kahanmilega/shared';
import { closeWithin, connect, withTimeout } from '../../workers/redis.js';
import { createHub, HEARTBEAT_FRAME } from './hub.js';
import {
  consumeTicket,
  issueTicket,
  TICKET_TTL_SECONDS,
  type TicketHolder,
  type TicketStore,
} from './tickets.js';
import type { Audience, EventPublisher, RealtimeEvent } from './types.js';

/** One channel for every event; each API instance filters to the streams it holds. */
export const EVENTS_CHANNEL = 'kahanmilega:events';
export const HEARTBEAT_MS = 20_000;
const REDIS_TIMEOUT_MS = 2000;

export interface Realtime {
  /** False when there is no Redis: events go nowhere and tickets cannot be issued. */
  enabled: boolean;
  events: EventPublisher;
  /**
   * Calls `listener` for every event this process publishes, whether or not Redis is there. For
   * in-process reactions such as waking an errand whose request was answered (ADR-0024).
   */
  onPublish(listener: (event: RealtimeEvent) => void): void;
  ticketTtlSeconds: number;
  issueTicket(user: { id: string; role: Role }): Promise<string>;
  /** Single use: the second call with the same ticket returns null. */
  consumeTicket(ticket: string): Promise<TicketHolder | null>;
  /** Turns the response into an event stream for `audience`. Removes the connection when it closes. */
  openStream(req: Request, res: Response, audience: Audience): void;
  connectionCount(): number;
  /** Ends every open stream (called first on shutdown: server.close waits for them). */
  drain(): void;
  close(): Promise<void>;
}

interface Options {
  redisUrl: string | null;
  logger: Logger;
  heartbeatMs?: number;
  ticketTtlSeconds?: number;
}

/**
 * Server-sent events with fan-out through Redis pub/sub (ADR-0018). Any instance publishes to one
 * channel; every instance, through its own dedicated subscriber connection, delivers to the streams
 * it holds. Without a Redis URL everything is switched off and callers fall back to polling.
 */
export function createRealtime(options: Options): Realtime {
  const core = createRealtimeCore(options);
  const listeners: ((event: RealtimeEvent) => void)[] = [];
  return {
    ...core,
    events: {
      publish(event, log) {
        core.events.publish(event, log);
        for (const listener of listeners) {
          try {
            listener(event);
          } catch (err) {
            (log ?? options.logger).warn(
              { type: event.type, reason: (err as Error).message },
              'an event listener failed',
            );
          }
        }
      },
    },
    onPublish: (listener) => void listeners.push(listener),
  };
}

function createRealtimeCore({
  redisUrl,
  logger,
  heartbeatMs = HEARTBEAT_MS,
  ticketTtlSeconds = TICKET_TTL_SECONDS,
}: Options): Omit<Realtime, 'onPublish'> {
  const hub = createHub();
  const base = { ticketTtlSeconds, connectionCount: hub.size, drain: hub.closeAll };

  const openStream: Realtime['openStream'] = (req, res, audience) => {
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // proxies must not hold the stream back
    });
    res.flushHeaders();
    // `retry` is how long the browser waits before reconnecting; the comment makes onopen fire.
    res.write('retry: 3000\n\n: connected\n\n');

    const remove = hub.add(audience, { write: (c) => res.write(c), end: () => res.end() });
    const timer = setInterval(() => res.write(HEARTBEAT_FRAME), heartbeatMs);
    const log = req.log ?? logger;
    log.info({ connections: hub.size() }, 'event stream opened');
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      remove();
      log.info({ connections: hub.size() }, 'event stream closed');
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
  };

  if (!redisUrl) {
    return {
      ...base,
      enabled: false,
      events: { publish: () => undefined },
      issueTicket: () => Promise.reject(new Error('realtime is not enabled')),
      consumeTicket: () => Promise.resolve(null),
      openStream,
      close: async () => hub.closeAll(),
    };
  }

  // Commands fail fast so a Redis outage costs a warning, not a stuck request.
  const commands: Redis = connect(redisUrl, logger, {
    maxRetriesPerRequest: 1,
    commandTimeout: REDIS_TIMEOUT_MS,
  });
  // A subscribed connection can do nothing else, so it is dedicated.
  const subscriber: Redis = connect(redisUrl, logger);
  const store = commands as unknown as TicketStore;

  subscriber.on('message', (_channel: string, message: string) => {
    try {
      hub.dispatch(JSON.parse(message) as RealtimeEvent);
    } catch (err) {
      logger.warn({ reason: (err as Error).message }, 'ignored a malformed event');
    }
  });
  // ioredis subscribes again by itself after a reconnect.
  subscriber
    .subscribe(EVENTS_CHANNEL)
    .catch((err: Error) => logger.warn({ reason: err.message }, 'could not subscribe to events'));

  return {
    ...base,
    enabled: true,
    events: {
      publish(event, log) {
        const where = log ?? logger;
        try {
          void withTimeout(
            commands.publish(EVENTS_CHANNEL, JSON.stringify(event)),
            REDIS_TIMEOUT_MS,
            'publishing an event',
          )
            .then(() => where.debug({ type: event.type }, 'event published'))
            .catch((err: Error) =>
              where.warn({ type: event.type, reason: err.message }, 'could not publish event'),
            );
        } catch (err) {
          where.warn(
            { type: event.type, reason: (err as Error).message },
            'could not publish event',
          );
        }
      },
    },
    issueTicket: (user) =>
      withTimeout(issueTicket(store, user, ticketTtlSeconds), REDIS_TIMEOUT_MS, 'issuing a ticket'),
    consumeTicket: (ticket) =>
      withTimeout(consumeTicket(store, ticket), REDIS_TIMEOUT_MS, 'redeeming a ticket'),
    openStream,
    close: () =>
      closeWithin(3000, [
        async () => hub.closeAll(),
        async () => {
          subscriber.disconnect();
          commands.disconnect();
        },
      ]),
  };
}

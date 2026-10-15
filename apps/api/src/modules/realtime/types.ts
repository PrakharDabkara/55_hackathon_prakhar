import type { Logger } from 'pino';

/** Who an event is for: one user's open streams, or the admin simulator stream. */
export type Audience = { userId: string } | { admin: true };

export interface RealtimeEvent {
  to: Audience;
  /** e.g. `request.updated`. Events are hints: clients refetch, they never trust the payload. */
  type: string;
  data: unknown;
}

/** Fire and forget: never throws, never waits. A lost event is repaired by the client's next fetch. */
export interface EventPublisher {
  publish(event: RealtimeEvent, log?: Logger): void;
}

/** For code and tests that run without Redis. */
export const noopPublisher: EventPublisher = { publish: () => undefined };

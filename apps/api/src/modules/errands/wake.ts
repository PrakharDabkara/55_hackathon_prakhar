import type { Logger } from 'pino';
import type { Database } from '../../db/queryable.js';
import { waitingOnRequest } from './persistence.js';
import { resumeIfDue, wake, type EnqueueErrand, type ErrandLimits } from './service.js';
import type { EventPublisher } from '../realtime/index.js';

export interface ErrandWaker {
  /** Call after a request changed state (the existing request.updated publish, after commit). */
  onRequestUpdated(requestId: string): void;
  /** Cancels pending checks (shutdown, tests). */
  close(): void;
}

/**
 * Wakes waiting errands when their shops answer (ADR-0024 amendment). A burst of answers (many
 * shops saying yes within a second) must cause one resume, not a pile: the first update for an
 * errand starts a short timer, updates during it add nothing, and when it fires the errand is
 * checked once. The check is the same guarded UPDATE the timer and the sweeper use, so even a
 * stray second check could not resume an errand twice. It runs in the process that published the
 * update; if another instance answered, the 60 s sweeper (or the resume timer) catches it.
 */
export function createErrandWaker({
  db,
  logger,
  limits,
  enqueue,
  events,
}: {
  db: Database;
  logger: Logger;
  limits: Pick<ErrandLimits, 'resumeDebounceMs'>;
  enqueue?: EnqueueErrand | undefined;
  events?: EventPublisher | undefined;
}): ErrandWaker {
  const pending = new Map<string, NodeJS.Timeout>();

  async function check(errandId: string) {
    pending.delete(errandId);
    try {
      if ((await resumeIfDue({ db, events }, errandId)) === 'resumed') {
        logger.info({ errandId }, 'errand resumed: shops answered');
        await wake({ db, logger, enqueue }, errandId, 'r');
      }
    } catch (error) {
      logger.warn({ errandId, reason: (error as Error).message }, 'errand resume check failed');
    }
  }

  return {
    onRequestUpdated(requestId) {
      void waitingOnRequest(db, requestId)
        .then((errandIds) => {
          for (const errandId of errandIds) {
            if (pending.has(errandId)) continue;
            const timer = setTimeout(() => void check(errandId), limits.resumeDebounceMs);
            timer.unref();
            pending.set(errandId, timer);
          }
        })
        .catch((error: Error) =>
          logger.warn({ requestId, reason: error.message }, 'could not look up waiting errands'),
        );
    },
    close() {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    },
  };
}

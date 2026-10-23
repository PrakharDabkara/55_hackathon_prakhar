import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage<{ requestId: string }>();

/** Runs `fn` with `requestId` as the id of everything it starts: logs, and jobs it queues. */
export const runWithRequestId = <T>(requestId: string, fn: () => T): T =>
  store.run({ requestId }, fn);

/** The id of the request this code runs for, or undefined outside one (a timer, a worker). */
export const currentRequestId = (): string | undefined => store.getStore()?.requestId;

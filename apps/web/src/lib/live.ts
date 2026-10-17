/** The part of EventSource we use, so tests can drive it by hand. */
export interface EventSourceLike {
  onopen: ((event: never) => unknown) | null;
  onerror: ((event: never) => unknown) | null;
  addEventListener(type: string, listener: (event: { data: string }) => void): void;
  close(): void;
}

/** Event names the server sends. They are hints: the payload is never used, the screen refetches. */
export const LIVE_EVENTS = [
  'ping.created',
  'ping.closed',
  'request.updated',
  'errand.updated',
] as const;

export interface LiveOptions {
  /** A new one-time ticket. Called again on every reconnect, because a ticket works once. */
  getTicket: () => Promise<string>;
  onEvent: (type: string) => void;
  onStatus: (live: boolean) => void;
  createSource?: (url: string) => EventSourceLike;
  retryMs?: number;
  maxRetryMs?: number;
}

export interface LiveConnection {
  close(): void;
}

/** Whether this browser can open an event stream at all. */
export const canGoLive = () => typeof EventSource !== 'undefined';

/**
 * Keeps one server-sent event stream open. When it drops we close it ourselves and open a new one
 * with a new ticket after a pause that doubles up to a limit: the browser's own retry would reuse
 * the URL, whose ticket is already used up.
 */
export function connectLive({
  getTicket,
  onEvent,
  onStatus,
  createSource = (url) => new EventSource(url),
  retryMs = 3000,
  maxRetryMs = 30_000,
}: LiveOptions): LiveConnection {
  let closed = false;
  let source: EventSourceLike | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let delay = retryMs;

  function retryLater() {
    if (closed) return;
    onStatus(false);
    timer = setTimeout(() => void open(), delay);
    delay = Math.min(delay * 2, maxRetryMs);
  }

  async function open() {
    let ticket: string;
    try {
      ticket = await getTicket();
    } catch {
      retryLater();
      return;
    }
    if (closed) return;

    const mine = createSource(`/events?ticket=${encodeURIComponent(ticket)}`);
    source = mine;
    mine.onopen = () => {
      if (closed || source !== mine) return;
      delay = retryMs;
      onStatus(true);
    };
    mine.onerror = () => {
      if (closed || source !== mine) return;
      mine.close();
      source = null;
      retryLater();
    };
    for (const type of LIVE_EVENTS) {
      mine.addEventListener(type, () => {
        if (!closed && source === mine) onEvent(type);
      });
    }
  }

  void open();

  return {
    close() {
      closed = true;
      clearTimeout(timer);
      source?.close();
      source = null;
    },
  };
}

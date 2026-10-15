import { useEffect, useState } from 'react';
import { canGoLive, connectLive, type LiveOptions } from './live.js';

interface Options {
  getTicket: () => Promise<string>;
  /** Called on every event (a hint) and on every fallback poll. */
  refresh: () => void;
  pollMs: number;
  /** For tests: a stand-in for EventSource and a short reconnect pause. */
  live?: Pick<LiveOptions, 'createSource' | 'retryMs'> | undefined;
}

/**
 * Keeps a screen fresh: a refetch on each server event, plus a plain poll in case the stream is
 * down. Returns whether the stream is open, for the "live" dot.
 */
export function useLive({ getTicket, refresh, pollMs, live }: Options): boolean {
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    const timer = setInterval(refresh, pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs]);

  useEffect(() => {
    if (!live?.createSource && !canGoLive()) return;
    const connection = connectLive({
      getTicket,
      onEvent: refresh,
      onStatus: setIsLive,
      ...live,
    });
    return () => connection.close();
  }, [getTicket, refresh, live]);

  return isLive;
}

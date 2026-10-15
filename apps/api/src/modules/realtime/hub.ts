import type { Audience, RealtimeEvent } from './types.js';

/** A comment line: clients ignore it, proxies see traffic and keep the connection open. */
export const HEARTBEAT_FRAME = ': heartbeat\n\n';

/** One SSE frame. JSON never contains a raw newline, so the data stays on one line. */
export const formatEvent = (type: string, data: unknown): string =>
  `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

export interface Sink {
  write(chunk: string): unknown;
  end(): void;
}

export interface Hub {
  /** Registers a connection; the returned function removes it (safe to call twice). */
  add(audience: Audience, sink: Sink): () => void;
  dispatch(event: RealtimeEvent): void;
  size(): number;
  closeAll(): void;
}

/** The open streams of this process, indexed by who they belong to. */
export function createHub(): Hub {
  const byUser = new Map<string, Set<Sink>>();
  const admins = new Set<Sink>();

  const setFor = (audience: Audience, create: boolean): Set<Sink> | undefined => {
    if ('admin' in audience) return admins;
    let set = byUser.get(audience.userId);
    if (!set && create) byUser.set(audience.userId, (set = new Set()));
    return set;
  };

  const remove = (audience: Audience, sink: Sink) => {
    const set = setFor(audience, false);
    set?.delete(sink);
    if (set && set.size === 0 && 'userId' in audience) byUser.delete(audience.userId);
  };

  return {
    add(audience, sink) {
      setFor(audience, true)?.add(sink);
      return () => remove(audience, sink);
    },
    dispatch(event) {
      const frame = formatEvent(event.type, event.data);
      for (const sink of [...(setFor(event.to, false) ?? [])]) {
        try {
          sink.write(frame);
        } catch {
          remove(event.to, sink);
          try {
            sink.end();
          } catch {
            // already gone
          }
        }
      }
    },
    size() {
      let n = admins.size;
      for (const set of byUser.values()) n += set.size;
      return n;
    },
    closeAll() {
      const all = [...admins, ...[...byUser.values()].flatMap((s) => [...s])];
      admins.clear();
      byUser.clear();
      for (const sink of all) {
        try {
          sink.end();
        } catch {
          // already gone
        }
      }
    },
  };
}

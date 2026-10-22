/** A tiny SSE reader for tests: opens a stream with fetch and collects events and comments. */
export interface SseEvent {
  type: string;
  data: Record<string, unknown>;
}

export interface SseStream {
  status: number;
  contentType: string | null;
  events: SseEvent[];
  comments: string[];
  /** True once the server has ended the stream (not when the test closed it). */
  ended: boolean;
  /** Resolves with the first event (not yet returned) matching, or rejects after `ms`. */
  waitForEvent(type: string, ms?: number): Promise<SseEvent>;
  close(): void;
}

export async function openSse(url: string): Promise<SseStream> {
  const abort = new AbortController();
  const res = await fetch(url, { signal: abort.signal, headers: { accept: 'text/event-stream' } });
  const stream: SseStream = {
    status: res.status,
    contentType: res.headers.get('content-type'),
    events: [],
    comments: [],
    ended: false,
    waitForEvent: async (type, ms = 10_000) => {
      const deadline = Date.now() + ms;
      for (;;) {
        const hit = stream.events.find((e) => e.type === type && !taken.has(e));
        if (hit) {
          taken.add(hit);
          return hit;
        }
        if (Date.now() > deadline) throw new Error(`no "${type}" event within ${ms} ms`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
    close: () => abort.abort(),
  };
  const taken = new Set<SseEvent>();
  if (res.status !== 200 || !res.body) {
    await res.body?.cancel().catch(() => undefined);
    return stream;
  }

  void (async () => {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let end: number;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          let type = 'message';
          let data = '';
          for (const line of frame.split('\n')) {
            if (line.startsWith(':')) stream.comments.push(line.slice(1).trim());
            else if (line.startsWith('event:')) type = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (data) stream.events.push({ type, data: JSON.parse(data) as Record<string, unknown> });
        }
      }
      if (!abort.signal.aborted) stream.ended = true;
    } catch {
      // closed by the test
    }
  })();
  return stream;
}

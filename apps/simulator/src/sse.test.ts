import { describe, expect, it } from 'vitest';
import { readSse, type SseMessage } from './sse.ts';

const enc = new TextEncoder();
async function* chunks(...parts: string[]) {
  for (const p of parts) yield enc.encode(p);
}
const collect = async (source: AsyncIterable<Uint8Array>) => {
  const out: SseMessage[] = [];
  for await (const m of readSse(source)) out.push(m);
  return out;
};

describe('readSse', () => {
  it('reads an event with a name and JSON data', async () => {
    const out = await collect(chunks('event: ping.created\ndata: {"pingId":"p1"}\n\n'));
    expect(out).toEqual([{ event: 'ping.created', data: { pingId: 'p1' } }]);
  });

  it('ignores comments (heartbeats) and the retry line', async () => {
    const out = await collect(
      chunks('retry: 3000\n\n: connected\n\n: heartbeat\n\nevent: a\ndata: {"n":1}\n\n'),
    );
    expect(out).toEqual([{ event: 'a', data: { n: 1 } }]);
  });

  it('puts together an event split across chunks, even in the middle of a character', async () => {
    const bytes = enc.encode('event: x\ndata: {"name":"आटा"}\n\n');
    const cut = 22; // inside the multi-byte text
    async function* split() {
      yield bytes.slice(0, cut);
      yield bytes.slice(cut);
    }
    expect(await collect(split())).toEqual([{ event: 'x', data: { name: 'आटा' } }]);
  });

  it('reads several events from one chunk, and handles CRLF line ends', async () => {
    const out = await collect(
      chunks('event: a\r\ndata: {"n":1}\r\n\r\nevent: b\ndata: {"n":2}\n\n'),
    );
    expect(out.map((m) => m.event)).toEqual(['a', 'b']);
  });

  it('skips a frame whose data is not JSON instead of ending the stream', async () => {
    const out = await collect(chunks('event: bad\ndata: not json\n\nevent: ok\ndata: {}\n\n'));
    expect(out).toEqual([{ event: 'ok', data: {} }]);
  });

  it('defaults the name to "message" and ends cleanly when the stream ends mid-frame', async () => {
    expect(await collect(chunks('data: {"a":1}\n\nevent: half\ndata: {'))).toEqual([
      { event: 'message', data: { a: 1 } },
    ]);
  });
});

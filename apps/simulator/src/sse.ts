export interface SseMessage {
  event: string;
  data: unknown;
}

/**
 * Reads a server-sent event stream (fetch's body) into messages. Comments such as the heartbeat
 * are skipped, and so is any frame whose data is not JSON, so one bad frame cannot end the stream.
 */
export async function* readSse(source: AsyncIterable<Uint8Array>): AsyncGenerator<SseMessage> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of source) {
    buffer = (buffer + decoder.decode(chunk, { stream: true })).replace(/\r\n/g, '\n');
    let end: number;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const message = parseFrame(frame);
      if (message) yield message;
    }
  }
}

function parseFrame(frame: string): SseMessage | null {
  let event = 'message';
  let data = '';
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!data) return null;
  try {
    return { event, data: JSON.parse(data) };
  } catch {
    return null;
  }
}

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api.js';
import { createPhotoApi } from './photoApi.js';

/** An XMLHttpRequest the test drives by hand. */
class FakeXhr {
  static last: FakeXhr;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown = null;
  status = 0;
  responseText = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  upload = {
    onprogress: null as
      ((e: { loaded: number; total: number; lengthComputable: boolean }) => void) | null,
  };
  timeout = 0;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
  }
  finish(status: number, json: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(json);
    this.onload?.();
  }
}

const make = (extra: Partial<Parameters<typeof createPhotoApi>[0]> = {}) =>
  createPhotoApi({
    getToken: () => 'tok',
    onUnauthorized: vi.fn(),
    xhr: () => new FakeXhr() as unknown as XMLHttpRequest,
    ...extra,
  });
const blob = new Blob(['x'], { type: 'image/jpeg' });

describe('uploadPhoto', () => {
  it('posts the bytes with the login, and reports progress as a whole percent', async () => {
    const onProgress = vi.fn();
    const pending = make().uploadPhoto(blob, { role: 'request', onProgress });
    const x = FakeXhr.last;
    expect(x.method).toBe('POST');
    expect(x.url).toBe('/photos?role=request');
    expect(x.headers['Authorization']).toBe('Bearer tok');
    expect(x.headers['Content-Type']).toBe('image/jpeg');
    expect(x.body).toBe(blob);
    x.upload.onprogress?.({ loaded: 25, total: 100, lengthComputable: true });
    x.upload.onprogress?.({ loaded: 100, total: 100, lengthComputable: true });
    x.finish(201, { id: 'p1', mime: 'image/jpeg', size: 10 });
    await expect(pending).resolves.toEqual({ id: 'p1' });
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([25, 100]);
  });

  it('names the errand and the checklist item when the photo is for one', async () => {
    const pending = make().uploadPhoto(blob, {
      role: 'request',
      errand: { id: 'e 1', label: 'chart paper' },
    });
    expect(FakeXhr.last.url).toBe('/photos?role=request&errandId=e+1&label=chart+paper');
    FakeXhr.last.finish(201, { id: 'p2' });
    await pending;
  });

  it("turns the server's refusals into errors with their codes", async () => {
    for (const [status, code] of [
      [400, 'invalid_image'],
      [413, 'photo_too_large'],
      [429, 'photo_limit'],
      [503, 'photo_storage_full'],
    ] as const) {
      const pending = make().uploadPhoto(blob, { role: 'answer' });
      FakeXhr.last.finish(status, { error: { code, message: 'no' } });
      await expect(pending).rejects.toMatchObject({ status, code });
      await expect(pending).rejects.toBeInstanceOf(ApiError);
    }
  });

  it('a dropped connection and a timeout are clear errors, not a hang', async () => {
    const a = make().uploadPhoto(blob, { role: 'request' });
    FakeXhr.last.onerror?.();
    await expect(a).rejects.toMatchObject({ code: 'network' });
    const b = make().uploadPhoto(blob, { role: 'request' });
    FakeXhr.last.ontimeout?.();
    await expect(b).rejects.toMatchObject({ code: 'network' });
  });

  it('an expired login signs out', async () => {
    const onUnauthorized = vi.fn();
    const pending = make({ onUnauthorized }).uploadPhoto(blob, { role: 'request' });
    FakeXhr.last.finish(401, { error: { code: 'unauthorized', message: 'x' } });
    await expect(pending).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalled();
  });
});

describe('photoSrc: the picture as a data URL, fetched with the login', () => {
  it("asks GET /photos/:id with the bearer token and returns a data: URL (the page's CSP allows data:)", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        }),
    );
    const src = await make({ fetchImpl: fetchImpl as unknown as typeof fetch }).photoSrc('p 1');
    expect(src).toMatch(/^data:image\/jpeg;base64,/);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/photos/p%201');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
  });

  it('a missing or forbidden photo is an error', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 404 }));
    await expect(
      make({ fetchImpl: fetchImpl as unknown as typeof fetch }).photoSrc('p'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('remembers a photo it already fetched', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 }));
    const api = make({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await api.photoSrc('same');
    await api.photoSrc('same');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

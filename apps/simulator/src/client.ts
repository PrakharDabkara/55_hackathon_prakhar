/** A failed API call. `code` is the server's error code, e.g. `rate_limited`. */
export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface Client {
  /** Simulated OTP login: request a code, read it from the demo inbox, verify. */
  login(phone: string, signal?: AbortSignal): Promise<{ token: string; role: string }>;
  createShops(
    token: string,
    body: {
      count: number;
      centre: { lat: number; lng: number };
      radiusM: number;
      seed: number;
      categories?: string[];
    },
  ): Promise<{ shopId: string; token: string }[]>;
  removeShops(token: string): Promise<void>;
  ticket(token: string, signal?: AbortSignal): Promise<string>;
  /** Answers a ping as a shop, through the same endpoint the shop app uses. */
  answer(
    token: string,
    pingId: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<void>;
  /** Answers a shopping-list parchi as a shop (ADR-0055). */
  answerList(
    token: string,
    listPingId: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<void>;
  /** Moves a delivery order as its shop would: accept, decline or out. */
  orderAction(
    token: string,
    orderId: string,
    verb: 'accept' | 'decline' | 'out' | 'ready',
    signal?: AbortSignal,
  ): Promise<void>;
  /** Whether a shop token still works. */
  shopIsAlive(token: string): Promise<boolean>;
  streamUrl(ticket: string): string;
}

export function createClient(target: string): Client {
  async function call<T>(
    method: string,
    path: string,
    opts: { token?: string; body?: unknown; signal?: AbortSignal } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${target}${path}`, {
      method,
      headers,
      ...(opts.body !== undefined && { body: JSON.stringify(opts.body) }),
      ...(opts.signal && { signal: opts.signal }),
    });
    if (!res.ok) {
      let code = 'unknown';
      let message = res.statusText || `HTTP ${res.status}`;
      try {
        const data = (await res.json()) as { error?: { code?: string; message?: string } };
        code = data.error?.code ?? code;
        message = data.error?.message ?? message;
      } catch {
        // not JSON: keep the defaults
      }
      throw new ApiFailure(res.status, code, message);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  return {
    async login(phone, signal) {
      const withSignal = signal ? { signal } : {};
      await call('POST', '/auth/otp/request', { body: { phone }, ...withSignal });
      const { code } = await call<{ code: string }>(
        'GET',
        `/dev/otp-inbox?phone=${encodeURIComponent(phone)}`,
        withSignal,
      );
      const result = await call<{ token: string; user: { role: string } }>(
        'POST',
        '/auth/otp/verify',
        { body: { phone, code, role: 'shop' }, ...withSignal },
      );
      return { token: result.token, role: result.user.role };
    },
    createShops: (token, body) => call('POST', '/admin/sim/shops', { token, body }),
    async removeShops(token) {
      await call('DELETE', '/admin/sim/shops', { token });
    },
    async ticket(token, signal) {
      const r = await call<{ ticket: string }>('POST', '/events/ticket', {
        token,
        ...(signal && { signal }),
      });
      return r.ticket;
    },
    async answer(token, pingId, body, signal) {
      await call('POST', `/pings/${encodeURIComponent(pingId)}/answer`, {
        token,
        body,
        ...(signal && { signal }),
      });
    },
    async answerList(token, listPingId, body, signal) {
      await call('POST', `/list-pings/${encodeURIComponent(listPingId)}/answer`, {
        token,
        body,
        ...(signal && { signal }),
      });
    },
    async orderAction(token, orderId, verb, signal) {
      await call('POST', `/orders/${encodeURIComponent(orderId)}/${verb}`, {
        token,
        ...(signal && { signal }),
      });
    },
    async shopIsAlive(token) {
      try {
        await call('GET', '/shops/me', { token });
        return true;
      } catch {
        return false;
      }
    },
    streamUrl: (ticket) => `${target}/admin/sim/events?ticket=${encodeURIComponent(ticket)}`,
  };
}

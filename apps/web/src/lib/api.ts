import type { Category } from '@kahanmilega/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ShopPing {
  id: string;
  item: { slug: string; nameEn: string; nameHi: string };
  quantity?: { quantity: number; unit: string };
  targetPricePaise?: number;
  distanceBand: string;
  sentAt: string;
  expiresAt: string;
}

export interface MyShop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  categories: Category[];
}

export interface NewShop {
  name: string;
  lat: number;
  lng: number;
  categories: Category[];
}

export interface AnswerBody {
  answer: 'yes' | 'no';
  pricePaise?: number;
  quantityHint?: 'few' | 'plenty';
}

/** Everything the shop app asks of the server. */
export interface ShopApi {
  requestOtp(phone: string): Promise<void>;
  /** Demo mode: the code the server would have sent by SMS, or null if there is none. */
  devInbox(phone: string): Promise<string | null>;
  verifyOtp(phone: string, code: string): Promise<{ token: string }>;
  /** null when this account has no shop yet. Throws ApiError 403 for a customer account. */
  getMyShop(): Promise<MyShop | null>;
  createShop(input: NewShop): Promise<MyShop>;
  listPings(): Promise<ShopPing[]>;
  answerPing(id: string, body: AnswerBody): Promise<void>;
}

interface Options {
  getToken: () => string | null;
  /** Called when the server says the login is no longer valid. */
  onUnauthorized: () => void;
  fetchImpl?: typeof fetch;
}

export function createApi({ getToken, onUnauthorized, fetchImpl = fetch }: Options): ShopApi {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers = new Headers();
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (body !== undefined) headers.set('Content-Type', 'application/json');

    const res = await fetchImpl(path, {
      method,
      headers,
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

    if (!res.ok) {
      let code = 'unknown';
      let message = res.statusText || 'Request failed';
      try {
        const data = (await res.json()) as { error?: { code?: string; message?: string } };
        code = data.error?.code ?? code;
        message = data.error?.message ?? message;
      } catch {
        // Not JSON (a proxy error page, say): keep the defaults.
      }
      // A wrong OTP is also a 401; only an expired or revoked login should end the session.
      if (res.status === 401 && code === 'unauthorized') onUnauthorized();
      throw new ApiError(res.status, code, message);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  return {
    async requestOtp(phone) {
      await call('POST', '/auth/otp/request', { phone });
    },
    async devInbox(phone) {
      try {
        const data = await call<{ code: string }>(
          'GET',
          `/dev/otp-inbox?phone=${encodeURIComponent(phone)}`,
        );
        return data.code;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    async verifyOtp(phone, code) {
      const data = await call<{ token: string }>('POST', '/auth/otp/verify', {
        phone,
        code,
        role: 'shop',
      });
      return { token: data.token };
    },
    async getMyShop() {
      try {
        return await call<MyShop>('GET', '/shops/me');
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    createShop: (input) => call<MyShop>('POST', '/shops', input),
    listPings: () => call<ShopPing[]>('GET', '/shops/me/pings'),
    async answerPing(id, body) {
      await call('POST', `/pings/${encodeURIComponent(id)}/answer`, body);
    },
  };
}

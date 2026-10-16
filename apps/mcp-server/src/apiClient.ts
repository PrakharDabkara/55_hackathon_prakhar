export interface ApiRequest {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface ApiResponse {
  status: number;
  // The API's JSON; each tool reads only the fields it needs.
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** The only way the MCP server touches KahanMilega: the public HTTP API. Error statuses are data. */
export interface ApiClient {
  call(request: ApiRequest): Promise<ApiResponse>;
}

/** No token on this machine yet, so there is nothing to send. */
export class NotLoggedInError extends Error {
  constructor() {
    super('Not logged in');
    this.name = 'NotLoggedInError';
  }
}

/** The API did not answer (network down, DNS, timeout). Names the address, never the token. */
export class ApiUnreachableError extends Error {
  constructor(baseUrl: string) {
    super(`Could not reach the KahanMilega API at ${baseUrl}`);
    this.name = 'ApiUnreachableError';
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function createHttpApiClient({
  baseUrl,
  getToken,
  fetch: fetchImpl = (url, init) => fetch(url, init),
  timeoutMs = 20_000,
}: {
  baseUrl: string;
  getToken: () => string | null;
  fetch?: FetchLike;
  timeoutMs?: number;
}): ApiClient {
  const root = baseUrl.replace(/\/+$/, '');
  return {
    async call({ method, path, query, body, headers }) {
      const token = getToken();
      if (!token) throw new NotLoggedInError();

      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query ?? {})) {
        if (value !== undefined) params.set(key, String(value));
      }
      const qs = params.size > 0 ? `?${params}` : '';

      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), timeoutMs);
      try {
        const res = await fetchImpl(`${root}${path}${qs}`, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            ...(body !== undefined && { 'content-type': 'application/json' }),
            ...headers,
          },
          ...(body !== undefined && { body: JSON.stringify(body) }),
          signal: abort.signal,
        });
        const text = await res.text();
        let parsed: unknown = {};
        try {
          parsed = text ? JSON.parse(text) : {};
        } catch {
          // A non-JSON body (a proxy's error page) is treated as empty; the status says enough.
        }
        return { status: res.status, body: parsed };
      } catch {
        throw new ApiUnreachableError(root);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

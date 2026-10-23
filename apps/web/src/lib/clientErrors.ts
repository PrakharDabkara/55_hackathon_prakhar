/** The last request ref the server gave this page; a crash report names it. */
let lastRequestId: string | undefined;
export const noteRequestId = (id: string | undefined): void => {
  if (id) lastRequestId = id;
};

const MAX_REPORTS = 5;
const STACK_LIMIT = 2048;

interface Options {
  target?: Pick<Window, 'addEventListener'>;
  fetchImpl?: typeof fetch;
  route?: () => string;
  version?: string;
}

const text = (value: unknown): string =>
  value instanceof Error ? value.message : typeof value === 'string' ? value : 'Unknown error';

/**
 * Sends window.onerror and unhandled rejections to POST /client-errors (same origin): the message,
 * a stack cut to 2 kb, the path (no query), the app version and the last request ref. Nothing the
 * person typed and no id of theirs. At most five a page, so a crash loop is not a flood; a failed
 * report is dropped silently.
 */
export function installClientErrorReporter({
  target = window,
  fetchImpl = (...args) => fetch(...args),
  route = () => location.pathname,
  version = import.meta.env['VITE_APP_VERSION'] ?? 'dev',
}: Options = {}): void {
  let sent = 0;
  const report = (message: string, stack?: string) => {
    if (sent >= MAX_REPORTS) return;
    sent++;
    const body = {
      message: message.slice(0, 300) || 'Unknown error',
      ...(stack && { stack: stack.slice(0, STACK_LIMIT) }),
      route: route().split(/[?#]/)[0],
      appVersion: String(version).slice(0, 40),
      ...(lastRequestId && { requestId: lastRequestId }),
    };
    try {
      void Promise.resolve(
        fetchImpl('/client-errors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          keepalive: true,
        }),
      ).catch(() => undefined);
    } catch {
      // Reporting must never be the next error.
    }
  };
  target.addEventListener('error', (event) => {
    const e = event as ErrorEvent;
    report(e.message || text(e.error), e.error instanceof Error ? e.error.stack : undefined);
  });
  target.addEventListener('unhandledrejection', (event) => {
    const reason = (event as PromiseRejectionEvent).reason as unknown;
    report(text(reason), reason instanceof Error ? reason.stack : undefined);
  });
}

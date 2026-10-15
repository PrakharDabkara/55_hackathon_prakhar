import type { Logger } from 'pino';

interface ShutdownDeps {
  server: { close(cb: (err?: Error) => void): unknown };
  /** Background workers; closed after the server stops and before the pool, which they use. */
  closeables?: { close(): Promise<void> }[];
  pool: { end(): Promise<void> };
  logger: Logger;
  timeoutMs?: number;
  exit?: (code: number) => void;
  process?: Pick<NodeJS.Process, 'on'>;
}

/** On SIGTERM/SIGINT: stop accepting connections, close workers and the db pool, exit. Forces exit 1 if it hangs. */
export function registerShutdown({
  server,
  closeables = [],
  pool,
  logger,
  timeoutMs = 10_000,
  exit = (code) => process.exit(code),
  process: proc = process,
}: ShutdownDeps): void {
  let started = false;

  const shutdown = async (signal: string) => {
    if (started) return;
    started = true;
    logger.info({ signal }, 'shutting down');

    const force = setTimeout(() => {
      logger.error('shutdown timed out, forcing exit');
      exit(1);
    }, timeoutMs);
    force.unref();

    try {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      for (const closeable of closeables) await closeable.close();
      await pool.end();
      clearTimeout(force);
      logger.info('shutdown complete');
      exit(0);
    } catch (err) {
      clearTimeout(force);
      logger.error({ err }, 'shutdown failed');
      exit(1);
    }
  };

  proc.on('SIGTERM', () => void shutdown('SIGTERM'));
  proc.on('SIGINT', () => void shutdown('SIGINT'));
}

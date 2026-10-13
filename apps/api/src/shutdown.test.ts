import { EventEmitter } from 'node:events';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { registerShutdown } from './shutdown.js';

function setup(opts: { closeHangs?: boolean } = {}) {
  const calls: string[] = [];
  const server = {
    close: vi.fn((cb: (err?: Error) => void) => {
      calls.push('server.close');
      if (!opts.closeHangs) cb();
    }),
  };
  const pool = {
    end: vi.fn(async () => {
      calls.push('pool.end');
    }),
  };
  const exit = vi.fn((code: number) => {
    calls.push(`exit:${code}`);
  });
  const proc = new EventEmitter();
  registerShutdown({
    server,
    pool,
    logger: pino({ level: 'silent' }),
    timeoutMs: 20,
    exit,
    process: proc as never,
  });
  return { calls, server, pool, exit, proc };
}

describe('registerShutdown', () => {
  it('stops accepting, closes the pool, then exits 0 on SIGTERM', async () => {
    const { calls, proc } = setup();
    proc.emit('SIGTERM');
    await vi.waitFor(() => expect(calls).toContain('exit:0'));
    expect(calls).toEqual(['server.close', 'pool.end', 'exit:0']);
  });

  it('also handles SIGINT', async () => {
    const { calls, proc } = setup();
    proc.emit('SIGINT');
    await vi.waitFor(() => expect(calls).toContain('exit:0'));
  });

  it('runs once even if signalled twice', async () => {
    const { server, exit, proc } = setup();
    proc.emit('SIGTERM');
    proc.emit('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    expect(server.close).toHaveBeenCalledTimes(1);
  });

  it('forces exit 1 if connections never drain', async () => {
    const { exit, proc } = setup({ closeHangs: true });
    proc.emit('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });
});

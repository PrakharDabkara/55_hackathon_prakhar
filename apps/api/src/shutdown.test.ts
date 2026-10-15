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
  it('ends long-lived streams first, because server.close waits for open connections', async () => {
    const calls: string[] = [];
    const proc = new EventEmitter();
    registerShutdown({
      server: { close: (cb) => (calls.push('server.close'), cb()) },
      drain: [() => calls.push('drain')],
      pool: { end: async () => void calls.push('pool.end') },
      logger: pino({ level: 'silent' }),
      exit: (code) => void calls.push(`exit:${code}`),
      process: proc as never,
    });
    proc.emit('SIGTERM');
    await vi.waitFor(() => expect(calls).toContain('exit:0'));
    expect(calls).toEqual(['drain', 'server.close', 'pool.end', 'exit:0']);
  });

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

describe('registerShutdown with workers', () => {
  it('closes workers after the server stops and before the pool, so jobs never lose their database', async () => {
    const calls: string[] = [];
    const proc = new EventEmitter();
    registerShutdown({
      server: {
        close: (cb) => {
          calls.push('server.close');
          cb();
        },
      },
      closeables: [
        {
          close: async () => {
            calls.push('worker.close');
          },
        },
      ],
      pool: {
        end: async () => {
          calls.push('pool.end');
        },
      },
      logger: pino({ level: 'silent' }),
      exit: (code) => {
        calls.push(`exit:${code}`);
      },
      process: proc as never,
    });
    proc.emit('SIGTERM');
    await vi.waitFor(() => expect(calls).toContain('exit:0'));
    expect(calls).toEqual(['server.close', 'worker.close', 'pool.end', 'exit:0']);
  });
});

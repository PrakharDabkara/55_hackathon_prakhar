import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { ADMIN_PHONE, PORT } from './playwright.config.ts';

/** Starts the five background shops (after the API is up) and stops them when the tests end. */
export default async function globalSetup(): Promise<() => Promise<void>> {
  mkdirSync(new URL('./artifacts', import.meta.url), { recursive: true });
  const child = spawn(process.execPath, [new URL('./answerer.ts', import.meta.url).pathname], {
    env: {
      ...process.env,
      E2E_TARGET: `http://localhost:${PORT}`,
      E2E_ADMIN_PHONE: ADMIN_PHONE,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('the simulated shops did not start in time')),
      60_000,
    );
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`the simulated shops stopped early (exit ${code})`));
    });
    child.stdout.on('data', (chunk: Buffer) => {
      process.stdout.write(`[shops] ${chunk.toString()}`);
      if (chunk.toString().includes('READY')) {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  return async () => {
    child.removeAllListeners('exit');
    child.kill('SIGTERM');
  };
}

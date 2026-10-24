import { randomBytes } from 'node:crypto';
import { defineConfig } from '@playwright/test';

/** E2E_PORT lets CI use a port of its own, so it never meets a developer's own server. */
export const PORT = Number(process.env['E2E_PORT'] ?? 3100);
/**
 * The admin token of this run, thrown away afterwards. Playwright loads this file again in every
 * worker, so the first load stores it in the environment, which the workers inherit.
 */
process.env['E2E_ADMIN_TOKEN'] ??= randomBytes(32).toString('hex');
export const ADMIN_TOKEN = process.env['E2E_ADMIN_TOKEN'];
const baseURL = `http://localhost:${PORT}`;

// The whole stack runs for real: Postgres and Redis (npm run db:up, or CI service containers),
// the built API serving the built web app, and five simulated shops answering pings. The model
// is the fake provider playing a scenario file.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 90_000,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  outputDir: 'artifacts/test-results',
  globalSetup: './global-setup.ts',
  use: {
    baseURL,
    // A small phone: the app must work at 360 px.
    viewport: { width: 360, height: 740 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'node --env-file-if-exists=.env apps/api/dist/server.js',
    cwd: '..',
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      ADMIN_TOKEN,
      // Tests log in with a new random phone each time and read its code from the demo inbox, which
      // production never opens (ADR-0058). One machine does all the logins, so the per-IP limits
      // are lifted too.
      OTP_INBOX_OPEN: 'true',
      // The demo customer numbers (X-01): a customer on one starts in the demo area.
      DEMO_PHONES: Array.from({ length: 10 }, (_, i) => `9000000${201 + i}`).join(','),
      OTP_IP_REQUEST_MAX: '100000',
      OTP_IP_VERIFY_MAX: '100000',
      OTP_IP_INBOX_MAX: '100000',
      // The browser, the simulated shops and five specs' worth of logins all come from this one
      // machine, far above the API rate limits meant for one person (ADR-0059).
      RATE_LIMIT_SCALE: '1000',
      LOG_LEVEL: 'warn',
      WORKERS_ENABLED: 'true',
      // "Le liya?" asks at once in tests; in life it waits 15 minutes (ADR-0035).
      PICKUP_ASK_AFTER_MINUTES: '0',
      // The same run every time: a scripted model, never a real one (e2e/errand-scenario.json).
      LLM_PROVIDER: 'fake',
      FAKE_LLM_SCENARIO: 'e2e/errand-scenario.json',
    },
  },
});

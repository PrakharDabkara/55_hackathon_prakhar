import { defineConfig } from '@playwright/test';

/** E2E_PORT lets CI use a port of its own, so it never meets a developer's own server. */
export const PORT = Number(process.env['E2E_PORT'] ?? 3100);
/** The admin that the background shops are made by. Not a real account. */
export const ADMIN_PHONE = '9810000999';
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
      ADMIN_PHONES: ADMIN_PHONE,
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

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Perf runs only: `npm run perf:autopilot`. Not part of npm test.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@askbuy\/shared$/,
        replacement: fileURLToPath(new URL('../packages/shared/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: { include: ['load/**/*.perf.ts'], testTimeout: 3_600_000, hookTimeout: 600_000 },
});

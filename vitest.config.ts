import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Tests run against the shared source, so no build step is needed first.
    alias: [
      {
        find: /^@kahanmilega\/shared\/tools$/,
        replacement: fileURLToPath(
          new URL('./packages/shared/src/tools/index.ts', import.meta.url),
        ),
      },
      {
        find: /^@kahanmilega\/shared$/,
        replacement: fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['{apps,packages,evals}/**/*.test.{ts,tsx}'],
  },
});

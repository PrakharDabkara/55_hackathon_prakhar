import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Tests run against the shared source, so no build step is needed first.
    alias: {
      '@kahanmilega/shared': fileURLToPath(
        new URL('./packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['{apps,packages,evals}/**/*.test.{ts,tsx}'],
  },
});

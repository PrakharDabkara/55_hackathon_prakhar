import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Tests run against the shared source, so no build step is needed first.
    alias: [
      {
        find: /^@askbuy\/shared\/tools$/,
        replacement: fileURLToPath(
          new URL('./packages/shared/src/tools/index.ts', import.meta.url),
        ),
      },
      {
        find: /^@askbuy\/shared$/,
        replacement: fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    include: [
      '{apps,packages,evals}/**/*.test.{ts,tsx}',
      'scripts/*.test.ts',
      'scripts/ops/*.test.ts',
      'scripts/lib/*.test.ts',
      '.claude/hooks/*.test.ts',
      '.claude/skills/**/*.test.ts',
      '.claude/agents/*.test.ts',
    ],
  },
});

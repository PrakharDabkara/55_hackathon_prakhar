import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Served by the API under /app/ (ADR-0017), hence the base.
export default defineConfig({
  base: '/app/',
  plugins: [react()],
  resolve: {
    // The shared package is plain TypeScript; use its source and skip a build step.
    alias: {
      '@kahanmilega/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  build: {
    outDir: 'dist',
    // No data: URIs for small files, and no inline script or style, so the CSP can stay strict.
    assetsInlineLimit: 0,
  },
  server: {
    // `npm run dev -w @kahanmilega/web` against an API on localhost:3000.
    proxy: Object.fromEntries(
      ['/auth', '/shops', '/pings', '/requests', '/search', '/dev', '/health', '/events'].map(
        (path) => [path, 'http://localhost:3000'],
      ),
    ),
  },
});

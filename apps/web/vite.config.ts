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
      '@askbuy/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  build: {
    outDir: 'dist',
    // Two pages: the app (index.html) and the static landing page served at "/" (ADR-0056).
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        landing: fileURLToPath(new URL('./landing.html', import.meta.url)),
      },
    },
    // No data: URIs for small files, and no inline script or style, so the CSP can stay strict.
    assetsInlineLimit: 0,
  },
  server: {
    // `npm run dev -w @askbuy/web` against an API on localhost:3000.
    proxy: Object.fromEntries(
      ['/auth', '/shops', '/pings', '/requests', '/search', '/dev', '/health', '/events'].map(
        (path) => [path, 'http://localhost:3000'],
      ),
    ),
  },
});

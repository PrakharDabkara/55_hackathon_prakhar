import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Served by the API under /app/ (ADR-0017), hence the base.
// The short commit Render built from, sent with a browser error report.
const version = (process.env['RENDER_GIT_COMMIT'] ?? process.env['GIT_SHA'] ?? 'dev').slice(0, 7);

export default defineConfig({
  base: '/app/',
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(version) },
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

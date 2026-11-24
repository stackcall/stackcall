/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // Desktop app loaded from disk: one bundle is fine.
  build: { target: 'chrome120', chunkSizeWarningLimit: 1500 },
  test: { globals: true, environment: 'jsdom', setupFiles: ['./src/test-setup.ts'], testTimeout: 20000, pool: 'threads' },
});

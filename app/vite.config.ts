/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import pkg from './package.json' with { type: 'json' };

// Only the web build is installable on phones (manifest, icons, service worker).
const pwa = (): Plugin => ({
  name: 'stackcall-pwa',
  transformIndexHtml: () => [
    { tag: 'link', attrs: { rel: 'manifest', href: '/app/manifest.webmanifest' }, injectTo: 'head' },
    { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/app/apple-touch-icon.png' }, injectTo: 'head' },
    { tag: 'meta', attrs: { name: 'theme-color', content: '#101012' }, injectTo: 'head' },
    { tag: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' }, injectTo: 'head' },
  ],
});

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === 'web' ? [pwa()] : [])],
  clearScreen: false,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // "web": the same app for phones and browsers, served by the porteiro at /app/.
  ...(mode === 'web' ? { base: '/app/', publicDir: 'web-public' } : { publicDir: false as const }),
  // Desktop app loaded from disk: one bundle is fine.
  build: mode === 'web'
    ? { target: ['chrome111', 'safari16.4', 'firefox115'], outDir: 'dist-web', chunkSizeWarningLimit: 1500 }
    : { target: 'chrome120', chunkSizeWarningLimit: 1500 },
  test: { globals: true, environment: 'jsdom', setupFiles: ['./src/test-setup.ts'], testTimeout: 20000, pool: 'threads' },
}))

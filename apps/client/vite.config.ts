import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // Two pages: the landing page at / and the game at /play/.
    rollupOptions: { input: { landing: resolve(import.meta.dirname, 'index.html'), play: resolve(import.meta.dirname, 'play/index.html'), privacy: resolve(import.meta.dirname, 'privacy/index.html') } },
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});

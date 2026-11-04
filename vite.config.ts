import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Relative paths, so the export runs from any folder, including an IPFS gateway.
export default defineConfig({
  base: './',
  build: {
    target: 'es2021',
    chunkSizeWarningLimit: 900,
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), overlay: resolve(__dirname, 'overlay.html') } },
  },
  server: { proxy: { '/api': 'http://localhost:8787' } },
  preview: { proxy: { '/api': 'http://localhost:8787' } },
  test: { include: ['tests/**/*.test.ts'] },
} as any);

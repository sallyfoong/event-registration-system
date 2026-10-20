import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  // '@' points at src. shadcn docs and generators all emit imports using
  // this alias - without it, every pasted component needs relative paths
  // fixed up by hand.
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 8001,
    strictPort: true,
    host: true,
    // dev only: the browser calls /api on 8001 and Vite forwards it, so the
    // app behaves the same here as it does behind nginx in production
    proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false } },
  },
  preview: {
    port: 8001,
    strictPort: true,
    // `vite preview` serves the production bundle without nginx, so the same
    // /api forwarding has to be declared here - this is what the E2E suite
    // runs against, and it keeps the tests on the same-origin path the real
    // deployment uses instead of inventing a cross-origin variant.
    proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false } },
  },
});

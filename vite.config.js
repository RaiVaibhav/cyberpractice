import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// The UI lives in ui/. It is built into platform/web-dist, which the Node
// server (platform/server.js) serves in normal `npm run scenario` mode.
// In `--dev` mode the CLI runs this Vite dev server instead and proxies /api
// to the Node API server for hot-module reloading while hacking on the UI.
const API_PORT = process.env.API_PORT || 4173;

export default defineConfig({
  root: fileURLToPath(new URL('./ui', import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./ui/src', import.meta.url)),
    },
  },
  server: {
    port: Number(process.env.UI_PORT || 5173),
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${API_PORT}`,
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./platform/web-dist', import.meta.url)),
    emptyOutDir: true,
  },
});

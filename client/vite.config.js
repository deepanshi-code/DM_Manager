import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Dashboard calls /api/...; Vite forwards them to the Express server.
    proxy: { '/api': 'http://localhost:4000' },
    // Allow a Cloudflare quick tunnel (cloudflared tunnel --url ...) to serve a public demo link.
    allowedHosts: ['.trycloudflare.com'],
  },
});

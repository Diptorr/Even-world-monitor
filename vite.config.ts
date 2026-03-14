import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'https://api.worldmonitor.app',
        changeOrigin: true,
        headers: {
          Origin: 'https://worldmonitor.app',
          Referer: 'https://worldmonitor.app/',
        },
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});

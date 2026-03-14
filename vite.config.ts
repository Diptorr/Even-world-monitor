import { defineConfig } from 'vite';
import { networkInterfaces } from 'os';

// Resolve the machine's local network IP for QR code generation
function getLocalIP(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

const localIP = getLocalIP();

export default defineConfig({
  root: '.',
  define: {
    __LOCAL_IP__: JSON.stringify(localIP),
  },
  server: {
    port: 5173,
    host: true, // Expose to local network (0.0.0.0)
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

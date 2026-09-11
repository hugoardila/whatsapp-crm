import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * allowedHosts: true → necesario detrás de vhost / proxy / SSL terminación.
 * Si usas lista fija, el Host real (interno o reescrito) suele no coincidir y Vite bloquea.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const api = env.VITE_API_URL || 'http://127.0.0.1:3001';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: true,
      allowedHosts: true,
      proxy: {
        '/api': { target: api, changeOrigin: true },
        '/webhook': { target: api, changeOrigin: true },
        '/socket.io': { target: api, ws: true, changeOrigin: true }
      }
    },
    preview: {
      port: 8988,
      strictPort: true,
      host: true,
      allowedHosts: true,
      proxy: {
        '/api': { target: api, changeOrigin: true },
        '/webhook': { target: api, changeOrigin: true },
        '/socket.io': { target: api, ws: true, changeOrigin: true }
      }
    }
  };
});

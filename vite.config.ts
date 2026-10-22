import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

/**
 * Ports come from the environment so a second checkout can run alongside the first.
 * WEB_PORT serves the interface; API_PORT is where src/server.ts listens.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = Number(env.API_PORT ?? 8787);

  return {
    plugins: [react()],
    server: {
      port: Number(env.WEB_PORT ?? 5273),
      strictPort: true,
      proxy: {
        '/api': `http://localhost:${apiPort}`,
      },
    },
    build: {
      outDir: 'dist',
    },
  };
});

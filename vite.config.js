import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  let target = 'https://localhost';
  try {
    const u = new URL(env.VITE_REDMINE_URL || 'https://example.invalid/');
    target = `${u.protocol}//${u.host}`;
  } catch {
    /* mantém fallback */
  }

  return {
    server: {
      port: 5173,
      // Mesma origem no browser → sem CORS; o Vite encaminha ao Redmine.
      proxy: {
        '/redmine-api': {
          target,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/redmine-api/, ''),
        },
      },
    },
  };
});

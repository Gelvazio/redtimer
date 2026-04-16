import { defineConfig, loadEnv } from 'vite';
import { proxyRedmineRequest } from './api/_redmineProxyServer.mjs';

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
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith('/api/redmine')) {
            next();
            return;
          }
          try {
            await proxyRedmineRequest(req, res);
          } catch (err) {
            console.error('[redmine proxy]', err);
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
              res.end('Erro no proxy Redmine.');
            }
          }
        });
      },
    },
  };
});

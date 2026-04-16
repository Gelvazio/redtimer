/**
 * Proxy da API Redmine (Vercel): evita CORS no browser.
 */
import { proxyRedmineRequest } from './_redmineProxyServer.mjs';

export default proxyRedmineRequest;

/**
 * Lógica compartilhada: proxy Redmine (Vercel api/redmine + dev server Vite).
 * Prefixo _ → não vira rota na Vercel.
 */

function parseAllowedHosts() {
  const raw = process.env.REDMINE_ALLOWED_HOSTS || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isHostAllowed(hostname, allowed) {
  if (!allowed.length) return true;
  return allowed.some((h) => h === hostname || hostname.endsWith(`.${h}`));
}

function getPathFromReq(req) {
  const raw = req.query?.path;
  const q = Array.isArray(raw) ? raw[0] : raw;
  if (typeof q === 'string' && q.startsWith('/')) return q;
  try {
    const u = new URL(req.url || '', 'http://localhost');
    const p = u.searchParams.get('path');
    return typeof p === 'string' && p.startsWith('/') ? p : '';
  } catch {
    return '';
  }
}

async function readRequestBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === 'string') return Buffer.from(req.body);
    return Buffer.from(JSON.stringify(req.body));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function proxyRedmineRequest(req, res) {
  const path = getPathFromReq(req);
  const baseUrl = String(req.headers['x-redmine-base-url'] ?? '').trim();
  const apiKey = String(req.headers['x-redmine-api-key'] ?? '').trim();

  if (!path.startsWith('/') || !baseUrl || !apiKey) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        error: 'Informe path (query), X-Redmine-Base-Url e X-Redmine-API-Key.',
      }),
    );
    return;
  }

  let hostname;
  try {
    hostname = new URL(baseUrl).hostname;
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'X-Redmine-Base-Url inválida.' }));
    return;
  }

  const allowed = parseAllowedHosts();
  if (!isHostAllowed(hostname, allowed)) {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        error: `Host não permitido pelo proxy. Configure REDMINE_ALLOWED_HOSTS (atual: ${hostname}).`,
      }),
    );
    return;
  }

  const target = `${baseUrl.replace(/\/$/, '')}${path}`;

  let body;
  if (req.method && !['GET', 'HEAD'].includes(req.method)) {
    body = await readRequestBody(req);
  }

  const upstreamHeaders = {
    'X-Redmine-API-Key': apiKey,
    Accept: req.headers.accept || 'application/json',
  };
  const ct = req.headers['content-type'];
  if (ct) upstreamHeaders['Content-Type'] = ct;

  const upstream = await fetch(target, {
    method: req.method || 'GET',
    headers: upstreamHeaders,
    body: body && body.length ? Buffer.from(body) : undefined,
  });

  const outCt = upstream.headers.get('content-type') || 'application/octet-stream';
  const text = await upstream.text();
  res.writeHead(upstream.status, { 'Content-Type': outCt });
  res.end(text);
}

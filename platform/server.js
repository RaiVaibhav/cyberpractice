import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

// Built Vite/React assets. Produced by `vite build` (see vite.config.js); the
// CLI builds this on first run. Source lives in ../ui.
const WEB = join(fileURLToPath(new URL('.', import.meta.url)), 'web-dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

export function startServer(hub, { port, host = '127.0.0.1' }) {
  const server = createServer(async (req, res) => {
    const started = Date.now();
    res.on('finish', () => logRequest(req, res, Date.now() - started));
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
      if (url.pathname.startsWith('/api/')) return await api(url.pathname, req, res, hub);
      return await serveStatic(url.pathname, res);
    } catch (err) {
      logError(req, err);
      json(res, 500, { error: err.message });
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => resolve({ server, url: `http://${host}:${server.address().port}` }));
  });
}

// The full snapshot the UI needs to render: the current scenario, plus the
// catalog of every scenario so the switcher / random button can work.
function snapshot(hub) {
  const session = hub.current();
  return {
    ...session.info(),
    ...session.state(),
    history: session.history(),
    trace: session.trace(),
    currentId: hub.currentId(),
    scenarios: hub.list(),
  };
}

async function api(path, req, res, hub) {
  const session = hub.current();

  if (path === '/api/scenario' && req.method === 'GET') {
    return json(res, 200, snapshot(hub));
  }
  if (path === '/api/scenarios' && req.method === 'GET') {
    return json(res, 200, { scenarios: hub.list(), currentId: hub.currentId() });
  }
  if (path === '/api/select' && req.method === 'POST') {
    const { id } = await body(req);
    if (!id) return json(res, 400, { error: 'Missing scenario id' });
    await hub.select(String(id));
    return json(res, 200, snapshot(hub));
  }
  if (path === '/api/message' && req.method === 'POST') {
    const { message } = await body(req);
    if (!message || !String(message).trim()) return json(res, 400, { error: 'Empty message' });
    return json(res, 200, await session.send(String(message)));
  }
  if (path === '/api/action' && req.method === 'POST') {
    const { action, fields } = await body(req);
    return json(res, 200, await session.act(action, fields));
  }
  if (path === '/api/hint' && req.method === 'POST') return json(res, 200, session.hint());
  if (path === '/api/solution' && req.method === 'POST') return json(res, 200, { solution: session.solution() });
  if (path === '/api/reset' && req.method === 'POST') return json(res, 200, session.reset());
  return json(res, 404, { error: 'No such endpoint' });
}

async function serveStatic(pathname, res) {
  const rel = pathname === '/' ? 'index.html' : normalize(pathname).replace(/^([/\\.]+)/, '');
  const file = join(WEB, rel);
  if (!file.startsWith(WEB)) return json(res, 403, { error: 'Forbidden' });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    // SPA fallback: unknown non-asset routes get index.html so client routing works.
    if (!extname(file)) {
      try {
        const data = await readFile(join(WEB, 'index.html'));
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        return res.end(data);
      } catch {
        /* fall through to 404 */
      }
    }
    json(res, 404, { error: 'Not found' });
  }
}

// One access-log line per request: status · method · path · timing. Colour by
// status class (2xx green, 3xx cyan, 4xx yellow, 5xx red).
function logRequest(req, res, ms) {
  const s = res.statusCode;
  const paint = s >= 500 ? C.red : s >= 400 ? C.yellow : s >= 300 ? C.cyan : C.green;
  process.stdout.write(
    `  ${paint(String(s))}  ${C.dim(req.method.padEnd(4))} ${req.url}  ${C.dim(ms + 'ms')}\n`,
  );
}

// Surface backend failures in the terminal where the server runs — with the
// stack — instead of only shipping err.message to the browser. This is what you
// want visible locally when a tool.run / checkSolved / provider call blows up.
function logError(req, err) {
  const stamp = new Date().toLocaleTimeString();
  process.stderr.write(
    '\n' +
      C.red(`  ✗ 500  ${req.method} ${req.url}`) +
      C.dim(`  ${stamp}`) +
      '\n' +
      (err?.stack || String(err))
        .split('\n')
        .map((l) => '    ' + l)
        .join('\n') +
      '\n\n',
  );
}

function json(res, status, payload) {
  const data = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function body(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) reject(new Error('Payload too large'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

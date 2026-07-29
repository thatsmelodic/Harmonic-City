// Minimal static file + /api server for local Docker parity with Vercel.
// Reuses api/config.js unmodified so both platforms read the same env vars
// (SUPABASE_URL, SUPABASE_ANON_KEY) and can never silently diverge.
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const configHandler = require('./api/config.js');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8'
};

// Never serve source/config/build files that aren't part of the client bundle.
const BLOCKED_PREFIXES = ['/.git', '/supabase', '/scripts', '/.env', '/server.js', '/Dockerfile', '/docker-compose'];

function wrapResponse(res) {
  res.status = code => {
    res.statusCode = code;
    return res;
  };
  res.json = body => {
    if (!res.getHeader('content-type')) res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };
  return res;
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  if (pathname === '/api/config') {
    wrapResponse(res);
    configHandler(req, res);
    return;
  }

  if (BLOCKED_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.normalize(path.join(ROOT, relative));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  sendFile(res, filePath);
});

server.listen(PORT, () => {
  console.log(`Harmonic City listening on http://0.0.0.0:${PORT}`);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.warn('WARNING: SUPABASE_URL and/or SUPABASE_ANON_KEY are not set. /api/config will return 503 until both are provided.');
  }
});

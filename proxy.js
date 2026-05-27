#!/usr/bin/env node
/**
 * OpenAPI Tester — Local Proxy Server
 * ─────────────────────────────────────────────────────────────────────────
 * Mirrors what Netlify does in production: forwards all requests from the
 * browser to your real API server-side, completely bypassing CORS.
 *
 * Requirements: Node.js ≥ 14 (no npm install needed — zero dependencies)
 *
 * Usage:
 *   node proxy.js
 *   node proxy.js --port 8080     # custom port
 *
 * Then open http://localhost:3131 in your browser.
 * ─────────────────────────────────────────────────────────────────────────
 */

'use strict';

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

// ── Config ─────────────────────────────────────────────────────────────────
const PORT      = parseInt(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || '3131');
const HTML_FILE = path.join(__dirname, 'index.html');

// ── Helpers ────────────────────────────────────────────────────────────────
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers','*');
}

function readBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
  });
}

function log(symbol, msg) {
  const ts = new Date().toTimeString().slice(0, 8);
  console.log(`  ${ts}  ${symbol}  ${msg}`);
}

// ── Server ─────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  setCORS(res);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // ── Serve index.html ────────────────────────────────────────────────────
  if (pathname === '/' || pathname === '/index.html') {
    if (!fs.existsSync(HTML_FILE)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('index.html not found. Make sure proxy.js and index.html are in the same folder.');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(HTML_FILE));
    return;
  }

  // ── Proxy: /proxy/<full-url> ─────────────────────────────────────────────
  // Mirrors the Netlify redirect rule:  /proxy/*  →  :splat
  // The browser calls /proxy/https://api.example.com/path?q=1
  // We strip the /proxy/ prefix and forward to https://api.example.com/path?q=1
  if (pathname.startsWith('/proxy/')) {
    const targetUrl = req.url.slice('/proxy/'.length); // keep query string

    let targetParsed;
    try {
      targetParsed = new URL(targetUrl);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid target URL: ' + targetUrl }));
      return;
    }

    const isHttps = targetParsed.protocol === 'https:';
    const lib     = isHttps ? https : http;
    const body    = await readBody(req);

    // Forward all headers except ones that break proxying
    const fwdHeaders = { ...req.headers };
    delete fwdHeaders['host'];
    delete fwdHeaders['connection'];
    delete fwdHeaders['transfer-encoding'];
    fwdHeaders['host'] = targetParsed.host;
    if (body.length) fwdHeaders['content-length'] = body.length;

    const options = {
      hostname: targetParsed.hostname,
      port:     targetParsed.port || (isHttps ? 443 : 80),
      path:     targetParsed.pathname + targetParsed.search,
      method:   req.method,
      headers:  fwdHeaders,
    };

    log('→', `${req.method} ${targetUrl}`);

    const proxyReq = lib.request(options, proxyRes => {
      // Forward response headers (minus hop-by-hop)
      const resHeaders = { ...proxyRes.headers };
      delete resHeaders['transfer-encoding'];
      delete resHeaders['connection'];
      // Add CORS headers so browser accepts the response
      resHeaders['access-control-allow-origin']  = '*';
      resHeaders['access-control-expose-headers']= '*';

      res.writeHead(proxyRes.statusCode, resHeaders);

      const chunks = [];
      proxyRes.on('data', c => chunks.push(c));
      proxyRes.on('end', () => {
        const responseBody = Buffer.concat(chunks);
        res.end(responseBody);
        log('←', `${proxyRes.statusCode} ${targetUrl}  (${responseBody.length}b)`);
      });
    });

    proxyReq.on('error', e => {
      log('✗', `Proxy error: ${e.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Proxy error: ' + e.message }));
      }
    });

    if (body.length) proxyReq.write(body);
    proxyReq.end();
    return;
  }

  // ── 404 ──────────────────────────────────────────────────────────────────
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found', routes: ['GET /', 'ANY /proxy/<url>'] }));
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ┌──────────────────────────────────────────────┐');
  console.log('  │          OpenAPI Tester — Local Proxy        │');
  console.log('  │                                              │');
  console.log(`  │   Open →  http://localhost:${PORT}              │`);
  console.log('  │   Stop →  Ctrl + C                           │');
  console.log('  └──────────────────────────────────────────────┘');
  console.log('');
  console.log(`  Serving:  ${HTML_FILE}`);
  console.log(`  Proxy:    http://localhost:${PORT}/proxy/<url>  →  <url>`);
  console.log('');
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  ✗ Port ${PORT} is already in use.`);
    console.error(`    Try:  node proxy.js --port=3132\n`);
  } else {
    console.error('\n  ✗ Server error:', e.message);
  }
  process.exit(1);
});

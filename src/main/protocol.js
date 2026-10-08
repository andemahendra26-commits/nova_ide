/**
 * Serves the renderer from app://nova/ instead of file://.
 *
 * This matters more than it looks: under file:// Chromium refuses to start web
 * workers and treats every asset as an opaque origin, which breaks Monaco's
 * language services and blob-based worker bootstrapping. A privileged custom
 * scheme gives the renderer a normal, secure, same-origin world.
 */
const path = require('path');
const { protocol, net } = require('electron');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', 'renderer');
const SCHEME = 'app';
const HOST = 'nova';

// Served as a real header rather than only a <meta> tag: Electron only treats
// a header-delivered policy as authoritative, and warns loudly otherwise.
// 'unsafe-eval' is required by Monaco's AMD loader and cannot be dropped.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

/** Must run before app.whenReady(). */
function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

/** Must run after app.whenReady(). */
function registerHandler() {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';

    const target = path.normalize(path.join(ROOT, rel));

    // Containment check: a crafted ../ must not escape the renderer directory.
    if (!target.startsWith(ROOT + path.sep) && target !== ROOT) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const res = await net.fetch(pathToFileURL(target).toString());
      const headers = new Headers(res.headers);
      const type = MIME[path.extname(target).toLowerCase()];
      if (type) headers.set('content-type', type);
      headers.set('Content-Security-Policy', CSP);
      headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(res.body, { status: res.status, headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

const INDEX_URL = `${SCHEME}://${HOST}/index.html`;

module.exports = { registerScheme, registerHandler, INDEX_URL };

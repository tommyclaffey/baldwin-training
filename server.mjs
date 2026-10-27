// Serves the built app (dist/) with a single-page fallback. No dependencies.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'dist');
const port = Number(process.env.PORT) || 8080;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(dist, path.normalize(url).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(dist)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (url.startsWith('/content/') || url.startsWith('/img/') || url.startsWith('/assets/')) { res.writeHead(404); res.end('Not found'); return; }
    file = path.join(dist, 'index.html');
  }
  const ext = path.extname(file);
  const cache = url.startsWith('/assets/') || url.startsWith('/img/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': cache });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`The Baldwin Training Book on http://localhost:${port}`));

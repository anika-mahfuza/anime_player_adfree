import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

const root = path.resolve('out');
const port = Number(process.env.PORT || 3000);

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

function resolveExportPath(requestUrl = '/') {
  const pathname = decodeURIComponent(requestUrl.split('?')[0] || '/');
  const normalized = pathname === '/' ? '/index.html' : pathname;
  const candidates = [
    normalized,
    `${normalized}.html`,
    path.join(normalized, 'index.html'),
  ];

  for (const candidate of candidates) {
    const fullPath = path.resolve(root, `.${candidate}`);
    if (!fullPath.startsWith(root)) continue;
    if (existsSync(fullPath) && statSync(fullPath).isFile()) return fullPath;
  }

  return path.join(root, '404.html');
}

createServer((req, res) => {
  const filePath = resolveExportPath(req.url);
  const ext = path.extname(filePath).toLowerCase();

  res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream');
  res.setHeader(
    'Cache-Control',
    filePath.includes(`${path.sep}_next${path.sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  );

  createReadStream(filePath).pipe(res);
}).listen(port, '0.0.0.0', () => {
  console.log(`Serving exported frontend at http://localhost:${port}`);
});

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.map': 'application/json; charset=utf-8'
};

const DEFAULT_ENTRY = 'preview.html';

function sanitizeRequestUrl(url) {
  try {
    const parsedUrl = new URL(url, 'http://localhost');
    return decodeURIComponent(parsedUrl.pathname);
  } catch (error) {
    return '/';
  }
}

function resolveFilePath(requestPath) {
  const normalized = path.normalize(requestPath);
  const isRoot =
    normalized === '/' ||
    normalized === '\\' ||
    normalized === path.sep;
  const candidate = isRoot ? DEFAULT_ENTRY : normalized.replace(/^[\\/]+/, '');
  const resolved = path.resolve(projectRoot, candidate);

  const relative = path.relative(projectRoot, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }

  return resolved;
}

async function serveFile(filePath, res) {
  try {
    const fileStat = await stat(filePath);

    if (fileStat.isDirectory()) {
      return false;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store'
    });

    createReadStream(filePath).pipe(res);
    return true;
  } catch (error) {
    return false;
  }
}

const server = createServer(async (req, res) => {
  const requestPath = sanitizeRequestUrl(req.url ?? '/');
  const filePath = resolveFilePath(requestPath);

  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  const served = await serveFile(filePath, res);

  if (!served && !requestPath.endsWith('/')) {
    const fallbackServed = await serveFile(`${filePath}.html`, res);
    if (fallbackServed) {
      return;
    }
  }

  if (!served) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
});

const port = Number.parseInt(process.env.PORT ?? '4178', 10);

server.listen(port, '0.0.0.0', () => {
  console.log(`Realm calculator sandbox running at http://localhost:${port}`);
});

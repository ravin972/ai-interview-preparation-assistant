/**
 * Static server for the deterministic fixture site (fixtures/site).
 *
 * Test infrastructure only - it is never deployed and never imported by
 * packages/core. Tests call startFixtureSite({ port: 0 }) to get an ephemeral
 * port; `npm run fixtures:serve` runs it on 8099 to mirror the host the batch
 * evaluator points at. Zero dependencies by design.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'site');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

export interface FixtureSite {
  port: number;
  origin: string;
  close: () => Promise<void>;
}

export interface FixtureSiteOptions {
  /** 0 asks the OS for a free port - use this in tests. */
  port?: number;
  root?: string;
}

function resolveRequestPath(root: string, urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const candidate = decoded.endsWith('/') ? `${decoded}index.html` : decoded;
  const resolved = path.resolve(root, `.${candidate}`);
  // Refuse anything that escapes the fixture root.
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return resolved;
}

export function startFixtureSite(options: FixtureSiteOptions = {}): Promise<FixtureSite> {
  const root = options.root ?? DEFAULT_ROOT;
  const requestedPort = options.port ?? 8099;

  const server = http.createServer((req, res) => {
    const filePath = resolveRequestPath(root, req.url ?? '/');

    if (!filePath) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const body = fs.readFileSync(filePath);
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream',
      'content-length': body.byteLength,
    });
    res.end(body);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('fixture site: unexpected address'));
        return;
      }
      resolve({
        port: address.port,
        origin: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((done, fail) =>
            server.close((err) => (err ? fail(err) : done())),
          ),
      });
    });
  });
}

// CLI entry: npm run fixtures:serve
// Compare resolved filesystem paths. Comparing import.meta.url against argv[1]
// breaks on Windows checkouts whose path contains spaces, as this one does.
const invokedAs = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedAs === fileURLToPath(import.meta.url)) {
  const site = await startFixtureSite();
  process.stdout.write(`fixture site listening on ${site.origin}\n`);
}

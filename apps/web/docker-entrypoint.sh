#!/bin/sh
set -e

# If API_PROXY_TARGET is provided at runtime, ensure .next/routes-manifest.json points to it
if [ -n "$API_PROXY_TARGET" ] && [ -f /app/apps/web/.next/routes-manifest.json ]; then
  node -e "
    const fs = require('fs');
    const manifestPath = '/app/apps/web/.next/routes-manifest.json';
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      let modified = false;
      if (manifest.rewrites && manifest.rewrites.afterFiles) {
        manifest.rewrites.afterFiles.forEach(r => {
          if (r.source === '/api/:path*') {
            const target = process.env.API_PROXY_TARGET.replace(/\/$/, '');
            r.destination = target + '/api/:path*';
            modified = true;
          }
        });
      }
      if (modified) {
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      }
    } catch (err) {
      console.error('[Web Entrypoint] Warning: Could not patch routes-manifest.json:', err.message);
    }
  "
fi

exec "$@"

# @kit/web

Next.js + Tailwind frontend, deployed to Vercel.

The browser only ever calls `/api/*` on its own origin; Next.js rewrites those
requests to the Express API. This keeps session cookies first-party, which
avoids third-party-cookie blocking in Safari and removes browser CORS from the
picture entirely. See [../../docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md).

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { router } from './routes.ts';
import { getDb } from './db/client.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST = path.resolve(here, '..', '..', 'frontend', 'dist');
const PORT = Number(process.env.PORT) || 3000;

// Opens (and runs pending migrations on) the database eagerly at boot,
// rather than lazily on the first request, so a broken DB/migration fails
// loudly at startup instead of on whichever request happens to hit it first.
getDb();

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use('/api', router);

// The backend serves the already-built frontend directly (spec section 2:
// "npm start ... serveix el frontend ja compilat") — no separate frontend
// server in production. In dev, Vite's own dev server runs separately and
// proxies /api here instead (see frontend/vite.config.ts).
app.use(express.static(FRONTEND_DIST));
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
});

app.listen(PORT, 'localhost', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`GesFam escoltant a ${url}`);
  if (!process.env.GESFAM_NO_OPEN) {
    import('open')
      .then(({ default: open }) => open(url))
      .catch(() => {
        // Not fatal — the user can just open the URL themselves.
      });
  }
});

import { Router } from 'express';
import type { Db } from './db.js';

export function instagramRouter(db: Db) {
  const router = Router();
  router.get('/status', async (_req, res) => {
    const row = (await db.query(`select status, last_sync_at, last_error from integrations where provider='instagram'`)).rows[0];
    res.json({ app_configured: !!(process.env.META_APP_ID && process.env.META_APP_SECRET), ...(row || { status: 'no_configurada' }) });
  });
  return router;
}

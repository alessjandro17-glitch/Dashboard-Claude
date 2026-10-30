import { Router } from 'express';
import type { Db } from './db.js';
import { HttpError } from './http.js';
import { loadVideoRows, buildRanking } from './analytics.js';

/** Resumen de los datos almacenados que el asesor puede usar. Solo datos reales de la base de datos. */
export async function advisorContext(db: Db) {
  const rows = await loadVideoRows(db, 'latest');
  const withData = rows.filter((r) => r.snapshot);
  const ranking = buildRanking(withData, 'score');
  const [patterns, experiments, recs] = await Promise.all([
    db.query(`select statement, confidence, dimension, value, metric, direction, lift_pct, group_n, rest_n from historical_patterns where status='activo'`),
    db.query(`select title, hypothesis, variable, status, verdict, conclusion from content_experiments order by created_at desc limit 30`),
    db.query(`select text, status, source, created_at from recommendations order by created_at desc limit 30`),
  ]);
  return {
    videos_total: rows.length,
    videos_with_metrics: withData.length,
    ranking_available: ranking.enough_data,
    top_videos: ranking.items.slice(0, 10).map((i) => ({ title: i.title, category: i.category, tier: i.tier, score: i.score, attrs: i.attrs, duration_seconds: i.duration_seconds })),
    active_patterns: patterns.rows,
    experiments: experiments.rows,
    recommendations: recs.rows,
  };
}

export function advisorRouter(db: Db) {
  const router = Router();
  router.get('/context', async (_req, res) => {
    res.json({ configured: !!process.env.ANTHROPIC_API_KEY, context: await advisorContext(db) });
  });
  router.post('/ask', async () => {
    throw new HttpError(503, 'El AI Advisor todavía no está configurado. Se activará en la fase 2 con una clave de la API de Claude.');
  });
  return router;
}

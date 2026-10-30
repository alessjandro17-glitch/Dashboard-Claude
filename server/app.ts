import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import { audit, ensureAccount, tx, type Db } from './db.js';
import {
  videoSchema, snapshotSchema, accountMetricSchema, categorySchema, experimentSchema, decisionSchema, formatZodError, SNAPSHOT_FIELDS, creativeSchema,
} from './validation.js';
import {
  loadVideoRows, buildRanking, groupAnalysis, runPatternAnalysis, evaluateExperiment, overview, metricValue, DIMENSIONS, type Basis, MIN_GROUP, MIN_RANKING,
} from './analytics.js';
import { derive, median, METRIC_LABELS } from '../shared/metrics.js';
import { HttpError, parse, upsertCreative } from './http.js';
import { importRouter } from './import.js';
import { advisorRouter, type AdvisorClient } from './advisor.js';
import { instagramRouter } from './instagram.js';

const VIDEO_FIELDS = ['title', 'instagram_url', 'instagram_media_id', 'published_at', 'duration_seconds', 'category_id', 'subcategory_id', 'status', 'thumbnail_url', 'description', 'script'];

function pgError(e: any): HttpError | null {
  if (e?.code === '23505') {
    if (/instagram_url/.test(e.constraint || e.detail || '')) return new HttpError(409, 'Ya existe un video con esa URL de Instagram.');
    if (/captured_at/.test(e.constraint || e.detail || '')) return new HttpError(409, 'Ya existe una medición de este video con esa misma fecha y hora.');
    if (/account_daily_metrics/.test(e.table || e.constraint || '')) return new HttpError(409, 'Ya hay un registro de la cuenta para esa fecha.');
    return new HttpError(409, 'El registro ya existe.');
  }
  if (e?.code === '23503') return new HttpError(400, 'El registro hace referencia a un elemento que no existe.');
  if (e?.code === '23514') return new HttpError(400, 'Algún valor no cumple las reglas (por ejemplo, un número negativo).');
  if (e?.code === '22P02') return new HttpError(400, 'Identificador o valor con formato no válido.');
  return null;
}

// ---------- Autenticación opcional (se activa al definir APP_PASSWORD) ----------

function sessionToken(secret: string, issued: number) {
  return `${issued}.${crypto.createHmac('sha256', secret).update(String(issued)).digest('hex')}`;
}
function validToken(secret: string, token: string | undefined) {
  if (!token) return false;
  const [issued] = token.split('.');
  const n = Number(issued);
  if (!n || Date.now() - n > 30 * 24 * 3600_000) return false;
  const expected = sessionToken(secret, n);
  return expected.length === token.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

export function createApp(db: Db, opts: { advisorClient?: () => AdvisorClient } = {}) {
  const app = express();
  app.use(express.json({ limit: '15mb' }));
  app.use(cookieParser());

  const password = process.env.APP_PASSWORD;
  const secret = process.env.SESSION_SECRET || (password ? crypto.createHash('sha256').update(`mca:${password}`).digest('hex') : '');

  app.get('/api/health', async (_req, res) => {
    await db.query('select 1');
    res.json({ ok: true });
  });
  app.get('/api/session', (req, res) => {
    res.json({ auth_required: !!password, authenticated: !password || validToken(secret, req.cookies?.mca_session) });
  });
  app.post('/api/login', (req, res) => {
    if (!password) return res.json({ ok: true });
    const given = String(req.body?.password ?? '');
    const a = crypto.createHash('sha256').update(given).digest();
    const b = crypto.createHash('sha256').update(password).digest();
    if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Contraseña incorrecta' });
    res.cookie('mca_session', sessionToken(secret, Date.now()), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 30 * 24 * 3600_000 });
    res.json({ ok: true });
  });
  app.post('/api/logout', (_req, res) => { res.clearCookie('mca_session'); res.json({ ok: true }); });
  app.use('/api', (req, res, next) => {
    if (!password || req.path.startsWith('/instagram/callback')) return next();
    if (validToken(secret, req.cookies?.mca_session)) return next();
    res.status(401).json({ error: 'Sesión no iniciada' });
  });

  // ---------- Cuenta ----------
  app.get('/api/account', async (_req, res) => res.json(await ensureAccount(db)));
  app.put('/api/account', async (req, res) => {
    const body = parse(z.object({ handle: z.string().trim().min(1), display_name: z.string().trim().nullable().optional() }), req.body);
    const acc = await ensureAccount(db);
    const r = await db.query('update accounts set handle=$2, display_name=$3, updated_at=now() where id=$1 returning *', [acc.id, body.handle.replace(/^@/, ''), body.display_name ?? null]);
    await audit(db, 'account', acc.id, 'editar', body);
    res.json(r.rows[0]);
  });

  app.get('/api/account-metrics', async (_req, res) => {
    res.json((await db.query('select * from account_daily_metrics order by date desc')).rows);
  });
  app.post('/api/account-metrics', async (req, res) => {
    const b = parse(accountMetricSchema, req.body);
    const acc = await ensureAccount(db);
    const r = await db.query(
      `insert into account_daily_metrics (account_id, date, followers_count, new_followers, reach, impressions, views, profile_visits, source, notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [acc.id, b.date, b.followers_count ?? null, b.new_followers ?? null, b.reach ?? null, b.impressions ?? null, b.views ?? null, b.profile_visits ?? null, b.source, b.notes ?? null]);
    await audit(db, 'account_daily_metrics', r.rows[0].id, 'crear', b);
    res.status(201).json(r.rows[0]);
  });
  app.put('/api/account-metrics/:id', async (req, res) => {
    const b = parse(accountMetricSchema, req.body);
    const r = await db.query(
      `update account_daily_metrics set date=$2, followers_count=$3, new_followers=$4, reach=$5, impressions=$6, views=$7, profile_visits=$8, notes=$9, updated_at=now()
       where id=$1 returning *`,
      [req.params.id, b.date, b.followers_count ?? null, b.new_followers ?? null, b.reach ?? null, b.impressions ?? null, b.views ?? null, b.profile_visits ?? null, b.notes ?? null]);
    if (!r.rowCount) throw new HttpError(404, 'Registro no encontrado');
    await audit(db, 'account_daily_metrics', req.params.id, 'editar', b);
    res.json(r.rows[0]);
  });
  app.delete('/api/account-metrics/:id', async (req, res) => {
    const r = await db.query('delete from account_daily_metrics where id=$1 returning *', [req.params.id]);
    if (!r.rowCount) throw new HttpError(404, 'Registro no encontrado');
    await audit(db, 'account_daily_metrics', req.params.id, 'eliminar', r.rows[0]);
    res.status(204).end();
  });

  // ---------- Categorías ----------
  app.get('/api/categories', async (_req, res) => {
    const { rows } = await db.query(
      `select c.*, (select count(*)::int from videos v where v.category_id = c.id or v.subcategory_id = c.id) as video_count
         from content_categories c order by c.parent_id nulls first, lower(c.name)`);
    res.json(rows);
  });
  app.post('/api/categories', async (req, res) => {
    const b = parse(categorySchema, req.body);
    const r = await db.query('insert into content_categories (name, parent_id, description) values ($1,$2,$3) returning *', [b.name, b.parent_id ?? null, b.description ?? null]);
    await audit(db, 'category', r.rows[0].id, 'crear', b);
    res.status(201).json(r.rows[0]);
  });
  app.put('/api/categories/:id', async (req, res) => {
    const b = parse(categorySchema, req.body);
    if (b.parent_id === req.params.id) throw new HttpError(400, 'Una categoría no puede ser su propia subcategoría.');
    const r = await db.query('update content_categories set name=$2, parent_id=$3, description=$4, updated_at=now() where id=$1 returning *', [req.params.id, b.name, b.parent_id ?? null, b.description ?? null]);
    if (!r.rowCount) throw new HttpError(404, 'Categoría no encontrada');
    await audit(db, 'category', req.params.id, 'editar', b);
    res.json(r.rows[0]);
  });
  app.delete('/api/categories/:id', async (req, res) => {
    const r = await db.query('delete from content_categories where id=$1 returning *', [req.params.id]);
    if (!r.rowCount) throw new HttpError(404, 'Categoría no encontrada');
    await audit(db, 'category', req.params.id, 'eliminar', r.rows[0]);
    res.status(204).end();
  });

  // ---------- Videos ----------
  app.get('/api/videos', async (req, res) => {
    const rows = await loadVideoRows(db, 'latest');
    const { rows: all } = await db.query(`select id, status, created_at, updated_at from videos`);
    const byId = new Map(all.map((r) => [r.id, r]));
    // loadVideoRows excluye ideas; aquí se listan todos los estados.
    const { rows: ideas } = await db.query(`select v.*, c.name as category from videos v left join content_categories c on c.id=v.category_id where v.status='idea'`);
    const q = String(req.query.q || '').toLowerCase();
    let list: any[] = [...rows, ...ideas.map((v) => ({ ...v, attrs: {}, snapshot: null, snapshot_count: 0, derived: null }))];
    if (q) list = list.filter((v) => v.title.toLowerCase().includes(q));
    if (req.query.category_id) list = list.filter((v) => v.category_id === req.query.category_id);
    if (req.query.status) list = list.filter((v) => v.status === req.query.status);
    res.json(list.map((v) => ({ ...v, updated_at: byId.get(v.id)?.updated_at })));
  });

  // Valores ya usados en los atributos creativos, para mantener una taxonomía consistente.
  app.get('/api/videos/vocabulary', async (_req, res) => {
    const fields = ['hook_type', 'narrative_style', 'storytelling_structure', 'visual_style', 'animation_type', 'music_type', 'narrative_pace', 'color_composition'];
    const out: Record<string, string[]> = {};
    for (const f of fields) out[f] = (await db.query(`select distinct ${f} as v from video_creative_attributes where ${f} is not null order by 1`)).rows.map((r) => r.v);
    res.json(out);
  });

  app.get('/api/videos/:id', async (req, res) => {
    const v = (await db.query(
      `select v.*, c.name as category, sc.name as subcategory from videos v
        left join content_categories c on c.id=v.category_id left join content_categories sc on sc.id=v.subcategory_id where v.id=$1`, [req.params.id])).rows[0];
    if (!v) throw new HttpError(404, 'Video no encontrado');
    const creative = (await db.query('select * from video_creative_attributes where video_id=$1', [v.id])).rows[0] || null;
    const snaps = (await db.query('select * from video_metrics_snapshots where video_id=$1 order by captured_at asc', [v.id])).rows;
    const pub = v.published_at ? new Date(v.published_at).getTime() : null;
    const snapshots = snaps.map((s) => ({ ...s, hours_since_publish: pub === null ? null : (new Date(s.captured_at).getTime() - pub) / 3_600_000, derived: derive(s, v.duration_seconds) }));
    const notes = (await db.query('select * from production_notes where video_id=$1 order by created_at desc', [v.id])).rows;
    const experiments = (await db.query('select e.id, e.title, e.status, ev.arm from experiment_videos ev join content_experiments e on e.id=ev.experiment_id where ev.video_id=$1', [v.id])).rows;
    const history = (await db.query(`select * from audit_log where entity_id=$1 or (entity='snapshot' and changes->>'video_id'=$1) order by at desc limit 100`, [v.id])).rows;
    res.json({ ...v, creative, snapshots, notes, experiments, history });
  });

  app.post('/api/videos', async (req, res) => {
    const b = parse(videoSchema, req.body);
    const acc = await ensureAccount(db);
    const out = await tx(db, async (c) => {
      const r = await c.query(
        `insert into videos (account_id, ${VIDEO_FIELDS.join(',')}) values ($1, ${VIDEO_FIELDS.map((_, i) => `$${i + 2}`).join(',')}) returning *`,
        [acc.id, ...VIDEO_FIELDS.map((f) => (b as any)[f] ?? null)]).catch((e) => { throw pgError(e) || e; });
      await upsertCreative(c, r.rows[0].id, b.creative);
      await audit(c, 'video', r.rows[0].id, 'crear', b);
      return r.rows[0];
    });
    res.status(201).json(out);
  });

  app.put('/api/videos/:id', async (req, res) => {
    const b = parse(videoSchema, req.body);
    const out = await tx(db, async (c) => {
      const before = (await c.query('select * from videos where id=$1', [req.params.id])).rows[0];
      if (!before) throw new HttpError(404, 'Video no encontrado');
      const r = await c.query(
        `update videos set ${VIDEO_FIELDS.map((f, i) => `${f}=$${i + 2}`).join(', ')}, updated_at=now() where id=$1 returning *`,
        [req.params.id, ...VIDEO_FIELDS.map((f) => (b as any)[f] ?? null)]).catch((e) => { throw pgError(e) || e; });
      await upsertCreative(c, req.params.id, b.creative);
      const changed: Record<string, unknown> = {};
      for (const f of VIDEO_FIELDS) if (String(before[f] ?? '') !== String(r.rows[0][f] ?? '')) changed[f] = { antes: before[f], despues: r.rows[0][f] };
      await audit(c, 'video', req.params.id, 'editar', { ...changed, creative: b.creative });
      return r.rows[0];
    });
    res.json(out);
  });

  app.delete('/api/videos/:id', async (req, res) => {
    const r = await db.query('delete from videos where id=$1 returning *', [req.params.id]);
    if (!r.rowCount) throw new HttpError(404, 'Video no encontrado');
    await audit(db, 'video', req.params.id, 'eliminar', { title: r.rows[0].title });
    res.status(204).end();
  });

  // ---------- Mediciones ----------
  const snapCols = ['captured_at', 'source', ...SNAPSHOT_FIELDS, 'notes'];
  app.post('/api/videos/:id/snapshots', async (req, res) => {
    const b = parse(snapshotSchema, req.body);
    const exists = await db.query('select 1 from videos where id=$1', [req.params.id]);
    if (!exists.rowCount) throw new HttpError(404, 'Video no encontrado');
    const r = await db.query(
      `insert into video_metrics_snapshots (video_id, ${snapCols.join(',')}) values ($1, ${snapCols.map((_, i) => `$${i + 2}`).join(',')}) returning *`,
      [req.params.id, ...snapCols.map((f) => (b as any)[f] ?? null)]).catch((e) => { throw pgError(e) || e; });
    await audit(db, 'snapshot', r.rows[0].id, 'crear', { video_id: req.params.id, ...b });
    res.status(201).json(r.rows[0]);
  });
  app.put('/api/snapshots/:id', async (req, res) => {
    const b = parse(snapshotSchema, req.body);
    const before = (await db.query('select * from video_metrics_snapshots where id=$1', [req.params.id])).rows[0];
    if (!before) throw new HttpError(404, 'Medición no encontrada');
    const r = await db.query(
      `update video_metrics_snapshots set ${snapCols.map((f, i) => `${f}=$${i + 2}`).join(', ')}, updated_at=now() where id=$1 returning *`,
      [req.params.id, ...snapCols.map((f) => (b as any)[f] ?? null)]).catch((e) => { throw pgError(e) || e; });
    await audit(db, 'snapshot', req.params.id, 'editar', { video_id: before.video_id, antes: before, despues: b });
    res.json(r.rows[0]);
  });
  app.delete('/api/snapshots/:id', async (req, res) => {
    const r = await db.query('delete from video_metrics_snapshots where id=$1 returning *', [req.params.id]);
    if (!r.rowCount) throw new HttpError(404, 'Medición no encontrada');
    await audit(db, 'snapshot', req.params.id, 'eliminar', r.rows[0]);
    res.status(204).end();
  });

  // ---------- Notas de producción ----------
  app.post('/api/videos/:id/notes', async (req, res) => {
    const b = parse(z.object({ note: z.string().trim().min(1, 'La nota está vacía') }), req.body);
    const r = await db.query('insert into production_notes (video_id, note) values ($1,$2) returning *', [req.params.id, b.note]).catch((e) => { throw pgError(e) || e; });
    await audit(db, 'production_note', r.rows[0].id, 'crear', { video_id: req.params.id, note: b.note });
    res.status(201).json(r.rows[0]);
  });
  app.delete('/api/notes/:id', async (req, res) => {
    const r = await db.query('delete from production_notes where id=$1 returning *', [req.params.id]);
    if (!r.rowCount) throw new HttpError(404, 'Nota no encontrada');
    await audit(db, 'production_note', req.params.id, 'eliminar', r.rows[0]);
    res.status(204).end();
  });

  // ---------- Analítica ----------
  const basisOf = (q: any): Basis => (['latest', '24h', '7d', '30d'].includes(q) ? q : 'latest');

  app.get('/api/analytics/overview', async (req, res) => {
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(to.getTime() - 30 * 86400_000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) throw new HttpError(400, 'Rango de fechas no válido');
    res.json(await overview(db, from.toISOString(), to.toISOString()));
  });

  app.get('/api/analytics/videos', async (req, res) => {
    res.json(await loadVideoRows(db, basisOf(req.query.basis), { from: req.query.from as string | undefined, to: req.query.to as string | undefined }));
  });

  app.get('/api/analytics/ranking', async (req, res) => {
    const metric = String(req.query.metric || 'reach');
    if (metric !== 'score' && !METRIC_LABELS[metric]) throw new HttpError(400, 'Métrica desconocida');
    const rows = await loadVideoRows(db, basisOf(req.query.basis), { from: req.query.from as string | undefined, to: req.query.to as string | undefined });
    res.json({ basis: basisOf(req.query.basis), ...buildRanking(rows, metric) });
  });

  app.get('/api/analytics/groups', async (req, res) => {
    const dimension = String(req.query.dimension || 'category');
    if (!DIMENSIONS[dimension]) throw new HttpError(400, 'Dimensión desconocida');
    const rows = (await loadVideoRows(db, basisOf(req.query.basis))).filter((r) => r.snapshot);
    res.json(groupAnalysis(rows, dimension));
  });

  // Curvas de evolución: valor de una métrica según las horas transcurridas desde la publicación.
  app.get('/api/analytics/curves', async (req, res) => {
    const metric = String(req.query.metric || 'views');
    if (!(SNAPSHOT_FIELDS as readonly string[]).includes(metric)) throw new HttpError(400, 'Métrica no válida para curvas');
    const { rows } = await db.query(
      `select v.id, v.title, v.published_at, extract(epoch from (s.captured_at - v.published_at)) / 3600 as hours, s.${metric} as value
         from video_metrics_snapshots s join videos v on v.id = s.video_id
        where v.published_at is not null and s.${metric} is not null and s.captured_at >= v.published_at
        order by v.published_at desc, s.captured_at`);
    const map = new Map<string, any>();
    for (const r of rows) {
      if (!map.has(r.id)) map.set(r.id, { id: r.id, title: r.title, published_at: r.published_at, points: [] });
      map.get(r.id).points.push({ hours: r.hours, value: r.value });
    }
    res.json([...map.values()]);
  });

  app.get('/api/analytics/dimensions', (_req, res) => {
    res.json(Object.entries(DIMENSIONS).map(([key, d]) => ({ key, label: d.label })));
  });

  app.get('/api/analytics/video/:id', async (req, res) => {
    const rows = await loadVideoRows(db, basisOf(req.query.basis));
    const me = rows.find((r) => r.id === req.params.id);
    if (!me) throw new HttpError(404, 'Video no encontrado');
    const metrics = ['views', 'reach', 'impressions', 'likes', 'comments', 'shares', 'saves', 'profile_visits', 'follows', 'interactions', 'engagement_rate', 'share_rate', 'save_rate', 'profile_visit_rate', 'follower_conversion_rate', 'avg_watch_time', 'retention_approx'];
    const comparison = metrics.map((m) => {
      const vals = rows.map((r) => metricValue(r, m)).filter((x): x is number => x !== null);
      const x = metricValue(me, m);
      const below = x === null ? null : vals.filter((v) => v < x).length + vals.filter((v) => v === x).length / 2;
      return { metric: m, label: METRIC_LABELS[m], value: x, account_median: median(vals), n: vals.length, percentile: x === null || vals.length < MIN_RANKING ? null : (below! / vals.length) * 100 };
    });
    res.json({ video: me, comparison, min_ranking: MIN_RANKING });
  });

  // Respuestas a las preguntas de Inteligencia de contenido, siempre con la muestra y la significación a la vista.
  app.get('/api/analytics/intelligence', async (req, res) => {
    const rows = (await loadVideoRows(db, basisOf(req.query.basis))).filter((r) => r.snapshot);
    const QUESTIONS: [string, string, string, string][] = [
      ['temas', '¿Qué temas funcionan mejor?', 'category', 'engagement_rate'],
      ['temas_compartidos', '¿Qué temas se comparten más?', 'category', 'share_rate'],
      ['hooks', '¿Qué hooks consiguen mejores resultados?', 'hook_type', 'retention_approx'],
      ['storytelling', '¿Qué estilos de storytelling funcionan?', 'storytelling_structure', 'engagement_rate'],
      ['duracion', '¿Qué duraciones ofrecen mejores resultados?', 'duration_bucket', 'retention_approx'],
      ['visual', '¿Qué estilos visuales generan más interacción?', 'visual_style', 'engagement_rate'],
      ['animacion', '¿Qué tipos de animación funcionan mejor?', 'animation_type', 'save_rate'],
      ['seguidores', '¿Qué temas consiguen más seguidores?', 'category', 'follows'],
    ];
    const answers = QUESTIONS.map(([key, question, dimension, metric]) => {
      const ga = groupAnalysis(rows, dimension, [metric]);
      const eligible = ga.groups.filter((g) => g.stats[metric].enough && g.stats[metric].median !== null);
      const observed = ga.groups.filter((g) => g.stats[metric].median !== null).sort((a, b) => b.stats[metric].median! - a.stats[metric].median!);
      const best = [...eligible].sort((a, b) => b.stats[metric].median! - a.stats[metric].median!)[0] || null;
      return {
        key, question, dimension, dimension_label: ga.label, metric, metric_label: METRIC_LABELS[metric],
        overall_median: ga.overall[metric],
        best: best ? { value: best.value, ...best.stats[metric] } : null,
        observed: observed.slice(0, 5).map((g) => ({ value: g.value, ...g.stats[metric] })),
        groups_total: ga.groups.length, unassigned: ga.unassigned,
      };
    });
    // Características de los mejores videos: frecuencia de cada atributo en el 20 % superior frente al total.
    const ranking = buildRanking(rows, 'score');
    const ranked = ranking.items.filter((i) => i.score !== null);
    const topN = Math.max(1, Math.floor(ranked.length * 0.2));
    const top = ranked.slice(0, topN);
    const traits: any[] = [];
    if (ranked.length >= MIN_RANKING * 2) {
      for (const [key, d] of Object.entries(DIMENSIONS)) {
        if (key === 'subcategory') continue;
        const counts = new Map<string, { top: number; all: number }>();
        for (const r of ranked) { const v = d.get(r); if (!v) continue; const c = counts.get(v) || { top: 0, all: 0 }; c.all++; counts.set(v, c); }
        for (const r of top) { const v = d.get(r); if (v && counts.has(v)) counts.get(v)!.top++; }
        for (const [value, c] of counts) {
          const topShare = (c.top / top.length) * 100;
          const allShare = (c.all / ranked.length) * 100;
          if (c.top >= 2 && topShare >= allShare * 1.5) traits.push({ dimension: d.label, value, top_count: c.top, top_size: top.length, top_share: topShare, all_share: allShare });
        }
      }
      traits.sort((a, b) => b.top_share / b.all_share - a.top_share / a.all_share);
    }
    const followers = rows.filter((r) => metricValue(r, 'follows') !== null).sort((a, b) => metricValue(b, 'follows')! - metricValue(a, 'follows')!).slice(0, 5)
      .map((r) => ({ id: r.id, title: r.title, category: r.category, follows: metricValue(r, 'follows'), follower_conversion_rate: metricValue(r, 'follower_conversion_rate') }));
    res.json({ videos_with_metrics: rows.length, min_group: MIN_GROUP, answers, top_traits: { enough: ranked.length >= MIN_RANKING * 2, ranked: ranked.length, top_size: top.length, traits: traits.slice(0, 12) }, followers });
  });

  app.post('/api/analytics/patterns/run', async (_req, res) => res.json(await runPatternAnalysis(db)));
  app.get('/api/patterns', async (req, res) => {
    const status = req.query.status ? String(req.query.status) : null;
    res.json((await db.query(`select * from historical_patterns ${status ? 'where status=$1' : ''} order by status, confidence desc, abs(lift_pct) desc nulls last`, status ? [status] : [])).rows);
  });

  // ---------- Recomendaciones y decisiones ----------
  app.get('/api/recommendations', async (_req, res) => {
    res.json((await db.query(`select r.*, p.status as pattern_status from recommendations r left join historical_patterns p on p.id=r.pattern_id order by r.created_at desc`)).rows);
  });
  app.post('/api/recommendations', async (req, res) => {
    const b = parse(z.object({ text: z.string().trim().min(1), evidence: z.record(z.string(), z.unknown()).default({}) }), req.body);
    const r = await db.query(`insert into recommendations (text, evidence, source) values ($1,$2,'manual') returning *`, [b.text, JSON.stringify(b.evidence)]);
    await audit(db, 'recommendation', r.rows[0].id, 'crear', b);
    res.status(201).json(r.rows[0]);
  });
  app.patch('/api/recommendations/:id', async (req, res) => {
    const b = parse(z.object({ status: z.enum(['pendiente', 'aceptada', 'descartada', 'aplicada']) }), req.body);
    const r = await db.query('update recommendations set status=$2, updated_at=now() where id=$1 returning *', [req.params.id, b.status]);
    if (!r.rowCount) throw new HttpError(404, 'Recomendación no encontrada');
    await audit(db, 'recommendation', req.params.id, 'editar', b);
    res.json(r.rows[0]);
  });

  app.get('/api/decisions', async (_req, res) => {
    res.json((await db.query(`select d.*, r.text as recommendation_text, e.title as experiment_title from decisions d
      left join recommendations r on r.id=d.recommendation_id left join content_experiments e on e.id=d.experiment_id order by d.decided_at desc`)).rows);
  });
  app.post('/api/decisions', async (req, res) => {
    const b = parse(decisionSchema, req.body);
    const r = await db.query(`insert into decisions (title, description, recommendation_id, experiment_id, decided_at, outcome) values ($1,$2,$3,$4,coalesce($5::timestamptz, now()),$6) returning *`,
      [b.title, b.description ?? null, b.recommendation_id ?? null, b.experiment_id ?? null, b.decided_at ?? null, b.outcome ?? null]).catch((e) => { throw pgError(e) || e; });
    await audit(db, 'decision', r.rows[0].id, 'crear', b);
    res.status(201).json(r.rows[0]);
  });
  app.put('/api/decisions/:id', async (req, res) => {
    const b = parse(decisionSchema, req.body);
    const r = await db.query(`update decisions set title=$2, description=$3, recommendation_id=$4, experiment_id=$5, decided_at=coalesce($6::timestamptz, decided_at), outcome=$7, updated_at=now() where id=$1 returning *`,
      [req.params.id, b.title, b.description ?? null, b.recommendation_id ?? null, b.experiment_id ?? null, b.decided_at ?? null, b.outcome ?? null]);
    if (!r.rowCount) throw new HttpError(404, 'Decisión no encontrada');
    await audit(db, 'decision', req.params.id, 'editar', b);
    res.json(r.rows[0]);
  });
  app.delete('/api/decisions/:id', async (req, res) => {
    const r = await db.query('delete from decisions where id=$1 returning *', [req.params.id]);
    if (!r.rowCount) throw new HttpError(404, 'Decisión no encontrada');
    await audit(db, 'decision', req.params.id, 'eliminar', r.rows[0]);
    res.status(204).end();
  });

  // ---------- Laboratorio ----------
  app.get('/api/experiments', async (_req, res) => {
    const { rows } = await db.query(`select e.*,
      (select count(*)::int from experiment_videos ev where ev.experiment_id=e.id and arm='control') as control_count,
      (select count(*)::int from experiment_videos ev where ev.experiment_id=e.id and arm='variante') as variant_count
      from content_experiments e order by e.created_at desc`);
    res.json(rows);
  });
  app.get('/api/experiments/:id', async (req, res) => {
    const e = (await db.query('select * from content_experiments where id=$1', [req.params.id])).rows[0];
    if (!e) throw new HttpError(404, 'Experimento no encontrado');
    const videos = (await db.query('select ev.*, v.title from experiment_videos ev join videos v on v.id=ev.video_id where experiment_id=$1', [e.id])).rows;
    const results = (await db.query('select * from experiment_results where experiment_id=$1 order by computed_at desc', [e.id])).rows;
    res.json({ ...e, videos, results });
  });
  const saveExperiment = async (id: string | null, body: unknown) => {
    const b = parse(experimentSchema, body);
    return tx(db, async (c) => {
      const cols = ['title', 'hypothesis', 'variable', 'primary_metric', 'control_description', 'variant_description', 'controlled_factors', 'uncontrolled_factors', 'status', 'verdict', 'conclusion'];
      const vals = cols.map((f) => (b as any)[f] ?? null);
      let row;
      if (id) {
        row = (await c.query(`update content_experiments set ${cols.map((f, i) => `${f}=$${i + 2}`).join(', ')},
          concluded_at = case when $10 = 'concluido' then coalesce(concluded_at, now()) else null end, updated_at=now() where id=$1 returning *`, [id, ...vals])).rows[0];
        if (!row) throw new HttpError(404, 'Experimento no encontrado');
        await c.query('delete from experiment_videos where experiment_id=$1', [id]);
      } else {
        row = (await c.query(`insert into content_experiments (${cols.join(',')}, concluded_at) values (${cols.map((_, i) => `$${i + 1}`).join(',')}, case when $9 = 'concluido' then now() end) returning *`, vals)).rows[0];
      }
      for (const v of b.videos) {
        await c.query('insert into experiment_videos (experiment_id, video_id, arm) values ($1,$2,$3) on conflict (experiment_id, video_id) do update set arm=excluded.arm', [row.id, v.video_id, v.arm]);
      }
      await audit(c, 'experiment', row.id, id ? 'editar' : 'crear', b);
      // Al concluir, la conclusión pasa a la memoria como recomendación respaldada por el experimento.
      if (b.status === 'concluido' && b.conclusion) {
        const exists = await c.query(`select 1 from recommendations where experiment_id=$1 and text=$2`, [row.id, b.conclusion]);
        if (!exists.rowCount) {
          const last = (await c.query('select * from experiment_results where experiment_id=$1 order by computed_at desc limit 1', [row.id])).rows[0] || null;
          await c.query(`insert into recommendations (text, evidence, source, experiment_id) values ($1,$2,'experimento',$3)`,
            [b.conclusion, JSON.stringify({ hypothesis: b.hypothesis, verdict: b.verdict, last_result: last }), row.id]);
        }
      }
      return row;
    }).catch((e) => { throw pgError(e) || e; });
  };
  app.post('/api/experiments', async (req, res) => res.status(201).json(await saveExperiment(null, req.body)));
  app.put('/api/experiments/:id', async (req, res) => res.json(await saveExperiment(req.params.id, req.body)));
  app.delete('/api/experiments/:id', async (req, res) => {
    const r = await db.query('delete from content_experiments where id=$1 returning *', [req.params.id]);
    if (!r.rowCount) throw new HttpError(404, 'Experimento no encontrado');
    await audit(db, 'experiment', req.params.id, 'eliminar', { title: r.rows[0].title });
    res.status(204).end();
  });
  app.post('/api/experiments/:id/evaluate', async (req, res) => {
    const r = await evaluateExperiment(db, req.params.id, true);
    if (!r) throw new HttpError(404, 'Experimento no encontrado');
    res.json(r);
  });

  // ---------- Memoria histórica ----------
  app.get('/api/memory', async (_req, res) => {
    const [runs, patterns, recs, decisions, experiments, audits, notes, counts] = await Promise.all([
      db.query('select * from analysis_runs order by run_at desc limit 50'),
      db.query('select * from historical_patterns order by last_confirmed_at desc'),
      db.query('select * from recommendations order by created_at desc'),
      db.query('select * from decisions order by decided_at desc'),
      db.query(`select * from content_experiments where status='concluido' order by concluded_at desc`),
      db.query('select * from audit_log order by at desc limit 200'),
      db.query('select n.*, v.title from production_notes n left join videos v on v.id=n.video_id order by n.created_at desc limit 100'),
      db.query(`select (select count(*)::int from videos) videos, (select count(*)::int from video_metrics_snapshots) snapshots,
        (select count(*)::int from account_daily_metrics) account_days, (select count(*)::int from content_experiments) experiments,
        (select count(*)::int from historical_patterns where status='activo') active_patterns, (select count(*)::int from recommendations) recommendations,
        (select count(*)::int from decisions) decisions, (select count(*)::int from ai_insights) ai_insights, (select min(published_at) from videos) first_published`),
    ]);
    res.json({ counts: counts.rows[0], runs: runs.rows, patterns: patterns.rows, recommendations: recs.rows, decisions: decisions.rows, experiments: experiments.rows, audit: audits.rows, notes: notes.rows });
  });

  // ---------- Exportación y copias de seguridad ----------
  const EXPORT_TABLES = ['accounts', 'account_daily_metrics', 'content_categories', 'videos', 'video_creative_attributes', 'video_metrics_snapshots', 'production_notes',
    'content_experiments', 'experiment_videos', 'experiment_results', 'analysis_runs', 'historical_patterns', 'recommendations', 'decisions', 'ai_insights', 'audit_log'];
  app.get('/api/export/backup.json', async (_req, res) => {
    const out: Record<string, unknown[]> = {};
    for (const t of EXPORT_TABLES) out[t] = (await db.query(`select * from ${t}`)).rows;
    res.setHeader('Content-Disposition', `attachment; filename="mundo-curioso-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({ exported_at: new Date().toISOString(), schema_version: 1, tables: out });
  });
  app.get('/api/export/:table.csv', async (req, res) => {
    const t = String(req.params.table);
    if (!EXPORT_TABLES.includes(t)) throw new HttpError(404, 'Tabla desconocida');
    const { rows, fields } = await db.query(`select * from ${t}`);
    const esc = (v: unknown) => {
      if (v === null || v === undefined) return '';
      const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [fields.map((f) => f.name).join(','), ...rows.map((r) => fields.map((f) => esc(r[f.name])).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${t}.csv"`);
    res.send('﻿' + csv);
  });

  app.get('/api/status', async (_req, res) => {
    const url = process.env.DATABASE_URL || '';
    const host = (() => { try { return new URL(url).hostname; } catch { return 'desconocido'; } })();
    const igRow = (await db.query(`select status, last_sync_at, last_error, config->>'username' as username from integrations where provider='instagram'`)).rows[0];
    const ig = igRow || { status: 'no_configurada' };
    res.json({
      database: { engine: 'PostgreSQL', host, supabase: /supabase/.test(host), migrations: (await db.query('select name, applied_at from schema_migrations order by name')).rows },
      auth_enabled: !!password,
      advisor_configured: !!process.env.ANTHROPIC_API_KEY,
      instagram: { ...ig, app_configured: !!(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.META_REDIRECT_URI) },
      min_group: MIN_GROUP, min_ranking: MIN_RANKING,
    });
  });

  app.use('/api/import', importRouter(db));
  app.use('/api/advisor', advisorRouter(db, opts.advisorClient));
  app.use('/api/instagram', instagramRouter(db));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

  // Archivos del cliente compilado (producción).
  const dist = path.resolve(process.cwd(), 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const e = err instanceof HttpError ? err : pgError(err);
    if (e) return res.status(e.status).json({ error: e.message, details: e.details });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON no válido' });
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  });
  return app;
}

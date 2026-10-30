import { Router } from 'express';
import { z } from 'zod';
import { audit, ensureAccount, tx, type Db } from './db.js';
import { videoSchema, snapshotSchema, accountMetricSchema, formatZodError, SNAPSHOT_FIELDS, creativeSchema } from './validation.js';
import { HttpError, parse, upsertCreative } from './http.js';

const CREATIVE_FIELDS = Object.keys(creativeSchema.shape);
const NUMERIC_VIDEO = ['duration_seconds'];
const INT_CREATIVE = ['scene_count', 'production_complexity'];
const BOOL_CREATIVE = ['uses_code_art', 'has_voiceover'];

/** Interpreta números escritos con separadores de miles o coma decimal ("1.234", "1,234", "12,5"). */
export function parseNumber(raw: unknown): number | null | 'invalid' {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim().replace(/\s|%/g, '');
  if (s === '' || /^(-|n\/?a|null|sin dato|no registrado)$/i.test(s)) return null;
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, '');
  else if (/^\d+,\d+$/.test(s)) s = s.replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+\.\d+$/.test(s)) s = s.replace(/,/g, '');
  else if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  // Formato de duración mm:ss
  if (/^\d+:\d{2}$/.test(s)) { const [m, sec] = s.split(':').map(Number); return m * 60 + sec; }
  const n = Number(s);
  return Number.isFinite(n) ? n : 'invalid';
}

export function parseBool(raw: unknown): boolean | null | 'invalid' {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const s = String(raw).trim().toLowerCase();
  if (['si', 'sí', 'yes', 'true', '1', 'x', 'verdadero'].includes(s)) return true;
  if (['no', 'false', '0', 'falso'].includes(s)) return false;
  return 'invalid';
}

/** Acepta ISO 8601, "AAAA-MM-DD HH:mm" y "DD/MM/AAAA [HH:mm]". Sin zona horaria se interpreta en la zona indicada por offset (minutos). */
export function parseDate(raw: unknown, tzOffsetMinutes = 0): string | null | 'invalid' {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const s = String(raw).trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  let parts: number[] | null = null;
  if (m) parts = [Number(m[3]), Number(m[2]), Number(m[1]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)];
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)];
  if (parts) {
    const [y, mo, d, h, mi, se] = parts;
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return 'invalid';
    const t = Date.UTC(y, mo - 1, d, h, mi, se) - tzOffsetMinutes * 60_000;
    const back = new Date(Date.UTC(y, mo - 1, d));
    if (back.getUTCDate() !== d) return 'invalid';
    return new Date(t).toISOString();
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? 'invalid' : new Date(t).toISOString();
}

interface Normalized {
  video: Record<string, any>;
  creative: Record<string, any>;
  snapshot: Record<string, any> | null;
  category: string | null;
  subcategory: string | null;
}

function normalizeRow(raw: Record<string, unknown>, opts: { tz: number; default_captured_at?: string | null }) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const str = (k: string) => { const v = raw[k]; return v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim(); };
  const video: Record<string, any> = {
    title: str('title'),
    instagram_url: str('instagram_url'),
    instagram_media_id: str('instagram_media_id'),
    status: (str('status') || 'publicado').toLowerCase(),
    thumbnail_url: str('thumbnail_url'),
    description: str('description'),
    script: str('script'),
  };
  // Fecha y hora pueden venir juntas o en columnas separadas.
  const dateRaw = str('published_at') ?? (str('published_date') ? `${str('published_date')}${str('published_time') ? ' ' + str('published_time') : ''}` : null);
  const pub = parseDate(dateRaw, opts.tz);
  if (pub === 'invalid') errors.push(`Fecha de publicación no válida: "${dateRaw}"`);
  else video.published_at = pub;
  for (const f of NUMERIC_VIDEO) {
    const n = parseNumber(raw[f]);
    if (n === 'invalid') errors.push(`${f}: "${raw[f]}" no es un número`);
    else video[f] = n;
  }
  const creative: Record<string, any> = {};
  for (const f of CREATIVE_FIELDS) {
    if (!(f in raw)) continue;
    if (BOOL_CREATIVE.includes(f)) {
      const b = parseBool(raw[f]);
      if (b === 'invalid') errors.push(`${f}: "${raw[f]}" debe ser sí o no`); else creative[f] = b;
    } else if (INT_CREATIVE.includes(f)) {
      const n = parseNumber(raw[f]);
      if (n === 'invalid') errors.push(`${f}: "${raw[f]}" no es un número`); else creative[f] = n;
    } else if (f === 'dimension') {
      const v = str(f);
      creative[f] = v ? (v.toUpperCase() === 'NINGUNO' ? 'ninguno' : v.toUpperCase().replace(/\s/g, '').replace('Y', '+')) : null;
    } else creative[f] = str(f);
  }
  let snapshot: Record<string, any> | null = null;
  const metricVals: Record<string, any> = {};
  for (const f of SNAPSHOT_FIELDS) {
    if (!(f in raw)) continue;
    const n = parseNumber(raw[f]);
    if (n === 'invalid') errors.push(`${f}: "${raw[f]}" no es un número`);
    else if (n !== null) metricVals[f] = n;
  }
  if (Object.keys(metricVals).length) {
    const capRaw = str('captured_at');
    let cap = capRaw ? parseDate(capRaw, opts.tz) : (opts.default_captured_at ?? null);
    if (cap === 'invalid') { errors.push(`Fecha de medición no válida: "${capRaw}"`); cap = null; }
    if (!cap) errors.push('Hay métricas pero falta la fecha y hora de la medición (columna o valor por defecto).');
    snapshot = { captured_at: cap, source: 'csv', ...metricVals };
    if (cap && video.published_at && new Date(cap) < new Date(video.published_at)) errors.push('La fecha de medición es anterior a la publicación.');
  }
  // Validación con los mismos esquemas que el registro manual.
  const vr = videoSchema.safeParse({ ...video, creative });
  if (!vr.success) formatZodError(vr.error).forEach((e) => errors.push(`${e.field || 'fila'}: ${e.message}`));
  if (snapshot && snapshot.captured_at) {
    const sr = snapshotSchema.safeParse(snapshot);
    if (!sr.success) formatZodError(sr.error).forEach((e) => errors.push(`${e.field || 'medición'}: ${e.message}`));
  }
  if (!video.published_at) warnings.push('Sin fecha de publicación: no aparecerá en filtros por periodo.');
  if (!video.duration_seconds) warnings.push('Sin duración: no se podrá calcular la retención aproximada.');
  const n: Normalized = { video, creative, snapshot, category: str('category'), subcategory: str('subcategory') };
  return { errors, warnings, normalized: n };
}

const rowsSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1, 'El archivo no tiene filas').max(5000, 'Máximo 5000 filas por importación'),
  tz_offset_minutes: z.number().int().min(-840).max(840).default(0),
  default_captured_at: z.string().nullable().optional(),
  duplicate_mode: z.enum(['skip', 'update']).default('skip'),
});

async function analyse(db: Db, body: z.infer<typeof rowsSchema>) {
  const defCap = body.default_captured_at ? parseDate(body.default_captured_at, body.tz_offset_minutes) : null;
  const { rows: existing } = await db.query('select id, title, instagram_url, published_at from videos');
  const byUrl = new Map(existing.filter((v) => v.instagram_url).map((v) => [v.instagram_url.toLowerCase().replace(/\/+$/, ''), v]));
  const keyOf = (title: string | null, pub: string | null) => (title && pub ? `${title.toLowerCase()}|${pub.slice(0, 10)}` : null);
  const byKey = new Map(existing.map((v) => [keyOf(v.title, v.published_at ? new Date(v.published_at).toISOString() : null), v]).filter(([k]) => k) as [string, any][]);
  const seen = new Map<string, number>();
  return body.rows.map((raw, index) => {
    const r = normalizeRow(raw, { tz: body.tz_offset_minutes, default_captured_at: defCap === 'invalid' ? null : defCap });
    const url = r.normalized.video.instagram_url ? String(r.normalized.video.instagram_url).toLowerCase().replace(/\/+$/, '') : null;
    const k = keyOf(r.normalized.video.title, r.normalized.video.published_at ?? null);
    const match = (url && byUrl.get(url)) || (k && byKey.get(k)) || null;
    const fileKey = url || k;
    let status: 'nuevo' | 'duplicado' | 'duplicado_en_archivo' | 'error' = 'nuevo';
    let dupOf: number | null = null;
    if (fileKey && seen.has(fileKey)) {
      dupOf = seen.get(fileKey)!;
      // Varias filas del mismo video con fechas de medición distintas son legítimas: se tratan como mediciones adicionales.
      status = 'duplicado_en_archivo';
    } else if (fileKey) seen.set(fileKey, index);
    if (match && status === 'nuevo') status = 'duplicado';
    if (r.errors.length) status = 'error';
    return { index, status, errors: r.errors, warnings: r.warnings, match: match ? { id: match.id, title: match.title } : null, duplicate_of_row: dupOf, normalized: r.normalized };
  });
}

export function importRouter(db: Db) {
  const router = Router();

  router.post('/videos/preview', async (req, res) => {
    const body = parse(rowsSchema, req.body);
    const rows = await analyse(db, body);
    const summary = rows.reduce((acc: Record<string, number>, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
    res.json({ summary, rows });
  });

  router.post('/videos/commit', async (req, res) => {
    const body = parse(rowsSchema, req.body);
    const rows = await analyse(db, body);
    const acc = await ensureAccount(db);
    const report = { created: 0, updated: 0, skipped: 0, snapshots_added: 0, snapshots_skipped: 0, errors: [] as { index: number; errors: string[] }[], categories_created: 0 };
    await tx(db, async (c) => {
      const catCache = new Map<string, string>();
      const cat = async (name: string | null, parent: string | null) => {
        if (!name) return null;
        const key = `${parent || ''}|${name.toLowerCase()}`;
        if (catCache.has(key)) return catCache.get(key)!;
        let r = await c.query(`select id from content_categories where lower(name)=lower($1) and parent_id is not distinct from $2`, [name, parent]);
        if (!r.rowCount) { r = await c.query('insert into content_categories (name, parent_id) values ($1,$2) returning id', [name, parent]); report.categories_created++; }
        catCache.set(key, r.rows[0].id);
        return r.rows[0].id as string;
      };
      const createdByRow = new Map<number, string>();
      for (const r of rows) {
        if (r.status === 'error') { report.errors.push({ index: r.index, errors: r.errors }); continue; }
        const n = r.normalized;
        let videoId: string | null = r.match?.id ?? (r.duplicate_of_row !== null ? createdByRow.get(r.duplicate_of_row) ?? null : null);
        const categoryId = await cat(n.category, null);
        const subId = n.subcategory ? await cat(n.subcategory, categoryId) : null;
        const v = videoSchema.parse({ ...n.video, creative: n.creative });
        if (!videoId) {
          const ins = await c.query(
            `insert into videos (account_id, title, instagram_url, instagram_media_id, published_at, duration_seconds, category_id, subcategory_id, status, thumbnail_url, description, script)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
            [acc.id, v.title, v.instagram_url ?? null, v.instagram_media_id ?? null, v.published_at ?? null, v.duration_seconds ?? null, categoryId, subId, v.status, v.thumbnail_url ?? null, v.description ?? null, v.script ?? null]);
          videoId = ins.rows[0].id as string;
          await upsertCreative(c, videoId, Object.fromEntries(Object.entries(v.creative || {}).filter(([, x]) => x !== null && x !== undefined)));
          await audit(c, 'video', videoId, 'importar', { row: r.index, title: v.title });
          report.created++;
        } else if (r.status === 'duplicado' && body.duplicate_mode === 'skip') {
          report.skipped++;
          createdByRow.set(r.index, videoId);
          if (!n.snapshot) continue;
        } else if (r.status === 'duplicado' && body.duplicate_mode === 'update') {
          // Solo se actualizan los campos que vienen con valor en el CSV; nada se borra.
          const fields: Record<string, unknown> = { ...v, category_id: categoryId, subcategory_id: subId };
          delete fields.creative;
          const set = Object.entries(fields).filter(([k, x]) => x !== null && x !== undefined && k !== 'status');
          if (set.length) await c.query(`update videos set ${set.map(([k], i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() where id=$1`, [videoId, ...set.map(([, x]) => x)]);
          await upsertCreative(c, videoId, Object.fromEntries(Object.entries(v.creative || {}).filter(([, x]) => x !== null && x !== undefined)));
          await audit(c, 'video', videoId, 'importar', { row: r.index, actualizado: Object.fromEntries(set) });
          report.updated++;
        }
        createdByRow.set(r.index, videoId);
        if (n.snapshot) {
          const s = snapshotSchema.parse(n.snapshot);
          const cols = ['captured_at', 'source', ...SNAPSHOT_FIELDS];
          const ins = await c.query(
            `insert into video_metrics_snapshots (video_id, ${cols.join(',')}) values ($1, ${cols.map((_, i) => `$${i + 2}`).join(',')})
             on conflict (video_id, captured_at) do nothing returning id`,
            [videoId, ...cols.map((f) => (s as any)[f] ?? null)]);
          if (ins.rowCount) { report.snapshots_added++; await audit(c, 'snapshot', ins.rows[0].id, 'importar', { video_id: videoId, row: r.index }); }
          else report.snapshots_skipped++;
        }
      }
    });
    res.json(report);
  });

  const accRows = z.object({ rows: z.array(z.record(z.string(), z.unknown())).min(1).max(5000), duplicate_mode: z.enum(['skip', 'update']).default('skip') });
  const normAcc = (raw: Record<string, unknown>) => {
    const errors: string[] = [];
    const d = parseDate(raw.date);
    const out: Record<string, unknown> = { source: 'csv' };
    if (d === 'invalid' || d === null) errors.push(`Fecha no válida: "${raw.date ?? ''}"`); else out.date = d.slice(0, 10);
    for (const f of ['followers_count', 'new_followers', 'reach', 'impressions', 'views', 'profile_visits']) {
      if (!(f in raw)) continue;
      const n = parseNumber(raw[f]);
      if (n === 'invalid') errors.push(`${f}: "${raw[f]}" no es un número`); else out[f] = n;
    }
    if (!errors.length) {
      const r = accountMetricSchema.safeParse(out);
      if (!r.success) formatZodError(r.error).forEach((e) => errors.push(`${e.field}: ${e.message}`));
    }
    return { errors, normalized: out };
  };
  router.post('/account/preview', async (req, res) => {
    const body = parse(accRows, req.body);
    const { rows: ex } = await db.query(`select id, to_char(date, 'YYYY-MM-DD') as date from account_daily_metrics`);
    const have = new Map(ex.map((r) => [r.date, r.id]));
    const seen = new Set<string>();
    const rows = body.rows.map((raw, index) => {
      const r = normAcc(raw);
      const date = r.normalized.date as string | undefined;
      let status = r.errors.length ? 'error' : 'nuevo';
      if (status === 'nuevo' && date && seen.has(date)) { status = 'error'; r.errors.push('Fecha repetida en el archivo'); }
      else if (status === 'nuevo' && date && have.has(date)) status = 'duplicado';
      if (date) seen.add(date);
      return { index, status, errors: r.errors, normalized: r.normalized };
    });
    const summary = rows.reduce((a: Record<string, number>, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
    res.json({ summary, rows });
  });
  router.post('/account/commit', async (req, res) => {
    const body = parse(accRows, req.body);
    const acc = await ensureAccount(db);
    const report = { created: 0, updated: 0, skipped: 0, errors: [] as { index: number; errors: string[] }[] };
    await tx(db, async (c) => {
      const seen = new Set<string>();
      for (const [index, raw] of body.rows.entries()) {
        const r = normAcc(raw);
        const date = r.normalized.date as string | undefined;
        if (r.errors.length || !date || seen.has(date)) { report.errors.push({ index, errors: r.errors.length ? r.errors : ['Fecha repetida en el archivo'] }); continue; }
        seen.add(date);
        const b = accountMetricSchema.parse(r.normalized);
        const cols = ['followers_count', 'new_followers', 'reach', 'impressions', 'views', 'profile_visits'].filter((f) => (b as any)[f] !== undefined && (b as any)[f] !== null);
        const exists = (await c.query('select id from account_daily_metrics where date=$1', [date])).rows[0];
        if (exists && body.duplicate_mode === 'skip') { report.skipped++; continue; }
        if (exists) {
          if (cols.length) await c.query(`update account_daily_metrics set ${cols.map((f, i) => `${f}=$${i + 2}`).join(', ')}, updated_at=now() where id=$1`, [exists.id, ...cols.map((f) => (b as any)[f])]);
          await audit(c, 'account_daily_metrics', exists.id, 'importar', b);
          report.updated++;
        } else {
          const ins = await c.query(`insert into account_daily_metrics (account_id, date, source, ${cols.join(',')}) values ($1,$2,'csv'${cols.map((_, i) => `,$${i + 3}`).join('')}) returning id`,
            [acc.id, date, ...cols.map((f) => (b as any)[f])]);
          await audit(c, 'account_daily_metrics', ins.rows[0].id, 'importar', b);
          report.created++;
        }
      }
    });
    res.json(report);
  });

  router.use((_req, _res, next) => next(new HttpError(404, 'Ruta no encontrada')));
  return router;
}

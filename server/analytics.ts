import type { Db } from './db.js';
import {
  derive, median, mad, mannWhitney, benjaminiHochberg, durationBucket, METRIC_LABELS, RATE_METRICS, type DerivedMetrics,
} from '../shared/metrics.js';
import { SNAPSHOT_FIELDS } from './validation.js';

export const MIN_GROUP = 5; // tamaño mínimo por grupo para comparar
export const MIN_RANKING = 5; // videos con dato necesarios para clasificar

export type Basis = 'latest' | '24h' | '7d' | '30d';
const BASIS_HOURS: Record<Exclude<Basis, 'latest'>, number> = { '24h': 24, '7d': 168, '30d': 720 };

export interface VideoRow {
  id: string;
  title: string;
  instagram_url: string | null;
  thumbnail_url: string | null;
  published_at: string | null;
  duration_seconds: number | null;
  status: string;
  category: string | null;
  subcategory: string | null;
  category_id: string | null;
  attrs: Record<string, unknown>;
  snapshot: Record<string, number | null> | null;
  snapshot_captured_at: string | null;
  snapshot_age_hours: number | null;
  snapshot_count: number;
  derived: DerivedMetrics | null;
}

/** Carga los videos con la medición elegida según la base de comparación. */
export async function loadVideoRows(db: Db, basis: Basis = 'latest', opts: { from?: string; to?: string } = {}): Promise<VideoRow[]> {
  const params: unknown[] = [];
  let where = "where v.status <> 'idea'";
  if (opts.from) { params.push(opts.from); where += ` and v.published_at >= $${params.length}`; }
  if (opts.to) { params.push(opts.to); where += ` and v.published_at < $${params.length}`; }
  const { rows: videos } = await db.query(
    `select v.*, c.name as category, sc.name as subcategory, to_jsonb(a) - 'video_id' - 'updated_at' as attrs
       from videos v
       left join content_categories c on c.id = v.category_id
       left join content_categories sc on sc.id = v.subcategory_id
       left join video_creative_attributes a on a.video_id = v.id
       ${where}
       order by v.published_at desc nulls last`, params);
  if (!videos.length) return [];
  const { rows: snaps } = await db.query(
    `select * from video_metrics_snapshots where video_id = any($1) order by captured_at asc`, [videos.map((v) => v.id)]);
  const byVideo = new Map<string, any[]>();
  for (const s of snaps) {
    if (!byVideo.has(s.video_id)) byVideo.set(s.video_id, []);
    byVideo.get(s.video_id)!.push(s);
  }
  return videos.map((v) => {
    const list = byVideo.get(v.id) || [];
    const pub = v.published_at ? new Date(v.published_at).getTime() : null;
    const ageOf = (s: any) => (pub === null ? null : (new Date(s.captured_at).getTime() - pub) / 3_600_000);
    let chosen: any = null;
    if (basis === 'latest') chosen = list[list.length - 1] || null;
    else if (pub !== null) {
      const target = BASIS_HOURS[basis];
      const tol = target * 0.25;
      let best = Infinity;
      for (const s of list) {
        const d = Math.abs((ageOf(s) as number) - target);
        if (d <= tol && d < best) { best = d; chosen = s; }
      }
    }
    const snapshot = chosen ? Object.fromEntries(SNAPSHOT_FIELDS.map((f) => [f, chosen[f]])) : null;
    return {
      id: v.id,
      title: v.title,
      instagram_url: v.instagram_url,
      thumbnail_url: v.thumbnail_url,
      published_at: v.published_at,
      duration_seconds: v.duration_seconds,
      status: v.status,
      category: v.category,
      subcategory: v.subcategory,
      category_id: v.category_id,
      attrs: v.attrs || {},
      snapshot,
      snapshot_captured_at: chosen?.captured_at ?? null,
      snapshot_age_hours: chosen ? ageOf(chosen) : null,
      snapshot_count: list.length,
      derived: snapshot ? derive(snapshot, v.duration_seconds) : null,
    };
  });
}

export function metricValue(v: VideoRow, metric: string): number | null {
  if (!v.snapshot) return null;
  if (metric in v.snapshot) return v.snapshot[metric] ?? null;
  if (v.derived && metric in v.derived) {
    const x = (v.derived as any)[metric];
    return typeof x === 'number' ? x : null;
  }
  return null;
}

// ---------- Ranking ----------

export const RANKING_METRICS = ['reach', 'views', 'shares', 'saves', 'retention_approx', 'engagement_rate', 'follows'] as const;
const SCORE_METRICS = ['reach', 'engagement_rate', 'share_rate', 'save_rate', 'follows', 'retention_approx'];

export type Tier = 'extraordinario' | 'superior' | 'normal' | 'inferior';

function transform(metric: string, x: number) {
  return RATE_METRICS.has(metric) ? x : Math.log1p(x);
}

/** Puntuación z robusta (mediana y MAD) respecto al historial de la propia cuenta. */
export function robustZ(values: number[], metric: string) {
  const t = values.map((x) => transform(metric, x));
  const m = median(t)!;
  const s = mad(t)!;
  return (x: number) => {
    const tx = transform(metric, x);
    if (s === 0) return tx === m ? 0 : tx > m ? 3 : -3;
    return (tx - m) / s;
  };
}

export function tierFor(z: number): Tier {
  if (z >= 2) return 'extraordinario';
  if (z >= 0.5) return 'superior';
  if (z <= -0.5) return 'inferior';
  return 'normal';
}

export function buildRanking(rows: VideoRow[], metric: string) {
  const scorers: Record<string, ((x: number) => number) | null> = {};
  for (const m of SCORE_METRICS) {
    const vals = rows.map((r) => metricValue(r, m)).filter((x): x is number => x !== null);
    scorers[m] = vals.length >= MIN_RANKING ? robustZ(vals, m) : null;
  }
  const items = rows.map((r) => {
    const zs = SCORE_METRICS.map((m) => {
      const x = metricValue(r, m);
      return x !== null && scorers[m] ? scorers[m]!(x) : null;
    }).filter((z): z is number => z !== null);
    const score = zs.length >= 3 ? zs.reduce((a, b) => a + b, 0) / zs.length : null;
    return { ...r, value: metric === 'score' ? score : metricValue(r, metric), score, z: null as number | null, tier: null as Tier | null };
  });
  const withValue = items.filter((i) => i.value !== null);
  const enough = withValue.length >= MIN_RANKING;
  if (enough) {
    if (metric === 'score') {
      for (const i of withValue) { i.z = i.score; i.tier = tierFor(i.score!); }
    } else {
      const z = robustZ(withValue.map((i) => i.value as number), metric);
      for (const i of withValue) { i.z = z(i.value as number); i.tier = tierFor(i.z); }
    }
  }
  withValue.sort((a, b) => (b.value as number) - (a.value as number));
  return {
    metric,
    enough_data: enough,
    min_required: MIN_RANKING,
    with_value: withValue.length,
    without_value: items.length - withValue.length,
    items: withValue,
    missing: items.filter((i) => i.value === null).map((i) => ({ id: i.id, title: i.title })),
  };
}

// ---------- Agrupaciones y patrones ----------

export const DIMENSIONS: Record<string, { label: string; get: (v: VideoRow) => string | null }> = {
  category: { label: 'Categoría', get: (v) => v.category },
  subcategory: { label: 'Subcategoría', get: (v) => v.subcategory },
  hook_type: { label: 'Tipo de hook', get: (v) => (v.attrs.hook_type as string) ?? null },
  narrative_style: { label: 'Estilo narrativo', get: (v) => (v.attrs.narrative_style as string) ?? null },
  storytelling_structure: { label: 'Estructura del storytelling', get: (v) => (v.attrs.storytelling_structure as string) ?? null },
  visual_style: { label: 'Estilo visual', get: (v) => (v.attrs.visual_style as string) ?? null },
  animation_type: { label: 'Tipo de animación', get: (v) => (v.attrs.animation_type as string) ?? null },
  uses_code_art: { label: 'Uso de Code Art', get: (v) => (v.attrs.uses_code_art == null ? null : v.attrs.uses_code_art ? 'Sí' : 'No') },
  dimension: { label: 'Elementos 2D/3D', get: (v) => (v.attrs.dimension as string) ?? null },
  music_type: { label: 'Tipo de música', get: (v) => (v.attrs.music_type as string) ?? null },
  has_voiceover: { label: 'Voz en off', get: (v) => (v.attrs.has_voiceover == null ? null : v.attrs.has_voiceover ? 'Sí' : 'No') },
  narrative_pace: { label: 'Velocidad narrativa', get: (v) => (v.attrs.narrative_pace as string) ?? null },
  production_complexity: { label: 'Complejidad de producción', get: (v) => (v.attrs.production_complexity == null ? null : `Nivel ${v.attrs.production_complexity}`) },
  color_composition: { label: 'Colores y composición', get: (v) => (v.attrs.color_composition as string) ?? null },
  duration_bucket: { label: 'Duración', get: (v) => durationBucket(v.duration_seconds) },
  weekday: { label: 'Día de publicación', get: (v) => (v.published_at ? ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][new Date(v.published_at).getUTCDay()] : null) },
  hour_bucket: {
    label: 'Franja horaria (UTC)',
    get: (v) => {
      if (!v.published_at) return null;
      const h = new Date(v.published_at).getUTCHours();
      return h < 6 ? '00–06' : h < 12 ? '06–12' : h < 18 ? '12–18' : '18–24';
    },
  },
};

export const PATTERN_METRICS = ['views', 'reach', 'engagement_rate', 'share_rate', 'save_rate', 'profile_visit_rate', 'follower_conversion_rate', 'retention_approx', 'follows'];

export function groupAnalysis(rows: VideoRow[], dimension: string, metrics = PATTERN_METRICS) {
  const dim = DIMENSIONS[dimension];
  if (!dim) throw new Error(`Dimensión desconocida: ${dimension}`);
  const groups = new Map<string, VideoRow[]>();
  let unassigned = 0;
  for (const r of rows) {
    const k = dim.get(r);
    if (k === null || k === undefined || k === '') { unassigned++; continue; }
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const overall: Record<string, number | null> = {};
  for (const m of metrics) overall[m] = median(rows.map((r) => metricValue(r, m)).filter((x): x is number => x !== null));
  const out = [...groups.entries()].map(([value, vids]) => {
    const stats: Record<string, { n: number; median: number | null; rest_median: number | null; lift_pct: number | null; p_value: number | null; enough: boolean }> = {};
    for (const m of metrics) {
      const g = vids.map((r) => metricValue(r, m)).filter((x): x is number => x !== null);
      const rest = rows.filter((r) => dim.get(r) !== value).map((r) => metricValue(r, m)).filter((x): x is number => x !== null);
      const gm = median(g);
      const rm = median(rest);
      const enough = g.length >= MIN_GROUP && rest.length >= MIN_GROUP;
      const test = enough ? mannWhitney(g, rest) : null;
      stats[m] = {
        n: g.length,
        median: gm,
        rest_median: rm,
        lift_pct: gm !== null && rm !== null && rm > 0 ? ((gm - rm) / rm) * 100 : null,
        p_value: test ? test.p : null,
        enough,
      };
    }
    return { value, n: vids.length, stats, video_ids: vids.map((v) => v.id) };
  }).sort((a, b) => b.n - a.n);
  return { dimension, label: dim.label, total: rows.length, unassigned, overall, groups: out, min_group: MIN_GROUP };
}

function fmtMetric(m: string, x: number | null) {
  if (x === null) return 'no registrado';
  if (RATE_METRICS.has(m)) return `${x.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
  return Math.round(x).toLocaleString('es-ES');
}

/**
 * Detecta patrones comparando cada valor de cada dimensión contra el resto de videos.
 * Solo se guardan diferencias con muestra suficiente y significativas tras corregir por comparaciones múltiples.
 * Son asociaciones observadas (correlación), no pruebas de causalidad.
 */
export function detectPatterns(rows: VideoRow[]) {
  const candidates: any[] = [];
  for (const dimension of Object.keys(DIMENSIONS)) {
    const ga = groupAnalysis(rows, dimension);
    if (ga.groups.length < 2) continue;
    for (const g of ga.groups) {
      for (const m of PATTERN_METRICS) {
        const s = g.stats[m];
        if (!s.enough || s.p_value === null || s.median === null || s.rest_median === null) continue;
        const restN = rows.filter((r) => DIMENSIONS[dimension].get(r) !== g.value && metricValue(r, m) !== null).length;
        candidates.push({ dimension, dimension_label: ga.label, value: g.value, metric: m, group_n: s.n, rest_n: restN, group_median: s.median, rest_median: s.rest_median, lift_pct: s.lift_pct, p_value: s.p_value });
      }
    }
  }
  const q = benjaminiHochberg(candidates.map((c) => c.p_value));
  const patterns = candidates
    .map((c, i) => ({ ...c, q_value: q[i] }))
    .filter((c) => c.q_value < 0.1 && c.group_median !== c.rest_median)
    .map((c) => {
      const direction = c.group_median > c.rest_median ? 'superior' : 'inferior';
      const confidence = c.q_value < 0.05 && Math.min(c.group_n, c.rest_n) >= 8 ? 'alta' : 'media';
      const statement = `Los videos con ${c.dimension_label.toLowerCase()} «${c.value}» tienen un valor mediano de ${METRIC_LABELS[c.metric].toLowerCase()} ${direction} al del resto de la cuenta (${fmtMetric(c.metric, c.group_median)} frente a ${fmtMetric(c.metric, c.rest_median)}; n=${c.group_n} frente a ${c.rest_n}; q=${c.q_value.toFixed(3)}). Es una asociación observada, no prueba que esa característica cause el resultado.`;
      return { ...c, direction, confidence, statement };
    });
  return { tested: candidates.length, patterns };
}

export function recommendationFor(p: any) {
  const label = METRIC_LABELS[p.metric].toLowerCase();
  if (p.direction === 'superior') {
    return `Repetir y explorar más videos con ${p.dimension_label.toLowerCase()} «${p.value}»: su valor mediano de ${label} es un ${Math.abs(p.lift_pct ?? 0).toFixed(0)} % superior al del resto de la cuenta. Conviene probarlo de forma controlada en el Laboratorio para separar su efecto de otros factores (tema, duración, día de publicación).`;
  }
  return `Revisar los videos con ${p.dimension_label.toLowerCase()} «${p.value}»: su valor mediano de ${label} es un ${Math.abs(p.lift_pct ?? 0).toFixed(0)} % inferior al del resto. Antes de abandonar el formato, compruébalo con un experimento que controle las demás variables.`;
}

/** Ejecuta el análisis, lo guarda en la memoria (analysis_runs, historical_patterns, recommendations) y devuelve el resumen. */
export async function runPatternAnalysis(db: Db) {
  const rows = await loadVideoRows(db, 'latest');
  const withData = rows.filter((r) => r.snapshot);
  const { tested, patterns } = detectPatterns(withData);
  const client = await db.connect();
  try {
    await client.query('begin');
    const run = (await client.query(
      `insert into analysis_runs (run_type, videos_considered, summary) values ('patrones', $1, $2) returning *`,
      [withData.length, JSON.stringify({ comparisons_tested: tested, patterns_found: patterns.length, min_group: MIN_GROUP })])).rows[0];
    const seen: string[] = [];
    let newRecs = 0;
    for (const p of patterns) {
      const r = (await client.query(
        `insert into historical_patterns (dimension, value, metric, direction, group_n, rest_n, group_median, rest_median, lift_pct, p_value, q_value, confidence, status, statement, last_run_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'activo',$13,$14)
         on conflict (dimension, value, metric) do update set direction=excluded.direction, group_n=excluded.group_n, rest_n=excluded.rest_n,
           group_median=excluded.group_median, rest_median=excluded.rest_median, lift_pct=excluded.lift_pct, p_value=excluded.p_value,
           q_value=excluded.q_value, confidence=excluded.confidence, status='activo', statement=excluded.statement,
           last_confirmed_at=now(), last_run_id=excluded.last_run_id
         returning id`,
        [p.dimension, p.value, p.metric, p.direction, p.group_n, p.rest_n, p.group_median, p.rest_median, p.lift_pct, p.p_value, p.q_value, p.confidence, p.statement, run.id])).rows[0];
      seen.push(r.id);
      const existing = await client.query(`select 1 from recommendations where pattern_id = $1 and status = 'pendiente'`, [r.id]);
      if (!existing.rowCount) {
        await client.query(
          `insert into recommendations (text, evidence, source, pattern_id) values ($1, $2, 'patrones', $3)`,
          [recommendationFor(p), JSON.stringify({ ...p, run_id: run.id }), r.id]);
        newRecs++;
      }
    }
    // Patrones anteriores que ya no se confirman con los datos actuales quedan marcados, no se borran.
    await client.query(`update historical_patterns set status = 'no_confirmado' where not (id = any($1::uuid[]))`, [seen]);
    await client.query(`update analysis_runs set summary = summary || $2 where id = $1`, [run.id, JSON.stringify({ new_recommendations: newRecs })]);
    await client.query('commit');
    return { run_id: run.id, videos_considered: withData.length, comparisons_tested: tested, patterns, new_recommendations: newRecs };
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

// ---------- Experimentos ----------

export async function evaluateExperiment(db: Db, experimentId: string, persist = true) {
  const exp = (await db.query('select * from content_experiments where id = $1', [experimentId])).rows[0];
  if (!exp) return null;
  const { rows: links } = await db.query('select * from experiment_videos where experiment_id = $1', [experimentId]);
  const rows = await loadVideoRows(db, 'latest');
  const byId = new Map(rows.map((r) => [r.id, r]));
  const arm = (a: string) => links.filter((l) => l.arm === a).map((l) => byId.get(l.video_id)).filter((x): x is VideoRow => !!x);
  const control = arm('control');
  const variant = arm('variante');
  const metric = exp.primary_metric;
  const cv = control.map((r) => metricValue(r, metric)).filter((x): x is number => x !== null);
  const vv = variant.map((r) => metricValue(r, metric)).filter((x): x is number => x !== null);
  const cm = median(cv);
  const vm = median(vv);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const test = cv.length >= 2 && vv.length >= 2 ? mannWhitney(cv, vv) : null;
  const diff = cm !== null && vm !== null && cm > 0 ? ((vm - cm) / cm) * 100 : null;

  // Factores no controlados: atributos que difieren entre brazos además de la variable probada.
  const confounders: { factor: string; control: string[]; variante: string[] }[] = [];
  for (const [key, d] of Object.entries(DIMENSIONS)) {
    if (key === 'weekday' || key === 'hour_bucket' || key === 'subcategory') continue;
    const a = [...new Set(control.map(d.get).filter(Boolean) as string[])];
    const b = [...new Set(variant.map(d.get).filter(Boolean) as string[])];
    if (!a.length || !b.length) continue;
    const same = a.length === b.length && a.every((x) => b.includes(x));
    if (!same) confounders.push({ factor: d.label, control: a, variante: b });
  }
  let suggested: 'respaldada' | 'no_respaldada' | 'no_concluyente' = 'no_concluyente';
  let reason = '';
  if (cv.length < 3 || vv.length < 3) reason = 'Muestra insuficiente: se necesitan al menos 3 videos con dato en cada grupo.';
  else if (!test) reason = 'No se pudo calcular la prueba estadística.';
  else if (test.p < 0.05 && vm! > cm!) { suggested = 'respaldada'; reason = 'La variante supera al control con significación estadística (p < 0,05).'; }
  else if (test.p < 0.05 && vm! < cm!) { suggested = 'no_respaldada'; reason = 'El control supera a la variante con significación estadística (p < 0,05).'; }
  else reason = 'La diferencia observada no es estadísticamente significativa con esta muestra.';
  if (confounders.length && suggested !== 'no_concluyente') reason += ' Atención: los grupos difieren en otros factores, así que el resultado no puede atribuirse solo a la variable probada.';

  const result = {
    metric, metric_label: METRIC_LABELS[metric] || metric,
    control_n: cv.length, variant_n: vv.length, control_total: control.length, variant_total: variant.length,
    control_median: cm, variant_median: vm, control_mean: mean(cv), variant_mean: mean(vv),
    diff_pct: diff, p_value: test?.p ?? null, suggested_verdict: suggested, reason, confounders,
    per_video: [...control.map((r) => ({ arm: 'control', id: r.id, title: r.title, value: metricValue(r, metric) })),
      ...variant.map((r) => ({ arm: 'variante', id: r.id, title: r.title, value: metricValue(r, metric) }))],
  };
  if (persist) {
    await db.query(
      `insert into experiment_results (experiment_id, metric, control_n, variant_n, control_median, variant_median, control_mean, variant_mean, diff_pct, p_value, suggested_verdict, details)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [experimentId, metric, cv.length, vv.length, cm, vm, result.control_mean, result.variant_mean, diff, result.p_value, suggested, JSON.stringify({ reason, confounders, per_video: result.per_video })]);
  }
  return result;
}

// ---------- Overview ----------

function sumField(rows: VideoRow[], f: string) {
  const vals = rows.map((r) => metricValue(r, f)).filter((x): x is number => x !== null);
  return { value: vals.length ? vals.reduce((a, b) => a + b, 0) : null, with_data: vals.length, total: rows.length };
}

async function accountBlock(db: Db, from: string, to: string) {
  const { rows } = await db.query(`select * from account_daily_metrics where date >= $1::date and date < $2::date order by date`, [from, to]);
  const latest = (await db.query(`select followers_count, date from account_daily_metrics where followers_count is not null and date < $1::date order by date desc limit 1`, [to])).rows[0];
  const before = (await db.query(`select followers_count from account_daily_metrics where followers_count is not null and date < $1::date order by date desc limit 1`, [from])).rows[0];
  const sum = (f: string) => {
    const v = rows.map((r) => r[f]).filter((x) => x !== null);
    return v.length ? v.reduce((a: number, b: number) => a + b, 0) : null;
  };
  let newFollowers = sum('new_followers');
  let newFollowersMethod: string | null = newFollowers !== null ? 'registrado' : null;
  const withFollowers = rows.filter((r) => r.followers_count !== null);
  const startFollowers = before?.followers_count ?? withFollowers[0]?.followers_count ?? null;
  const endFollowers = withFollowers.length ? withFollowers[withFollowers.length - 1].followers_count : null;
  if (newFollowers === null && startFollowers !== null && endFollowers !== null && (before || withFollowers.length >= 2)) {
    newFollowers = endFollowers - startFollowers;
    newFollowersMethod = 'diferencia de seguidores';
  }
  return {
    days_recorded: rows.length,
    followers_current: latest?.followers_count ?? null,
    followers_current_date: latest?.date ?? null,
    new_followers: newFollowers,
    new_followers_method: newFollowersMethod,
    growth_pct: newFollowers !== null && startFollowers ? (newFollowers / startFollowers) * 100 : null,
    reach: sum('reach'),
    impressions: sum('impressions'),
    views: sum('views'),
    profile_visits: sum('profile_visits'),
    series: rows.map((r) => ({ date: r.date, followers_count: r.followers_count, reach: r.reach, views: r.views })),
  };
}

function contentBlock(rows: VideoRow[]) {
  const fields = ['views', 'reach', 'impressions', 'likes', 'comments', 'shares', 'saves', 'profile_visits', 'follows', 'interactions'];
  const out: Record<string, any> = { posts: rows.length, posts_with_metrics: rows.filter((r) => r.snapshot).length };
  for (const f of fields) out[f] = sumField(rows, f);
  return out;
}

export async function overview(db: Db, from: string, to: string) {
  const fromD = new Date(from);
  const toD = new Date(to);
  const len = toD.getTime() - fromD.getTime();
  const prevFrom = new Date(fromD.getTime() - len).toISOString();
  const cur = await loadVideoRows(db, 'latest', { from: fromD.toISOString(), to: toD.toISOString() });
  const prev = await loadVideoRows(db, 'latest', { from: prevFrom, to: fromD.toISOString() });
  const totalPosts = (await db.query(`select count(*)::int as n from videos where status = 'publicado'`)).rows[0].n;
  const daily = new Map<string, { date: string; posts: number; views: number | null }>();
  for (const r of cur) {
    if (!r.published_at) continue;
    const d = new Date(r.published_at).toISOString().slice(0, 10);
    const e = daily.get(d) || { date: d, posts: 0, views: null };
    e.posts++;
    const v = metricValue(r, 'views');
    if (v !== null) e.views = (e.views ?? 0) + v;
    daily.set(d, e);
  }
  return {
    period: { from: fromD.toISOString(), to: toD.toISOString() },
    previous_period: { from: prevFrom, to: fromD.toISOString() },
    total_posts_all_time: totalPosts,
    account: await accountBlock(db, fromD.toISOString().slice(0, 10), toD.toISOString().slice(0, 10)),
    account_previous: await accountBlock(db, prevFrom.slice(0, 10), fromD.toISOString().slice(0, 10)),
    content: contentBlock(cur),
    content_previous: contentBlock(prev),
    content_series: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    top_followers: [...cur].filter((r) => metricValue(r, 'follows') !== null).sort((a, b) => metricValue(b, 'follows')! - metricValue(a, 'follows')!).slice(0, 5)
      .map((r) => ({ id: r.id, title: r.title, follows: metricValue(r, 'follows') })),
  };
}

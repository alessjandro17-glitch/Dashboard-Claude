// Métricas derivadas y estadística compartidas por el servidor y el cliente.
// Regla: si falta cualquier dato necesario, el resultado es null ("no registrado"), nunca 0 ni un valor inventado.

export type Num = number | null | undefined;

export interface SnapshotValues {
  views?: Num;
  reach?: Num;
  impressions?: Num;
  total_watch_time_seconds?: Num;
  avg_watch_time_seconds?: Num;
  likes?: Num;
  comments?: Num;
  shares?: Num;
  saves?: Num;
  profile_visits?: Num;
  follows?: Num;
}

export interface DerivedMetrics {
  interactions: number | null;
  engagement_rate: number | null;
  share_rate: number | null;
  save_rate: number | null;
  profile_visit_rate: number | null;
  follower_conversion_rate: number | null;
  avg_watch_time: number | null;
  avg_watch_time_is_computed: boolean;
  retention_approx: number | null;
}

const has = (v: Num): v is number => typeof v === 'number' && Number.isFinite(v);

export function ratio(num: Num, den: Num, scale = 100): number | null {
  if (!has(num) || !has(den) || den <= 0) return null;
  return (num / den) * scale;
}

export function interactions(s: SnapshotValues): number | null {
  const parts = [s.likes, s.comments, s.shares, s.saves];
  if (!parts.every(has)) return null;
  return (parts as number[]).reduce((a, b) => a + b, 0);
}

export function derive(s: SnapshotValues, durationSeconds: Num): DerivedMetrics {
  const inter = interactions(s);
  // Tiempo medio: se prefiere el valor reportado; si no existe se calcula tiempo total / reproducciones.
  let awt: number | null = has(s.avg_watch_time_seconds) ? s.avg_watch_time_seconds : null;
  let computed = false;
  if (awt === null) {
    awt = ratio(s.total_watch_time_seconds, s.views, 1);
    computed = awt !== null;
  }
  return {
    interactions: inter,
    engagement_rate: ratio(inter, s.reach),
    share_rate: ratio(s.shares, s.reach),
    save_rate: ratio(s.saves, s.reach),
    profile_visit_rate: ratio(s.profile_visits, s.reach),
    follower_conversion_rate: ratio(s.follows, s.profile_visits),
    avg_watch_time: awt,
    avg_watch_time_is_computed: computed,
    retention_approx: ratio(awt, durationSeconds),
  };
}

export const METRIC_LABELS: Record<string, string> = {
  views: 'Reproducciones',
  reach: 'Alcance',
  impressions: 'Impresiones',
  likes: 'Me gusta',
  comments: 'Comentarios',
  shares: 'Compartidos',
  saves: 'Guardados',
  profile_visits: 'Visitas al perfil',
  follows: 'Seguidores generados',
  total_watch_time_seconds: 'Tiempo total de reproducción (s)',
  avg_watch_time_seconds: 'Tiempo promedio de reproducción (s)',
  interactions: 'Interacciones',
  engagement_rate: 'Engagement rate (por alcance)',
  share_rate: 'Share rate',
  save_rate: 'Save rate',
  profile_visit_rate: 'Profile visit rate',
  follower_conversion_rate: 'Conversión a seguidores',
  avg_watch_time: 'Tiempo medio de reproducción (s)',
  retention_approx: 'Retención aproximada',
};

export const RATE_METRICS = new Set([
  'engagement_rate', 'share_rate', 'save_rate', 'profile_visit_rate', 'follower_conversion_rate', 'retention_approx',
]);

// ---------- Estadística ----------

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Desviación absoluta mediana escalada (estimador robusto de la desviación típica). */
export function mad(xs: number[]): number | null {
  const m = median(xs);
  if (m === null) return null;
  return 1.4826 * (median(xs.map((x) => Math.abs(x - m))) as number);
}

function normalCdf(z: number): number {
  // Aproximación de Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/**
 * Prueba U de Mann-Whitney bilateral con aproximación normal, corrección por empates y por continuidad.
 * No asume distribución normal: adecuada para métricas de redes sociales, muy asimétricas.
 */
export function mannWhitney(a: number[], b: number[]): { u: number; p: number } | null {
  const n1 = a.length;
  const n2 = b.length;
  if (n1 < 2 || n2 < 2) return null;
  const all = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))].sort((x, y) => x.v - y.v);
  const ranks = new Array(all.length);
  let tieTerm = 0;
  for (let i = 0; i < all.length;) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = r;
    const t = j - i + 1;
    tieTerm += t ** 3 - t;
    i = j + 1;
  }
  let r1 = 0;
  all.forEach((x, i) => { if (x.g === 0) r1 += ranks[i]; });
  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const mu = (n1 * n2) / 2;
  const n = n1 + n2;
  const sigma = Math.sqrt((n1 * n2 / 12) * ((n + 1) - tieTerm / (n * (n - 1))));
  if (sigma === 0) return { u: u1, p: 1 };
  const z = (Math.abs(u1 - mu) - 0.5) / sigma;
  const p = Math.min(1, 2 * (1 - normalCdf(Math.max(0, z))));
  return { u: u1, p };
}

/** Corrección de Benjamini-Hochberg para comparaciones múltiples. Devuelve q-valores en el mismo orden. */
export function benjaminiHochberg(ps: number[]): number[] {
  const m = ps.length;
  const idx = ps.map((p, i) => ({ p, i })).sort((x, y) => x.p - y.p);
  const q = new Array(m).fill(1);
  let prev = 1;
  for (let k = m - 1; k >= 0; k--) {
    const val = Math.min(prev, (idx[k].p * m) / (k + 1));
    q[idx[k].i] = val;
    prev = val;
  }
  return q;
}

export function durationBucket(d: Num): string | null {
  if (!has(d)) return null;
  if (d <= 15) return '≤15 s';
  if (d <= 30) return '16–30 s';
  if (d <= 45) return '31–45 s';
  if (d <= 60) return '46–60 s';
  if (d <= 90) return '61–90 s';
  return '>90 s';
}

import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './db.js';
import { audit } from './db.js';
import { HttpError } from './http.js';

/*
 * Integración oficial: Instagram API con inicio de sesión de Instagram (Business Login).
 * Host graph.instagram.com. Requiere una cuenta profesional (creador o empresa).
 * Permisos: instagram_business_basic + instagram_business_manage_insights.
 * Sin scraping: solo endpoints documentados por Meta.
 */
export const GRAPH = 'https://graph.instagram.com';
export const GRAPH_VERSION = 'v25.0';
export const SCOPES = ['instagram_business_basic', 'instagram_business_manage_insights'];
// Métricas de Reels documentadas. impressions/plays/video_views están obsoletas para Reels.
export const REEL_METRICS = ['views', 'reach', 'likes', 'comments', 'shares', 'saved', 'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time'];

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...a) => fetch(...a);
/** Solo para pruebas. */
export function setFetch(f: Fetch) { fetchImpl = f; }

export class GraphError extends Error {
  constructor(message: string, public status: number, public code?: number) { super(message); }
}

async function graph(pathname: string, params: Record<string, string>, opts: { method?: string; body?: URLSearchParams; base?: string } = {}) {
  const url = new URL(pathname.startsWith('http') ? pathname : `${opts.base ?? `${GRAPH}/${GRAPH_VERSION}`}${pathname}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetchImpl(url, { method: opts.method ?? 'GET', body: opts.body });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const err = data.error || {};
    throw new GraphError(err.message || data.error_message || `Instagram respondió ${res.status}`, res.status, err.code);
  }
  return data;
}

// --- Cifrado del token: AES-256-GCM. La clave no se guarda en la base de datos. ---
function key() {
  const secret = process.env.INTEGRATIONS_SECRET;
  if (secret) return crypto.createHash('sha256').update(secret).digest();
  const file = path.resolve(process.env.INTEGRATIONS_KEY_FILE || '.secrets/integrations.key');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  return crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').trim()).digest();
}
export function encrypt(text: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
export function decrypt(blob: string) {
  const [iv, tag, enc] = blob.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

const appConfigured = () => !!(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.META_REDIRECT_URI);

async function getRow(db: Db) {
  return (await db.query(`select * from integrations where provider='instagram'`)).rows[0] || null;
}
async function saveRow(db: Db, fields: { status?: string; config?: any; last_sync_at?: Date | null; last_error?: string | null }) {
  const cur = await getRow(db);
  const next = {
    status: fields.status ?? cur?.status ?? 'no_configurada',
    config: fields.config ?? cur?.config ?? {},
    last_sync_at: fields.last_sync_at !== undefined ? fields.last_sync_at : cur?.last_sync_at ?? null,
    last_error: fields.last_error !== undefined ? fields.last_error : cur?.last_error ?? null,
  };
  await db.query(
    `insert into integrations (provider, status, config, last_sync_at, last_error, updated_at) values ('instagram',$1,$2,$3,$4,now())
     on conflict (provider) do update set status=$1, config=$2, last_sync_at=$3, last_error=$4, updated_at=now()`,
    [next.status, next.config, next.last_sync_at, next.last_error]);
}

async function token(db: Db) {
  const row = await getRow(db);
  if (!row?.config?.token) throw new HttpError(409, 'Instagram no está conectado.');
  return { row, token: decrypt(row.config.token) };
}

/** Comprueba el token con /me y lo guarda cifrado. */
export async function storeToken(db: Db, accessToken: string, expiresIn: number | null, via: 'oauth' | 'manual') {
  const me = await graph('/me', { fields: 'user_id,username,account_type,followers_count,media_count', access_token: accessToken });
  if (me.account_type && !['BUSINESS', 'MEDIA_CREATOR', 'CREATOR'].includes(String(me.account_type).toUpperCase())) {
    throw new HttpError(400, `La cuenta @${me.username} no es profesional (tipo ${me.account_type}). Cámbiala a cuenta de creador o empresa en Instagram.`);
  }
  await saveRow(db, {
    status: 'conectada', last_error: null,
    config: {
      token: encrypt(accessToken), via,
      user_id: me.user_id ?? me.id, username: me.username, account_type: me.account_type ?? null,
      token_obtained_at: new Date().toISOString(),
      token_expires_at: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    },
  });
  await db.query(`update accounts set instagram_user_id = $1, updated_at = now() where instagram_user_id is null and handle = $2`, [String(me.user_id ?? me.id), me.username]).catch(() => {});
  await audit(db, 'integracion', 'instagram', 'editar', { username: me.username, via });
  return me;
}

/** Los tokens de larga duración duran 60 días; se renuevan si tienen más de 24 h. */
async function maybeRefresh(db: Db, row: any, tok: string) {
  const obtained = row.config.token_obtained_at ? new Date(row.config.token_obtained_at).getTime() : 0;
  if (Date.now() - obtained < 24 * 3600_000) return tok;
  try {
    const r = await graph('/refresh_access_token', { grant_type: 'ig_refresh_token', access_token: tok }, { base: GRAPH });
    await saveRow(db, { config: { ...row.config, token: encrypt(r.access_token), token_obtained_at: new Date().toISOString(), token_expires_at: r.expires_in ? new Date(Date.now() + r.expires_in * 1000).toISOString() : null } });
    return r.access_token as string;
  } catch {
    return tok; // si falla la renovación se sigue usando el token actual mientras sea válido
  }
}

/** Pide las métricas juntas; si Instagram rechaza alguna, las pide de una en una y omite las no disponibles. */
async function mediaInsights(mediaId: string, tok: string) {
  const out: Record<string, number> = {};
  const read = (data: any[]) => {
    for (const m of data || []) {
      const v = m.total_value?.value ?? m.values?.[0]?.value;
      if (typeof v === 'number') out[m.name] = v;
    }
  };
  try {
    read((await graph(`/${mediaId}/insights`, { metric: REEL_METRICS.join(','), access_token: tok })).data);
  } catch (e) {
    if (!(e instanceof GraphError) || e.status === 401 || e.code === 190) throw e;
    for (const metric of REEL_METRICS) {
      try { read((await graph(`/${mediaId}/insights`, { metric, access_token: tok })).data); } catch (e2) {
        if (e2 instanceof GraphError && (e2.status === 401 || e2.code === 190)) throw e2;
      }
    }
  }
  return out;
}

const firstLine = (caption: string | undefined) => {
  const line = (caption || '').split('\n').map((s) => s.trim()).find(Boolean) || '';
  return line.length > 90 ? `${line.slice(0, 87)}…` : line;
};

export interface SyncResult { media_seen: number; reels: number; videos_created: number; snapshots_created: number; unchanged: number; failed: { media_id: string; error: string }[]; followers_count: number | null }

/**
 * Sincroniza: crea los Reels que falten, guarda una medición nueva (fuente «instagram») por Reel
 * y los seguidores del día. Alcance, reproducciones, etc. se guardan tal cual los da Instagram;
 * impresiones, visitas al perfil y seguidores por Reel no los ofrece la API para Reels y quedan sin registrar.
 */
export async function syncInstagram(db: Db, opts: { maxAgeDays?: number | null; maxMedia?: number } = {}): Promise<SyncResult> {
  const { row, token: t0 } = await token(db);
  const tok = await maybeRefresh(db, row, t0);
  const result: SyncResult = { media_seen: 0, reels: 0, videos_created: 0, snapshots_created: 0, unchanged: 0, failed: [], followers_count: null };
  try {
    const me = await graph('/me', { fields: 'user_id,username,followers_count,media_count', access_token: tok });
    const account = (await db.query('select id from accounts order by created_at limit 1')).rows[0];
    if (typeof me.followers_count === 'number' && account) {
      result.followers_count = me.followers_count;
      await db.query(
        `insert into account_daily_metrics (account_id, date, followers_count, source) values ($1, current_date, $2, 'instagram')
         on conflict (account_id, date) do update set followers_count = excluded.followers_count, updated_at = now()`,
        [account.id, me.followers_count]);
    }
    const cutoff = opts.maxAgeDays ? Date.now() - opts.maxAgeDays * 86400_000 : null;
    const max = opts.maxMedia ?? 1000;
    let next: string | null = null;
    let page: any = await graph('/me/media', { fields: 'id,caption,media_type,media_product_type,permalink,timestamp,thumbnail_url', limit: '50', access_token: tok });
    const capturedAt = new Date();
    outer: while (page) {
      for (const m of page.data || []) {
        result.media_seen++;
        if (result.media_seen > max) break outer;
        if (cutoff && m.timestamp && new Date(m.timestamp).getTime() < cutoff) break outer; // la lista viene de más reciente a más antigua
        const isReel = m.media_product_type === 'REELS' || m.media_type === 'VIDEO';
        if (!isReel) continue;
        result.reels++;
        try {
          const video = await upsertVideo(db, m, account?.id);
          if (video.created) result.videos_created++;
          const ins = await mediaInsights(m.id, tok);
          const snap = {
            views: ins.views ?? null, reach: ins.reach ?? null, likes: ins.likes ?? null, comments: ins.comments ?? null,
            shares: ins.shares ?? null, saves: ins.saved ?? null,
            // Instagram devuelve los tiempos de reproducción en milisegundos.
            avg_watch_time_seconds: ins.ig_reels_avg_watch_time != null ? ins.ig_reels_avg_watch_time / 1000 : null,
            total_watch_time_seconds: ins.ig_reels_video_view_total_time != null ? ins.ig_reels_video_view_total_time / 1000 : null,
          };
          if (Object.values(snap).every((v) => v === null)) { result.failed.push({ media_id: m.id, error: 'Instagram no devolvió métricas para este Reel' }); continue; }
          const inserted = await insertSnapshot(db, video.id, snap, capturedAt);
          if (inserted) result.snapshots_created++; else result.unchanged++;
        } catch (e) {
          if (e instanceof GraphError && (e.status === 401 || e.code === 190)) throw e;
          result.failed.push({ media_id: m.id, error: (e as Error).message });
        }
      }
      next = page.paging?.next ?? null;
      page = next ? await graph(next, {}) : null;
    }
    await saveRow(db, { status: 'conectada', last_sync_at: new Date(), last_error: result.failed.length ? `${result.failed.length} Reels sin métricas en la última sincronización` : null });
    await audit(db, 'integracion', 'instagram', 'importar', result);
    return result;
  } catch (e) {
    const expired = e instanceof GraphError && (e.status === 401 || e.code === 190);
    await saveRow(db, { status: expired ? 'token_caducado' : 'error', last_error: (e as Error).message });
    throw new HttpError(502, expired ? 'El token de Instagram caducó o fue revocado. Vuelve a conectar la cuenta.' : `Error al sincronizar con Instagram: ${(e as Error).message}`);
  }
}

/** Busca el video por id de Instagram o por URL; si no existe, lo crea. Devuelve { id, created }. */
async function upsertVideo(db: Db, m: any, accountId: string): Promise<{ id: string; created: boolean }> {
  const found = (await db.query(
    `select id, instagram_media_id, published_at, thumbnail_url from videos where instagram_media_id = $1 or (instagram_url is not null and lower(rtrim(instagram_url,'/')) = lower(rtrim($2,'/'))) order by (instagram_media_id = $1) desc nulls last limit 1`,
    [m.id, m.permalink || ''])).rows[0];
  if (found) {
    await db.query(
      `update videos set instagram_media_id = coalesce(instagram_media_id, $2), published_at = coalesce(published_at, $3), thumbnail_url = coalesce(thumbnail_url, $4), updated_at = now() where id = $1`,
      [found.id, m.id, m.timestamp || null, m.thumbnail_url || null]);
    return { id: found.id as string, created: false };
  }
  const title = firstLine(m.caption) || `Reel ${m.timestamp ? new Date(m.timestamp).toISOString().slice(0, 10) : m.id}`;
  const { rows } = await db.query(
    `insert into videos (account_id, title, instagram_url, instagram_media_id, published_at, status, thumbnail_url, description)
     values ($1,$2,$3,$4,$5,'publicado',$6,$7) returning id`,
    [accountId, title, m.permalink || null, m.id, m.timestamp || null, m.thumbnail_url || null, m.caption || null]);
  await audit(db, 'video', rows[0].id, 'importar', { source: 'instagram', media_id: m.id });
  return { id: rows[0].id, created: true };
}

/** Inserta la medición salvo que sea idéntica a la última medición de Instagram de ese video. */
async function insertSnapshot(db: Db, videoId: string, snap: Record<string, number | null>, capturedAt: Date) {
  const keys = Object.keys(snap);
  const last = (await db.query(
    `select ${keys.join(', ')} from video_metrics_snapshots where video_id = $1 and source = 'instagram' order by captured_at desc limit 1`, [videoId])).rows[0];
  if (last && keys.every((k) => (last[k] === null ? null : Number(last[k])) === (snap[k] === null ? null : Number(snap[k])))) return false;
  const { rows } = await db.query(
    `insert into video_metrics_snapshots (video_id, captured_at, source, ${keys.join(', ')})
     values ($1, $2, 'instagram', ${keys.map((_, i) => `$${i + 3}`).join(', ')})
     on conflict (video_id, captured_at) do nothing returning id`,
    [videoId, capturedAt, ...keys.map((k) => snap[k])]);
  return rows.length > 0;
}

let syncing: Promise<SyncResult> | null = null;
/** Evita dos sincronizaciones a la vez. */
export function runSync(db: Db, opts: Parameters<typeof syncInstagram>[1] = {}) {
  if (!syncing) syncing = syncInstagram(db, opts).finally(() => { syncing = null; });
  return syncing;
}

/** Sincronización periódica de los Reels de los últimos 60 días mientras la cuenta esté conectada. */
export function startScheduler(db: Db) {
  const hours = Number(process.env.INSTAGRAM_SYNC_HOURS ?? 6);
  if (!hours || hours <= 0) return null;
  const tick = async () => {
    const row = await getRow(db).catch(() => null);
    if (row?.status !== 'conectada') return;
    await runSync(db, { maxAgeDays: 60 }).catch((e) => console.error('Sincronización de Instagram:', e.message));
  };
  const timer = setInterval(tick, hours * 3600_000);
  timer.unref();
  setTimeout(tick, 60_000).unref();
  return timer;
}

const publicStatus = (row: any) => ({
  app_configured: appConfigured(),
  status: row?.status ?? 'no_configurada',
  last_sync_at: row?.last_sync_at ?? null,
  last_error: row?.last_error ?? null,
  username: row?.config?.username ?? null,
  account_type: row?.config?.account_type ?? null,
  via: row?.config?.via ?? null,
  token_expires_at: row?.config?.token_expires_at ?? null,
  metrics: REEL_METRICS,
  sync_hours: Number(process.env.INSTAGRAM_SYNC_HOURS ?? 6),
});

export function instagramRouter(db: Db) {
  const router = Router();
  router.get('/status', async (_req, res) => { res.json(publicStatus(await getRow(db))); });

  // Opción A: token generado en el panel de Meta (Instagram > configuración de la API con inicio de sesión de Instagram).
  router.post('/token', async (req, res) => {
    const t = typeof req.body?.access_token === 'string' ? req.body.access_token.trim() : '';
    if (t.length < 20) throw new HttpError(400, 'Pega un token de acceso de Instagram válido.');
    try {
      await storeToken(db, t, null, 'manual');
    } catch (e) {
      if (e instanceof GraphError) throw new HttpError(400, `Instagram rechazó el token: ${e.message}`);
      throw e;
    }
    res.json(publicStatus(await getRow(db)));
  });

  // Opción B: OAuth completo (requiere META_APP_ID, META_APP_SECRET y META_REDIRECT_URI).
  router.get('/connect', (_req, res) => {
    if (!appConfigured()) throw new HttpError(503, 'Faltan META_APP_ID, META_APP_SECRET o META_REDIRECT_URI en el .env del servidor.');
    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('mca_ig_state', state, { httpOnly: true, sameSite: 'lax', maxAge: 15 * 60_000 });
    const u = new URL('https://www.instagram.com/oauth/authorize');
    u.searchParams.set('client_id', process.env.META_APP_ID!);
    u.searchParams.set('redirect_uri', process.env.META_REDIRECT_URI!);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', SCOPES.join(','));
    u.searchParams.set('state', state);
    res.redirect(u.toString());
  });
  router.get('/callback', async (req, res) => {
    const back = (q: string) => res.redirect(`${process.env.APP_URL || ''}/configuracion?tab=integraciones&instagram=${q}`);
    if (req.query.error) return back('cancelado');
    const code = String(req.query.code || '').replace(/#_$/, '');
    if (!code || !req.query.state || req.query.state !== req.cookies?.mca_ig_state) return back('estado_invalido');
    res.clearCookie('mca_ig_state');
    try {
      const body = new URLSearchParams({
        client_id: process.env.META_APP_ID!, client_secret: process.env.META_APP_SECRET!,
        grant_type: 'authorization_code', redirect_uri: process.env.META_REDIRECT_URI!, code,
      });
      const short = await graph('https://api.instagram.com/oauth/access_token', {}, { method: 'POST', body });
      const shortToken = short.access_token ?? short.data?.[0]?.access_token;
      const long = await graph('/access_token', { grant_type: 'ig_exchange_token', client_secret: process.env.META_APP_SECRET!, access_token: shortToken }, { base: GRAPH });
      await storeToken(db, long.access_token, long.expires_in ?? null, 'oauth');
      back('ok');
    } catch (e) {
      await saveRow(db, { status: 'error', last_error: (e as Error).message });
      back('error');
    }
  });

  router.post('/sync', async (req, res) => {
    const all = req.body?.all === true;
    res.json(await runSync(db, all ? {} : { maxAgeDays: 60 }));
  });
  router.post('/disconnect', async (_req, res) => {
    await saveRow(db, { status: 'no_configurada', config: {}, last_error: null, last_sync_at: null });
    await audit(db, 'integracion', 'instagram', 'eliminar');
    res.json(publicStatus(await getRow(db)));
  });
  return router;
}

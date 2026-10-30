// Fase 2: AI Advisor e Instagram. La API de Claude y la de Instagram se sustituyen por dobles de prueba;
// ninguna prueba sale a internet. Los datos existen solo en la base de pruebas.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createPool, migrate, ensureAccount, type Db } from '../server/db';
import { createApp } from '../server/app';
import { setFetch, encrypt, decrypt } from '../server/instagram';

const URL_DB = process.env.TEST_DATABASE_URL || 'postgres://mca:mca_dev@localhost:5432/mca_test';
process.env.INTEGRATIONS_KEY_FILE = path.join(os.tmpdir(), `mca-test-${process.pid}.key`);
let db: Db;
let server: Server;
let base = '';
const prompts: any[] = [];
let nextReply: any = null;

const fakeClaude = () => ({
  beta: {
    messages: {
      stream: (params: any) => {
        prompts.push(params);
        return { finalMessage: async () => nextReply ?? { model: params.model, stop_reason: 'end_turn', content: [{ type: 'text', text: '## Respuesta\nSegún tus datos, **prueba** un hook de pregunta.' }] } };
      },
    },
  },
}) as any;

async function call(method: string, p: string, body?: unknown) {
  const res = await fetch(base + p, { method, redirect: 'manual', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}

// Instagram simulado: dos Reels y una foto; un Reel rechaza la consulta conjunta de métricas.
const igCalls: string[] = [];
let tokenValid = true;
let views = 1000;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
function fakeInstagram(input: any): Promise<Response> {
  const u = new URL(String(input));
  igCalls.push(u.pathname + '?' + u.searchParams.get('metric'));
  if (!tokenValid) return Promise.resolve(json({ error: { message: 'Invalid OAuth access token', code: 190 } }, 400));
  if (u.pathname.endsWith('/me')) return Promise.resolve(json({ user_id: '178', username: 'mundo.curioso13', account_type: 'MEDIA_CREATOR', followers_count: 1520 }));
  if (u.pathname.endsWith('/me/media')) return Promise.resolve(json({ data: [
    { id: 'm1', caption: 'Por qué el cielo es azul\n#ciencia', media_type: 'VIDEO', media_product_type: 'REELS', permalink: 'https://www.instagram.com/reel/AAA/', timestamp: '2026-10-20T18:00:00+0000' },
    { id: 'm2', caption: 'Foto', media_type: 'IMAGE', media_product_type: 'FEED', permalink: 'https://www.instagram.com/p/BBB/', timestamp: '2026-10-19T18:00:00+0000' },
    { id: 'm3', caption: '', media_type: 'VIDEO', media_product_type: 'REELS', permalink: 'https://www.instagram.com/reel/CCC/', timestamp: '2026-10-18T18:00:00+0000' },
  ] }));
  if (u.pathname.endsWith('/m1/insights')) {
    return Promise.resolve(json({ data: [
      { name: 'views', values: [{ value: views }] }, { name: 'reach', values: [{ value: 800 }] }, { name: 'likes', values: [{ value: 90 }] },
      { name: 'comments', values: [{ value: 4 }] }, { name: 'shares', values: [{ value: 12 }] }, { name: 'saved', values: [{ value: 30 }] },
      { name: 'ig_reels_avg_watch_time', values: [{ value: 12500 }] }, { name: 'ig_reels_video_view_total_time', values: [{ value: 12500000 }] },
    ] }));
  }
  if (u.pathname.endsWith('/m3/insights')) {
    const m = u.searchParams.get('metric')!;
    if (m.includes(',')) return Promise.resolve(json({ error: { message: 'metric not supported', code: 100 } }, 400));
    if (m === 'reach') return Promise.resolve(json({ data: [{ name: 'reach', values: [{ value: 300 }] }] }));
    return Promise.resolve(json({ error: { message: 'not available', code: 100 } }, 400));
  }
  return Promise.resolve(json({ error: { message: 'unexpected ' + u.pathname } }, 404));
}

beforeAll(async () => {
  const admin = createPool(URL_DB);
  await admin.query('drop schema public cascade; create schema public;');
  await admin.end();
  db = createPool(URL_DB);
  await migrate(db);
  await ensureAccount(db);
  server = createApp(db, { advisorClient: fakeClaude }).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  setFetch(fakeInstagram as any);
});
afterAll(async () => { await new Promise((r) => server.close(r)); await db.end(); });

describe('AI Advisor', () => {
  it('sin clave responde 503 y no llama al modelo', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await call('POST', '/api/advisor/ask', { question: '¿Qué publico?' });
    expect(r.status).toBe(503);
    expect(prompts).toHaveLength(0);
  });
  it('valida la entrada', async () => {
    process.env.ANTHROPIC_API_KEY = 'test';
    expect((await call('POST', '/api/advisor/ask', { question: '' })).status).toBe(400);
    expect((await call('POST', '/api/advisor/script', { topic: 'x' })).status).toBe(400);
  });
  it('responde con los datos guardados y guarda la respuesta', async () => {
    const v = await call('POST', '/api/videos', { title: 'Agujeros negros', published_at: '2026-10-01T18:00:00Z', duration_seconds: 30 });
    await call('POST', `/api/videos/${v.body.id}/snapshots`, { captured_at: '2026-10-02T18:00:00Z', views: 5000, reach: 4000 });
    const r = await call('POST', '/api/advisor/ask', { question: '¿Qué tipo de video debería producir esta semana?' });
    expect(r.status).toBe(201);
    expect(r.body.kind).toBe('pregunta');
    expect(r.body.answer).toContain('hook de pregunta');
    expect(r.body.context_summary.videos_con_metricas).toBe(1);
    const p = prompts.at(-1);
    expect(p.model).toBe('claude-opus-5-5');
    expect(p.fallbacks).toBe('default');
    expect(p.betas).toContain('server-side-fallback-2026-07-01');
    expect(p.output_config.effort).toBe('medium');
    expect(p.thinking).toBeUndefined();
    expect(p.system).toContain('No inventes');
    const content = p.messages[0].content as string;
    expect(content).toContain('Agujeros negros');
    expect(content).toContain('"views":5000');
    const h = await call('GET', '/api/advisor/history');
    expect(h.body).toHaveLength(1);
  });
  it('genera ideas y guiones con sus instrucciones', async () => {
    expect((await call('POST', '/api/advisor/ideas', { count: 3, focus: 'física' })).status).toBe(201);
    expect(prompts.at(-1).messages[0].content).toContain('Propón 3 ideas');
    expect((await call('POST', '/api/advisor/script', { topic: 'Por qué el cielo es azul', duration_seconds: 40 })).status).toBe(201);
    expect(prompts.at(-1).messages[0].content).toContain('unos 40 segundos');
    expect((await call('GET', '/api/advisor/history?kind=guion')).body).toHaveLength(1);
  });
  it('una negativa del modelo no se guarda como respuesta', async () => {
    nextReply = { model: 'claude-opus-5-5', stop_reason: 'refusal', content: [] };
    const before = (await call('GET', '/api/advisor/history')).body.length;
    const r = await call('POST', '/api/advisor/ask', { question: 'Pregunta cualquiera' });
    nextReply = null;
    expect(r.status).toBe(422);
    expect((await call('GET', '/api/advisor/history')).body.length).toBe(before);
  });
  it('borra respuestas del historial', async () => {
    const h = (await call('GET', '/api/advisor/history')).body;
    expect((await call('DELETE', `/api/advisor/history/${h[0].id}`)).status).toBe(204);
    expect((await call('GET', '/api/advisor/history')).body.length).toBe(h.length - 1);
  });
});

describe('Instagram', () => {
  it('cifra el token de forma reversible', () => {
    const e = encrypt('IGAAsecreto');
    expect(e).not.toContain('IGAAsecreto');
    expect(decrypt(e)).toBe('IGAAsecreto');
  });
  it('sin conectar, el estado es «no_configurada» y sincronizar da 409', async () => {
    const s = await call('GET', '/api/instagram/status');
    expect(s.body.status).toBe('no_configurada');
    expect((await call('POST', '/api/instagram/sync')).status).toBe(409);
  });
  it('OAuth sin credenciales de la app responde 503', async () => {
    expect((await call('GET', '/api/instagram/connect')).status).toBe(503);
  });
  it('conecta con un token y no lo guarda en claro', async () => {
    const r = await call('POST', '/api/instagram/token', { access_token: 'IGAA' + 'x'.repeat(40) });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('conectada');
    expect(r.body.username).toBe('mundo.curioso13');
    expect(JSON.stringify(r.body)).not.toContain('IGAAxxxx');
    const row = (await db.query(`select config from integrations where provider='instagram'`)).rows[0];
    expect(JSON.stringify(row.config)).not.toContain('IGAAxxxx');
  });
  it('sincroniza Reels, crea videos y mediciones con fuente instagram', async () => {
    // Un video ya registrado a mano con la misma URL debe reutilizarse, no duplicarse.
    const manual = await call('POST', '/api/videos', { title: 'Cielo azul (manual)', instagram_url: 'https://www.instagram.com/reel/AAA' });
    const r = await call('POST', '/api/instagram/sync', { all: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ reels: 2, videos_created: 1, snapshots_created: 2, followers_count: 1520 });
    const v1 = (await call('GET', `/api/videos/${manual.body.id}`)).body;
    expect(v1.instagram_media_id).toBe('m1');
    const s = v1.snapshots[0];
    expect(s.source).toBe('instagram');
    expect(s).toMatchObject({ views: 1000, reach: 800, saves: 30, shares: 12, avg_watch_time_seconds: 12.5, total_watch_time_seconds: 12500 });
    expect(s.impressions).toBeNull();
    expect(s.profile_visits).toBeNull();
    const created = (await db.query(`select id, title from videos where instagram_media_id='m3'`)).rows[0];
    expect(created.title).toMatch(/^Reel 2026-10-18/);
    const s3 = (await db.query(`select reach, views from video_metrics_snapshots where video_id=$1`, [created.id])).rows[0];
    expect(s3).toEqual({ reach: 300, views: null });
    const acc = (await db.query(`select followers_count, source from account_daily_metrics`)).rows[0];
    expect(acc.followers_count).toBe(1520);
    expect(igCalls.some((c) => c.includes('/m2/'))).toBe(false); // las fotos no se consultan
  });
  it('no duplica mediciones idénticas y guarda una nueva cuando cambian', async () => {
    const r1 = await call('POST', '/api/instagram/sync', { all: true });
    expect(r1.body).toMatchObject({ videos_created: 0, snapshots_created: 0, unchanged: 2 });
    views = 1500;
    const r2 = await call('POST', '/api/instagram/sync', { all: true });
    expect(r2.body).toMatchObject({ snapshots_created: 1, unchanged: 1 });
  });
  it('un token caducado marca la integración y lo explica', async () => {
    tokenValid = false;
    const r = await call('POST', '/api/instagram/sync');
    expect(r.status).toBe(502);
    expect(r.body.error).toContain('caducó');
    expect((await call('GET', '/api/instagram/status')).body.status).toBe('token_caducado');
    tokenValid = true;
  });
  it('desconectar borra el token y conserva las mediciones', async () => {
    const r = await call('POST', '/api/instagram/disconnect');
    expect(r.body.status).toBe('no_configurada');
    const row = (await db.query(`select config from integrations where provider='instagram'`)).rows[0];
    expect(row.config).toEqual({});
    expect(Number((await db.query(`select count(*) from video_metrics_snapshots where source='instagram'`)).rows[0].count)).toBe(3);
  });
});

// Pruebas de integración contra una base de datos PostgreSQL de pruebas (TEST_DATABASE_URL).
// Los registros que se crean aquí existen solo en esa base de pruebas y se borran al empezar.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createPool, migrate, ensureAccount, type Db } from '../server/db';
import { createApp } from '../server/app';

const URL_DB = process.env.TEST_DATABASE_URL || 'postgres://mca:mca_dev@localhost:5432/mca_test';
let db: Db;
let server: Server;
let base = '';

async function start() {
  db = createPool(URL_DB);
  await migrate(db);
  await ensureAccount(db);
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function stop() {
  await new Promise((r) => server.close(r));
  await db.end();
}
async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
}

beforeAll(async () => {
  const admin = createPool(URL_DB);
  await admin.query('drop schema public cascade; create schema public;');
  await admin.end();
  await start();
});
afterAll(stop);

describe('flujo completo', () => {
  let catId = '';
  let videoId = '';
  let snapId = '';

  it('arranca vacío: sin datos ficticios', async () => {
    const m = await call('GET', '/api/memory');
    expect(m.body.counts.videos).toBe(0);
    expect(m.body.counts.snapshots).toBe(0);
    expect(m.body.counts.account_days).toBe(0);
    const cats = await call('GET', '/api/categories');
    expect(cats.body).toEqual([]);
  });

  it('crea categorías y valida', async () => {
    const r = await call('POST', '/api/categories', { name: 'Ciencia' });
    expect(r.status).toBe(201);
    catId = r.body.id;
    expect((await call('POST', '/api/categories', { name: 'ciencia' })).status).toBe(409);
    expect((await call('POST', '/api/categories', { name: '' })).status).toBe(400);
    const sub = await call('POST', '/api/categories', { name: 'Astronomía', parent_id: catId });
    expect(sub.status).toBe(201);
  });

  it('crea, valida y edita un video con atributos creativos', async () => {
    expect((await call('POST', '/api/videos', { title: '' })).status).toBe(400);
    expect((await call('POST', '/api/videos', { title: 'X', instagram_url: 'https://example.com/a' })).status).toBe(400);
    const r = await call('POST', '/api/videos', {
      title: 'Agujeros negros', instagram_url: 'https://www.instagram.com/reel/ABC/', published_at: '2026-10-01T18:00:00Z', duration_seconds: 30,
      category_id: catId, creative: { hook_type: 'Pregunta', uses_code_art: true, dimension: '3D', production_complexity: 4 },
    });
    expect(r.status).toBe(201);
    videoId = r.body.id;
    expect((await call('POST', '/api/videos', { title: 'Copia', instagram_url: 'https://www.instagram.com/reel/abc/' })).status).toBe(409);
    const e = await call('PUT', `/api/videos/${videoId}`, { title: 'Agujeros negros explicados', instagram_url: 'https://www.instagram.com/reel/ABC/', published_at: '2026-10-01T18:00:00Z', duration_seconds: 30, category_id: catId, status: 'publicado', creative: { hook_type: 'Pregunta', uses_code_art: true, dimension: '3D', narrative_pace: 'Rápida' } });
    expect(e.status).toBe(200);
    const d = await call('GET', `/api/videos/${videoId}`);
    expect(d.body.title).toBe('Agujeros negros explicados');
    expect(d.body.creative.narrative_pace).toBe('Rápida');
    expect(d.body.creative.production_complexity).toBe(4);
    expect(d.body.history.length).toBeGreaterThanOrEqual(2);
  });

  it('guarda varias mediciones con fecha y hora y calcula métricas', async () => {
    const s1 = await call('POST', `/api/videos/${videoId}/snapshots`, { captured_at: '2026-10-01T19:00:00Z', views: 500, reach: 400 });
    expect(s1.status).toBe(201);
    snapId = s1.body.id;
    const s2 = await call('POST', `/api/videos/${videoId}/snapshots`, { captured_at: '2026-10-02T18:00:00Z', views: 5000, reach: 4000, likes: 300, comments: 20, shares: 60, saves: 120, profile_visits: 80, follows: 20, avg_watch_time_seconds: 18 });
    expect(s2.status).toBe(201);
    expect((await call('POST', `/api/videos/${videoId}/snapshots`, { captured_at: '2026-10-02T18:00:00Z', views: 1 })).status).toBe(409);
    expect((await call('POST', `/api/videos/${videoId}/snapshots`, { captured_at: '2026-10-03T18:00:00Z' })).status).toBe(400);
    expect((await call('POST', `/api/videos/${videoId}/snapshots`, { captured_at: '2026-10-03T18:00:00Z', views: -5 })).status).toBe(400);
    const d = await call('GET', `/api/videos/${videoId}`);
    expect(d.body.snapshots).toHaveLength(2);
    expect(d.body.snapshots[0].hours_since_publish).toBeCloseTo(1);
    expect(d.body.snapshots[1].hours_since_publish).toBeCloseTo(24);
    const last = d.body.snapshots[1].derived;
    expect(last.interactions).toBe(500);
    expect(last.engagement_rate).toBeCloseTo(12.5);
    expect(last.share_rate).toBeCloseTo(1.5);
    expect(last.save_rate).toBeCloseTo(3);
    expect(last.profile_visit_rate).toBeCloseTo(2);
    expect(last.follower_conversion_rate).toBeCloseTo(25);
    expect(last.retention_approx).toBeCloseTo(60);
    expect(d.body.snapshots[0].derived.engagement_rate).toBeNull();
  });

  it('edita y elimina una medición', async () => {
    const r = await call('PUT', `/api/snapshots/${snapId}`, { captured_at: '2026-10-01T19:00:00Z', views: 600, reach: 450 });
    expect(r.status).toBe(200);
    expect(r.body.views).toBe(600);
    expect((await call('DELETE', `/api/snapshots/${snapId}`)).status).toBe(204);
    expect((await call('GET', `/api/videos/${videoId}`)).body.snapshots).toHaveLength(1);
  });

  it('los datos persisten tras reiniciar el servidor y la conexión', async () => {
    await stop();
    await start();
    const d = await call('GET', `/api/videos/${videoId}`);
    expect(d.status).toBe(200);
    expect(d.body.title).toBe('Agujeros negros explicados');
    expect(d.body.snapshots).toHaveLength(1);
  });

  it('elige la medición más cercana a 24 h para comparar', async () => {
    const r = await call('GET', '/api/analytics/videos?basis=24h');
    expect(r.body.find((v: any) => v.id === videoId).snapshot.views).toBe(5000);
    const r7 = await call('GET', '/api/analytics/videos?basis=7d');
    expect(r7.body.find((v: any) => v.id === videoId).snapshot).toBeNull();
  });

  it('elimina un video con sus mediciones', async () => {
    const tmp = await call('POST', '/api/videos', { title: 'Temporal' });
    await call('POST', `/api/videos/${tmp.body.id}/snapshots`, { captured_at: '2026-10-05T10:00:00Z', views: 10 });
    expect((await call('DELETE', `/api/videos/${tmp.body.id}`)).status).toBe(204);
    expect((await call('GET', `/api/videos/${tmp.body.id}`)).status).toBe(404);
    const left = await db.query('select count(*)::int n from video_metrics_snapshots where video_id=$1', [tmp.body.id]);
    expect(left.rows[0].n).toBe(0);
  });
});

describe('importación CSV', () => {
  const rows = [
    { title: 'Agujeros negros explicados', instagram_url: 'https://www.instagram.com/reel/ABC', published_at: '01/10/2026 18:00', captured_at: '08/10/2026 18:00', views: '9.100', reach: '7.000', likes: '500', comments: '30', shares: '90', saves: '200' },
    { title: 'El pulpo y sus tres corazones', instagram_url: 'https://www.instagram.com/reel/P1/', published_at: '2026-10-04 12:00', duration_seconds: '0:42', category: 'Biología', hook_type: 'Dato sorprendente', uses_code_art: 'sí', captured_at: '2026-10-05 12:00', views: '3400', reach: '2,900', likes: '210', comments: '12', shares: '40', saves: '33' },
    { title: 'El pulpo y sus tres corazones', instagram_url: 'https://www.instagram.com/reel/P1/', published_at: '2026-10-04 12:00', captured_at: '2026-10-11 12:00', views: '6100', reach: '5000' },
    { title: 'Sin fecha de medición', published_at: '2026-10-06 12:00', views: '100' },
    { title: 'Fecha imposible', published_at: '31/02/2026' },
    { title: '', views: '5' },
  ];
  it('vista previa: reconoce duplicados, mediciones adicionales y errores', async () => {
    const r = await call('POST', '/api/import/videos/preview', { rows, tz_offset_minutes: 0 });
    expect(r.status).toBe(200);
    const st = r.body.rows.map((x: any) => x.status);
    expect(st).toEqual(['duplicado', 'nuevo', 'duplicado_en_archivo', 'error', 'error', 'error']);
    expect(r.body.rows[1].normalized.video.duration_seconds).toBe(42);
    expect(r.body.rows[1].normalized.snapshot.reach).toBe(2900);
    expect(r.body.rows[3].errors.join(' ')).toMatch(/fecha y hora de la medición/);
  });
  it('la vista previa no guarda nada', async () => {
    const n = await db.query('select count(*)::int n from videos');
    expect(n.rows[0].n).toBe(1);
  });
  it('confirma: crea, añade mediciones y omite errores', async () => {
    const r = await call('POST', '/api/import/videos/commit', { rows, tz_offset_minutes: 0, duplicate_mode: 'skip' });
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(1);
    expect(r.body.skipped).toBe(1);
    expect(r.body.snapshots_added).toBe(3);
    expect(r.body.errors).toHaveLength(3);
    expect(r.body.categories_created).toBe(1);
    const again = await call('POST', '/api/import/videos/commit', { rows, tz_offset_minutes: 0 });
    expect(again.body.created).toBe(0);
    expect(again.body.snapshots_added).toBe(0);
    expect(again.body.snapshots_skipped).toBe(3);
    const vids = await call('GET', '/api/videos?q=pulpo');
    expect(vids.body).toHaveLength(1);
    expect(vids.body[0].snapshot_count).toBe(2);
  });
  it('importa métricas de cuenta con duplicados', async () => {
    const acc = [{ date: '2026-10-01', followers_count: '1.000', reach: '5000' }, { date: '2026-10-15', followers_count: '1.150' }, { date: '2026-10-15', followers_count: '1' }, { date: 'ayer' }];
    const p = await call('POST', '/api/import/account/preview', { rows: acc });
    expect(p.body.rows.map((x: any) => x.status)).toEqual(['nuevo', 'nuevo', 'error', 'error']);
    const c = await call('POST', '/api/import/account/commit', { rows: acc });
    expect(c.body.created).toBe(2);
    const c2 = await call('POST', '/api/import/account/commit', { rows: acc.slice(0, 1) });
    expect(c2.body.skipped).toBe(1);
  });
});

describe('analítica', () => {
  it('overview: periodo, comparación y "no registrado"', async () => {
    const r = await call('GET', '/api/analytics/overview?from=2026-10-01T00:00:00Z&to=2026-10-31T00:00:00Z');
    expect(r.status).toBe(200);
    expect(r.body.content.posts).toBe(2);
    expect(r.body.content.views.value).toBe(9100 + 6100);
    // La medición más reciente (importada por CSV) no trae visitas al perfil: se muestra como no registrado.
    expect(r.body.content.profile_visits.value).toBeNull();
    expect(r.body.content.profile_visits.with_data).toBe(0);
    expect(r.body.account.followers_current).toBe(1150);
    expect(r.body.account.new_followers).toBe(150);
    expect(r.body.account.growth_pct).toBeCloseTo(15);
    expect(r.body.account.impressions).toBeNull();
    expect(r.body.content_previous.posts).toBe(0);
    expect((await call('GET', '/api/analytics/overview?from=2026-10-10&to=2026-10-01')).status).toBe(400);
    const narrow = await call('GET', '/api/analytics/overview?from=2026-10-03T00:00:00Z&to=2026-10-10T00:00:00Z');
    expect(narrow.body.content.posts).toBe(1);
  });

  it('ranking: sin clasificar con muestra pequeña', async () => {
    const r = await call('GET', '/api/analytics/ranking?metric=views');
    expect(r.body.enough_data).toBe(false);
    expect(r.body.items[0].value).toBe(9100);
    expect(r.body.items[0].tier).toBeNull();
  });

  it('detecta patrones solo con muestra suficiente y los guarda en memoria', async () => {
    const before = await call('POST', '/api/analytics/patterns/run');
    expect(before.body.patterns).toHaveLength(0);
    // 12 videos: 6 con hook "Pregunta" y share rate alto, 6 con hook "Narración" y share rate bajo.
    for (let i = 0; i < 12; i++) {
      const q = i < 6;
      const v = await call('POST', '/api/videos', { title: `Prueba ${i}`, published_at: `2026-09-${String(i + 1).padStart(2, '0')}T12:00:00Z`, duration_seconds: q ? 25 : 45, creative: { hook_type: q ? 'Pregunta' : 'Narración' } });
      await call('POST', `/api/videos/${v.body.id}/snapshots`, { captured_at: `2026-09-${String(i + 8).padStart(2, '0')}T12:00:00Z`, reach: 1000 + i * 10, views: 1500 + i * 10, likes: 50, comments: 5, shares: q ? 40 + i : 5 + i, saves: 10, avg_watch_time_seconds: q ? 20 : 15 });
    }
    const run = await call('POST', '/api/analytics/patterns/run');
    expect(run.status).toBe(200);
    const shareP = run.body.patterns.find((p: any) => p.dimension === 'hook_type' && p.value === 'Pregunta' && p.metric === 'share_rate');
    expect(shareP).toBeTruthy();
    expect(shareP.direction).toBe('superior');
    expect(shareP.group_n).toBe(7); // 6 de prueba + «Agujeros negros», que también usa hook de pregunta
    expect(shareP.statement).toMatch(/no prueba que esa característica cause/);
    const mem = await call('GET', '/api/memory');
    expect(mem.body.runs.length).toBe(2);
    expect(mem.body.patterns.length).toBeGreaterThan(0);
    const recs = mem.body.recommendations.filter((r: any) => r.source === 'patrones');
    expect(recs.length).toBe(run.body.new_recommendations);
    expect(recs[0].evidence.group_n).toBeGreaterThanOrEqual(5);
    const again = await call('POST', '/api/analytics/patterns/run');
    expect(again.body.new_recommendations).toBe(0);
  });

  it('ranking clasifica en niveles con historial suficiente', async () => {
    const r = await call('GET', '/api/analytics/ranking?metric=shares');
    expect(r.body.enough_data).toBe(true);
    expect(r.body.items.every((i: any) => i.tier)).toBe(true);
    const sorted = r.body.items.map((i: any) => i.value);
    expect(sorted).toEqual([...sorted].sort((a: number, b: number) => b - a));
  });

  it('agrupaciones, inteligencia y curvas', async () => {
    const g = await call('GET', '/api/analytics/groups?dimension=hook_type');
    const preg = g.body.groups.find((x: any) => x.value === 'Pregunta');
    expect(preg.stats.share_rate.enough).toBe(true);
    expect(preg.stats.share_rate.p_value).toBeLessThan(0.05);
    expect((await call('GET', '/api/analytics/groups?dimension=nope')).status).toBe(400);
    const intel = await call('GET', '/api/analytics/intelligence');
    expect(intel.status).toBe(200);
    expect(intel.body.answers.find((a: any) => a.key === 'hooks').best.value).toBe('Pregunta');
    const curves = await call('GET', '/api/analytics/curves?metric=views');
    expect(curves.body.find((c: any) => c.title === 'El pulpo y sus tres corazones').points).toHaveLength(2);
  });

  it('experimentos: evalúa, advierte factores no controlados y guarda la conclusión', async () => {
    const vids = (await call('GET', '/api/videos?q=Prueba')).body;
    const ctrl = vids.filter((v: any) => Number(v.title.split(' ')[1]) >= 6).map((v: any) => ({ video_id: v.id, arm: 'control' }));
    const vari = vids.filter((v: any) => Number(v.title.split(' ')[1]) < 6).map((v: any) => ({ video_id: v.id, arm: 'variante' }));
    const e = await call('POST', '/api/experiments', { title: 'Hook pregunta', hypothesis: 'Los hooks de pregunta aumentan los compartidos', variable: 'hook', primary_metric: 'share_rate', videos: [...ctrl, ...vari] });
    expect(e.status).toBe(201);
    const ev = await call('POST', `/api/experiments/${e.body.id}/evaluate`);
    expect(ev.body.control_n).toBe(6);
    expect(ev.body.suggested_verdict).toBe('respaldada');
    expect(ev.body.confounders.map((c: any) => c.factor)).toContain('Duración');
    expect(ev.body.reason).toMatch(/no puede atribuirse solo/);
    const done = await call('PUT', `/api/experiments/${e.body.id}`, { title: 'Hook pregunta', hypothesis: 'Los hooks de pregunta aumentan los compartidos', variable: 'hook', primary_metric: 'share_rate', status: 'concluido', verdict: 'no_concluyente', conclusion: 'La duración también cambió; repetir con duración fija.', videos: [...ctrl, ...vari] });
    expect(done.body.concluded_at).toBeTruthy();
    const detail = await call('GET', `/api/experiments/${e.body.id}`);
    expect(detail.body.results).toHaveLength(1);
    expect(detail.body.videos).toHaveLength(12);
    const mem = await call('GET', '/api/memory');
    expect(mem.body.experiments).toHaveLength(1);
    expect(mem.body.recommendations.some((r: any) => r.source === 'experimento')).toBe(true);
  });

  it('decisiones y estados de recomendaciones', async () => {
    const recs = (await call('GET', '/api/recommendations')).body;
    const p = await call('PATCH', `/api/recommendations/${recs[0].id}`, { status: 'aceptada' });
    expect(p.body.status).toBe('aceptada');
    const d = await call('POST', '/api/decisions', { title: 'Usar hooks de pregunta', recommendation_id: recs[0].id });
    expect(d.status).toBe(201);
    expect((await call('PUT', `/api/decisions/${d.body.id}`, { title: 'Usar hooks de pregunta', outcome: 'Pendiente de medir' })).body.outcome).toBe('Pendiente de medir');
    expect((await call('DELETE', `/api/decisions/${d.body.id}`)).status).toBe(204);
  });

  it('exporta copia de seguridad y CSV', async () => {
    const b = await call('GET', '/api/export/backup.json');
    expect(b.body.tables.videos.length).toBe(14);
    const res = await fetch(`${base}/api/export/videos.csv`);
    const text = await res.text();
    expect(text.split('\n')[0]).toContain('title');
    expect(text.split('\n')).toHaveLength(15);
    expect((await call('GET', '/api/export/pg_user.csv')).status).toBe(404);
  });

  it('el asesor no simula respuestas sin configuración', async () => {
    const r = await call('POST', '/api/advisor/ask', { question: '¿Qué hago?' });
    expect(r.status).toBe(503);
  });
});

describe('autenticación', () => {
  it('protege la API cuando se define APP_PASSWORD', async () => {
    process.env.APP_PASSWORD = 'secreto-de-prueba';
    const app = createApp(db).listen(0);
    const b = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
    try {
      expect((await fetch(`${b}/api/videos`)).status).toBe(401);
      expect((await fetch(`${b}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'mala' }) })).status).toBe(401);
      const ok = await fetch(`${b}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'secreto-de-prueba' }) });
      const cookie = ok.headers.get('set-cookie')!.split(';')[0];
      expect((await fetch(`${b}/api/videos`, { headers: { cookie } })).status).toBe(200);
    } finally {
      delete process.env.APP_PASSWORD;
      await new Promise((r) => app.close(r));
    }
  });
});

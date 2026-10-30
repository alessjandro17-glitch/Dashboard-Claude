import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Db } from './db.js';
import { HttpError, parse } from './http.js';
import { loadVideoRows, buildRanking } from './analytics.js';

export const ADVISOR_MODEL = 'claude-opus-5-5';

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

const round = (v: number | null | undefined, d = 4) => (v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d);
const compact = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ''));

/** Todo lo que el modelo recibe: videos con atributos y última medición, patrones, experimentos, decisiones y métricas de cuenta. */
export async function advisorDataset(db: Db) {
  const rows = await loadVideoRows(db, 'latest');
  const ranking = buildRanking(rows.filter((r) => r.snapshot), 'score');
  const tierOf = new Map(ranking.items.map((i) => [i.id, { tier: i.tier, score: round(i.score, 2) }]));
  const [patterns, experiments, recs, decisions, account, ideas] = await Promise.all([
    db.query(`select statement, confidence, dimension, value, metric, direction, lift_pct, group_n, rest_n from historical_patterns where status='activo' order by q_value nulls last limit 60`),
    db.query(`select title, hypothesis, variable, status, verdict, conclusion from content_experiments order by created_at desc limit 30`),
    db.query(`select text, status, source from recommendations order by created_at desc limit 30`),
    db.query(`select title, description, decided_at, outcome from decisions order by decided_at desc limit 20`),
    db.query(`select date, followers_count, new_followers, reach, views, profile_visits from account_daily_metrics order by date desc limit 60`),
    db.query(`select title, status, description from videos where status in ('idea','borrador','programado') order by created_at desc limit 30`),
  ]);
  const videos = rows.slice(0, 150).map((v) => compact({
    titulo: v.title,
    publicado: v.published_at ? new Date(v.published_at).toISOString().slice(0, 10) : null,
    categoria: v.category, subcategoria: v.subcategory,
    duracion_s: v.duration_seconds,
    atributos: compact(v.attrs as Record<string, unknown>),
    ultima_medicion: v.snapshot ? compact({ ...v.snapshot, horas_desde_publicacion: round(v.snapshot_age_hours, 1) }) : 'no registrada',
    calculadas: v.derived ? compact(Object.fromEntries(Object.entries(v.derived).map(([k, x]) => [k, round(x as number | null)]))) : null,
    nivel_en_ranking: tierOf.get(v.id)?.tier ?? null,
    puntuacion_z: tierOf.get(v.id)?.score ?? null,
  }));
  return {
    cuenta: process.env.ACCOUNT_HANDLE || 'mundo.curioso13',
    fecha_actual: new Date().toISOString().slice(0, 10),
    resumen: {
      videos_registrados: rows.length,
      videos_con_metricas: rows.filter((r) => r.snapshot).length,
      ranking_disponible: ranking.enough_data,
      videos_incluidos_en_este_contexto: videos.length,
    },
    videos,
    patrones_activos: patterns.rows,
    experimentos: experiments.rows,
    recomendaciones: recs.rows,
    decisiones: decisions.rows.map((d) => compact(d)),
    metricas_cuenta_recientes: account.rows.map((r) => compact(r)),
    ideas_y_borradores: ideas.rows.map((r) => compact(r)),
  };
}

const IDENTITY = `Mundo Curioso (@mundo.curioso13) es una cuenta de Instagram de Reels educativos: explica ciencia, tecnología y curiosidades con Code Art, motion graphics y animación hechos con Claude. Su identidad visual usa colores fríos (azul profundo, azul eléctrico, cian, turquesa, violeta frío, negro azulado, grises fríos, blanco), estética de código generativo, storytelling claro y rigor educativo.`;

const RULES = `Reglas obligatorias:
- Responde siempre en español.
- Usa solo los datos del bloque <datos>. No inventes métricas, resultados ni aprendizajes. Si un dato no está, di que no está registrado.
- Cuando cites un número, que salga de <datos>. Indica de qué video o patrón sale.
- Distingue correlación de causalidad: los patrones son asociaciones del historial, no causas demostradas.
- Si la muestra es pequeña (menos de 5 videos por grupo o pocos videos con métricas), dilo y trata la sugerencia como hipótesis a probar en el Laboratorio de experimentos.
- Alcance, impresiones y reproducciones son métricas distintas. La retención aproximada (tiempo promedio ÷ duración) no es la cifra oficial de Instagram.
- Puedes aportar criterio creativo propio (ideas, ganchos, guiones), pero márcalo como propuesta, no como algo que los datos demuestran.
- Formato: Markdown sencillo (títulos con ##, listas, negritas). Sé concreto y útil.`;

function systemPrompt() {
  return `Eres el AI Content Advisor de Mundo Curioso Analytics.\n\n${IDENTITY}\n\n${RULES}`;
}

function userPrompt(kind: string, body: any, data: unknown) {
  const datos = `<datos>\n${JSON.stringify(data)}\n</datos>`;
  if (kind === 'pregunta') return `${datos}\n\nPregunta: ${body.question}`;
  if (kind === 'ideas') {
    return `${datos}\n\nPropón ${body.count} ideas de Reels${body.focus ? ` con este enfoque: ${body.focus}` : ''}. Para cada idea incluye, con estos títulos:
- **Tema**
- **Ángulo narrativo**
- **Hook sugerido** (primeros 3 segundos)
- **Potencial educativo**
- **Potencial visual** (cómo se vería con Code Art / motion graphics)
- **Categoría recomendada** (usa una de las categorías existentes si encaja)
- **Por qué** (qué datos del historial la respaldan; si no hay datos suficientes, dilo y propón qué medir)
Evita repetir temas ya publicados o ya en ideas y borradores.`;
  }
  return `${datos}\n\nEscribe un guion para un Reel de unos ${body.duration_seconds} segundos sobre: ${body.topic}.${body.notes ? `\nIndicaciones: ${body.notes}` : ''}
Estructura:
## Hook (0–3 s)
## Desarrollo (escenas numeradas con tiempo aproximado, narración o texto en pantalla, y descripción visual en Code Art / motion graphics con la paleta fría)
## Cierre y llamada a la acción
## Notas de producción (música, ritmo, complejidad estimada 1–5)
## Qué medir
Al final explica brevemente qué decisiones del guion se apoyan en datos del historial y cuáles son propuesta creativa.`;
}

const askSchema = z.object({ question: z.string().trim().min(3).max(2000) });
const ideasSchema = z.object({ count: z.coerce.number().int().min(1).max(10).default(5), focus: z.string().trim().max(500).optional().nullable() });
const scriptSchema = z.object({ topic: z.string().trim().min(3).max(500), duration_seconds: z.coerce.number().int().min(10).max(180).default(45), notes: z.string().trim().max(1000).optional().nullable() });

export type AdvisorClient = Pick<Anthropic, 'beta'>;

/** Una llamada al modelo. Devuelve el texto o lanza HttpError con un mensaje claro. */
export async function callClaude(client: AdvisorClient, system: string, user: string) {
  let msg;
  try {
    msg = await client.beta.messages.stream({
      model: ADVISOR_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system,
      messages: [{ role: 'user', content: user }],
    }).finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new HttpError(502, 'La clave ANTHROPIC_API_KEY no es válida. Revísala en el archivo .env del servidor.');
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, 'La API de Claude ha limitado las peticiones. Espera un momento y vuelve a intentarlo.');
    if (e instanceof Anthropic.APIError) throw new HttpError(502, `Error de la API de Claude (${e.status ?? 'sin estado'}): ${e.message}`);
    throw e;
  }
  if (msg.stop_reason === 'refusal') throw new HttpError(422, 'El modelo no pudo responder a esta petición. Prueba a reformularla.');
  const text = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
  if (!text) throw new HttpError(502, 'La API de Claude devolvió una respuesta vacía.');
  return { text, model: msg.model, truncated: msg.stop_reason === 'max_tokens' };
}

export function advisorRouter(db: Db, makeClient: () => AdvisorClient = () => new Anthropic()) {
  const router = Router();
  router.get('/context', async (_req, res) => {
    res.json({ configured: !!process.env.ANTHROPIC_API_KEY, model: ADVISOR_MODEL, context: await advisorContext(db) });
  });
  router.get('/history', async (req, res) => {
    const kind = typeof req.query.kind === 'string' ? req.query.kind : null;
    const { rows } = await db.query(
      `select id, kind, question, answer, model, context_summary, created_at from ai_insights ${kind ? 'where kind = $1' : ''} order by created_at desc limit 50`, kind ? [kind] : []);
    res.json(rows);
  });
  router.delete('/history/:id', async (req, res) => {
    await db.query('delete from ai_insights where id = $1', [req.params.id]);
    res.status(204).end();
  });

  const handler = (kind: 'pregunta' | 'ideas' | 'guion', schema: z.ZodTypeAny, label: (b: any) => string) => async (req: any, res: any) => {
    const body = parse(schema, req.body);
    if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(503, 'El AI Advisor no está configurado: falta ANTHROPIC_API_KEY en el archivo .env del servidor.');
    const data = await advisorDataset(db);
    const out = await callClaude(makeClient(), systemPrompt(), userPrompt(kind, body, data));
    const summary = { ...data.resumen, patrones: data.patrones_activos.length, experimentos: data.experimentos.length, truncada: out.truncated };
    const { rows } = await db.query(
      `insert into ai_insights (kind, question, answer, model, context_summary) values ($1,$2,$3,$4,$5) returning *`,
      [kind, label(body), out.text, out.model, summary]);
    res.status(201).json(rows[0]);
  };
  router.post('/ask', handler('pregunta', askSchema, (b) => b.question));
  router.post('/ideas', handler('ideas', ideasSchema, (b) => `${b.count} ideas${b.focus ? ` · ${b.focus}` : ''}`));
  router.post('/script', handler('guion', scriptSchema, (b) => `Guion (${b.duration_seconds} s): ${b.topic}`));
  return router;
}

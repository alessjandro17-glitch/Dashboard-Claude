import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorText } from '../api';
import { Card, Empty, ErrorNote, Loading, PageHead, toast, useApi } from '../components/ui';
import { useBasis } from '../components/basis';
import { fmtDate, fmtInt, fmtMetric, fmtPct } from '../format';
import { METRIC_LABELS } from '../../../shared/metrics';

export function PatternList({ dimensions, title = 'Patrones detectados' }: { dimensions?: string[]; title?: string }) {
  const { data, error } = useApi<any[]>('/api/patterns?status=activo');
  const list = (data || []).filter((p) => !dimensions || dimensions.includes(p.dimension));
  return (
    <Card title={title} actions={<Link className="small" to="/memoria">Ver memoria →</Link>}>
      <ErrorNote error={error} />
      {!list.length ? <p className="muted small">Aún no hay patrones con evidencia suficiente para estas variables. Se detectan al ejecutar el análisis en <Link to="/inteligencia">Inteligencia de contenido</Link> y solo se guardan con muestra suficiente y significación estadística tras corregir por comparaciones múltiples.</p> : (
        <div className="stack">
          {list.map((p) => (
            <div key={p.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <div className="row" style={{ marginBottom: 4 }}><span className={`badge ${p.confidence}`}>Confianza {p.confidence}</span><span className={`badge ${p.direction === 'superior' ? 'superior' : 'inferior'}`}>{p.direction}</span><span className="small muted">detectado {fmtDate(p.first_detected_at)} · confirmado {fmtDate(p.last_confirmed_at)}</span></div>
              <div>{p.statement}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function Intelligence() {
  const { basis, picker } = useBasis();
  const { data, error, loading, reload } = useApi<any>(`/api/analytics/intelligence?basis=${basis}`);
  const recs = useApi<any[]>('/api/recommendations');
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<any>(null);
  async function run() {
    setRunning(true);
    try {
      const r = await api.post('/api/analytics/patterns/run');
      setLastRun(r);
      toast(`Análisis guardado: ${r.patterns.length} patrones, ${r.new_recommendations} recomendaciones nuevas`);
      recs.reload(); reload();
    } catch (e) { toast(errorText(e), 'error'); } finally { setRunning(false); }
  }
  async function setStatus(id: string, status: string) {
    try { await api.patch(`/api/recommendations/${id}`, { status }); recs.reload(); } catch (e) { toast(errorText(e), 'error'); }
  }
  const pending = (recs.data || []).filter((r) => r.status === 'pendiente');
  return (
    <>
      <PageHead title="Inteligencia de contenido" sub="Convierte las estadísticas en decisiones creativas. Toda conclusión muestra su muestra y su nivel de evidencia.">
        {picker}
        <button className="btn-primary" onClick={run} disabled={running}>{running ? 'Analizando…' : 'Ejecutar análisis de patrones'}</button>
      </PageHead>
      <div className="notice" style={{ marginBottom: 16 }}>Las comparaciones muestran asociaciones entre características y resultados (correlación). Para saber si una característica <em>causa</em> una mejora, pruébala de forma controlada en el <Link to="/laboratorio">Laboratorio</Link>.</div>
      {lastRun && <div className="notice" style={{ marginBottom: 16 }}>Último análisis: {lastRun.videos_considered} videos, {lastRun.comparisons_tested} comparaciones evaluadas, {lastRun.patterns.length} patrones con evidencia suficiente.</div>}
      <ErrorNote error={error} />
      {loading && !data && <Loading />}
      {data && (
        <>
          {data.videos_with_metrics === 0 && <Empty title="Todavía no hay videos con métricas">Registra videos y mediciones para que el sistema empiece a aprender.</Empty>}
          <div className="grid grid-2">
            {data.answers.map((a: any) => (
              <Card key={a.key} title={a.question}>
                {a.best ? (
                  <>
                    <p><strong style={{ color: 'var(--cyan)' }}>{a.best.value}</strong>: {a.metric_label.toLowerCase()} mediana de <strong>{fmtMetric(a.metric, a.best.median)}</strong> frente a {fmtMetric(a.metric, a.best.rest_median)} del resto (n={a.best.n}).</p>
                    <p className="small">{a.best.p_value !== null && a.best.p_value < 0.05
                      ? <span className="badge alta">Diferencia significativa (p={a.best.p_value.toFixed(3)})</span>
                      : <span className="badge">Diferencia no significativa{a.best.p_value !== null ? ` (p=${a.best.p_value.toFixed(2)})` : ''}: tómalo como indicio</span>}</p>
                  </>
                ) : (
                  <p className="muted">Sin grupos con muestra suficiente (mínimo {data.min_group} videos con dato por grupo y en el resto).</p>
                )}
                {a.observed.length > 0 && (
                  <table className="small"><tbody>{a.observed.map((g: any) => <tr key={g.value}><td>{g.value}</td><td className="num">{fmtMetric(a.metric, g.median)}</td><td className="num muted">n={g.n}{!g.enough && ' · insuficiente'}</td></tr>)}</tbody></table>
                )}
                {a.unassigned > 0 && <p className="legend-note">{a.unassigned} videos sin «{a.dimension_label.toLowerCase()}» registrado.</p>}
              </Card>
            ))}
            <Card title="¿Qué publicaciones consiguen más seguidores?">
              {!data.followers.length ? <p className="muted">Sin datos de seguidores generados.</p> : (
                <table className="small"><tbody>{data.followers.map((f: any) => <tr key={f.id}><td><Link to={`/videos/${f.id}`}>{f.title}</Link><div className="muted">{f.category ?? 'Sin categoría'}</div></td><td className="num">{fmtInt(f.follows)}</td><td className="num muted">{f.follower_conversion_rate !== null ? `conv. ${fmtPct(f.follower_conversion_rate)}` : ''}</td></tr>)}</tbody></table>
              )}
            </Card>
            <Card title="¿Qué características tienen los videos de mejor rendimiento?">
              {!data.top_traits.enough ? <p className="muted">Se necesitan al menos 10 videos con métricas suficientes para la puntuación global ({data.top_traits.ranked} disponibles).</p> : !data.top_traits.traits.length ? <p className="muted">Ningún atributo aparece con claramente más frecuencia en el 20 % superior.</p> : (
                <>
                  <p className="small muted">Atributos sobrerrepresentados en el {data.top_traits.top_size > 0 ? `top ${data.top_traits.top_size}` : 'top'} (20 % superior por puntuación global) respecto al total.</p>
                  <table className="small"><tbody>{data.top_traits.traits.map((t: any) => <tr key={t.dimension + t.value}><td>{t.dimension}: <strong>{t.value}</strong></td><td className="num">{t.top_count}/{t.top_size} del top ({t.top_share.toFixed(0)} %)</td><td className="num muted">{t.all_share.toFixed(0)} % del total</td></tr>)}</tbody></table>
                </>
              )}
            </Card>
          </div>
          <div className="section-gap"><PatternList /></div>
          <Card title="Recomendaciones pendientes" className="section-gap">
            {!pending.length ? <p className="muted small">No hay recomendaciones pendientes. Se generan a partir de patrones con evidencia o de conclusiones de experimentos.</p> : pending.map((r) => (
              <div key={r.id} style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}>
                <p>{r.text}</p>
                {r.evidence?.group_n && <p className="small muted">Datos: {METRIC_LABELS[r.evidence.metric]} mediana {fmtMetric(r.evidence.metric, r.evidence.group_median)} (n={r.evidence.group_n}) frente a {fmtMetric(r.evidence.metric, r.evidence.rest_median)} (n={r.evidence.rest_n}); q={Number(r.evidence.q_value).toFixed(3)}.</p>}
                <div className="row"><button onClick={() => setStatus(r.id, 'aceptada')}>Aceptar</button><button onClick={() => setStatus(r.id, 'aplicada')}>Marcar aplicada</button><button className="btn-ghost" onClick={() => setStatus(r.id, 'descartada')}>Descartar</button></div>
              </div>
            ))}
          </Card>
        </>
      )}
    </>
  );
}

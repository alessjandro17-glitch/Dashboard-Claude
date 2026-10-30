import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, errorText } from '../api';
import { Card, ErrorNote, Field, Kpi, Loading, PageHead, SortTable, Tabs, toast, useApi } from '../components/ui';
import { fmtDate, fmtMetric } from '../format';
import { METRIC_LABELS } from '../../../shared/metrics';

const STATUS_LABEL: Record<string, string> = { pendiente: 'Pendiente', aceptada: 'Aceptada', descartada: 'Descartada', aplicada: 'Aplicada' };
const ENTITY: Record<string, string> = { video: 'Video', snapshot: 'Medición', category: 'Categoría', experiment: 'Experimento', decision: 'Decisión', recommendation: 'Recomendación', production_note: 'Nota', account: 'Cuenta', account_daily_metrics: 'Métrica de cuenta' };

export default function Memory() {
  const { data, error, loading, reload } = useApi<any>('/api/memory');
  const [tab, setTab] = useState('patrones');
  const [dec, setDec] = useState({ title: '', description: '', recommendation_id: '', outcome: '' });
  const [editDec, setEditDec] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  if (error) return <ErrorNote error={error} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const c = data.counts;
  async function saveDecision(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const body = { title: dec.title, description: dec.description || null, recommendation_id: dec.recommendation_id || null, outcome: dec.outcome || null };
    try {
      if (editDec) await api.put(`/api/decisions/${editDec.id}`, body); else await api.post('/api/decisions', body);
      setDec({ title: '', description: '', recommendation_id: '', outcome: '' }); setEditDec(null); toast('Decisión guardada'); reload();
    } catch (x) { setErr(errorText(x)); }
  }
  async function recStatus(id: string, status: string) {
    try { await api.patch(`/api/recommendations/${id}`, { status }); reload(); } catch (x) { toast(errorText(x), 'error'); }
  }
  return (
    <>
      <PageHead title="Memoria histórica" sub="Todo lo que el sistema ha registrado, analizado, recomendado y decidido. Nada se pierde al cerrar la aplicación.">
        <a className="btn" href="/api/export/backup.json">Copia de seguridad (JSON)</a>
      </PageHead>
      <div className="kpis">
        <Kpi label="Videos" value={c.videos} />
        <Kpi label="Mediciones" value={c.snapshots} />
        <Kpi label="Días de cuenta" value={c.account_days} />
        <Kpi label="Patrones activos" value={c.active_patterns} />
        <Kpi label="Recomendaciones" value={c.recommendations} />
        <Kpi label="Experimentos" value={c.experiments} />
        <Kpi label="Decisiones" value={c.decisions} />
        <Kpi label="Primer video" value={c.first_published ? 1 : null} display={fmtDate(c.first_published)} />
      </div>
      <div className="section-gap">
        <Tabs value={tab} onChange={setTab} options={[
          { value: 'patrones', label: 'Patrones' }, { value: 'recomendaciones', label: 'Recomendaciones' }, { value: 'decisiones', label: 'Decisiones' },
          { value: 'experimentos', label: 'Experimentos concluidos' }, { value: 'analisis', label: 'Análisis realizados' }, { value: 'notas', label: 'Notas de producción' }, { value: 'cambios', label: 'Historial de cambios' },
        ]} />
      </div>
      {tab === 'patrones' && (
        <SortTable rows={data.patterns} initialSort={{ key: 'last', dir: 'desc' }} columns={[
          { key: 'st', label: 'Estado', value: (p) => p.status, render: (p) => <span className={`badge ${p.status === 'activo' ? 'alta' : 'warn'}`}>{p.status === 'activo' ? 'Activo' : 'No confirmado'}</span> },
          { key: 'stmt', label: 'Patrón', wrap: true, value: (p) => p.statement },
          { key: 'conf', label: 'Confianza', value: (p) => p.confidence },
          { key: 'first', label: 'Detectado', value: (p) => p.first_detected_at, render: (p) => fmtDate(p.first_detected_at) },
          { key: 'last', label: 'Último análisis', value: (p) => p.last_confirmed_at, render: (p) => fmtDate(p.last_confirmed_at) },
        ]} empty={<p className="muted">Sin patrones. Ejecuta el análisis en <Link to="/inteligencia">Inteligencia de contenido</Link>.</p>} />
      )}
      {tab === 'recomendaciones' && (
        <SortTable rows={data.recommendations} initialSort={{ key: 'd', dir: 'desc' }} columns={[
          { key: 'd', label: 'Fecha', value: (r) => r.created_at, render: (r) => fmtDate(r.created_at) },
          { key: 's', label: 'Origen', value: (r) => r.source },
          { key: 't', label: 'Recomendación', wrap: true, value: (r) => r.text, render: (r) => <>{r.text}{r.evidence?.group_n && <div className="small muted">Evidencia: {METRIC_LABELS[r.evidence.metric]} {fmtMetric(r.evidence.metric, r.evidence.group_median)} (n={r.evidence.group_n}) vs {fmtMetric(r.evidence.metric, r.evidence.rest_median)} (n={r.evidence.rest_n})</div>}</> },
          { key: 'st', label: 'Estado', value: (r) => r.status, render: (r) => (
            <select value={r.status} onChange={(e) => recStatus(r.id, e.target.value)} aria-label="Estado">{Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>) },
        ]} empty={<p className="muted">Sin recomendaciones todavía.</p>} />
      )}
      {tab === 'decisiones' && (
        <div className="grid grid-2">
          <SortTable rows={data.decisions} initialSort={{ key: 'd', dir: 'desc' }} columns={[
            { key: 'd', label: 'Fecha', value: (d) => d.decided_at, render: (d) => fmtDate(d.decided_at) },
            { key: 't', label: 'Decisión', wrap: true, value: (d) => d.title, render: (d) => <><strong>{d.title}</strong>{d.description && <div className="small">{d.description}</div>}{d.outcome && <div className="small muted">Resultado: {d.outcome}</div>}</> },
            { key: 'a', label: '', sortable: false, render: (d) => <div className="row"><button className="btn-ghost" onClick={() => { setEditDec(d); setDec({ title: d.title, description: d.description ?? '', recommendation_id: d.recommendation_id ?? '', outcome: d.outcome ?? '' }); }}>Editar</button><button className="btn-ghost btn-danger" onClick={async () => { if (confirm('¿Eliminar decisión?')) { await api.del(`/api/decisions/${d.id}`); reload(); } }}>Eliminar</button></div> },
          ]} empty={<p className="muted">Sin decisiones registradas.</p>} />
          <Card title={editDec ? 'Editar decisión' : 'Registrar decisión'}>
            <form onSubmit={saveDecision} className="stack">
              <Field label="Decisión *"><input required value={dec.title} onChange={(e) => setDec({ ...dec, title: e.target.value })} placeholder="Ej. Publicar dos videos de astronomía por semana" /></Field>
              <Field label="Motivo"><textarea value={dec.description} onChange={(e) => setDec({ ...dec, description: e.target.value })} /></Field>
              <Field label="Basada en la recomendación">
                <select value={dec.recommendation_id} onChange={(e) => setDec({ ...dec, recommendation_id: e.target.value })}>
                  <option value="">Ninguna</option>{data.recommendations.map((r: any) => <option key={r.id} value={r.id}>{r.text.slice(0, 90)}</option>)}
                </select>
              </Field>
              <Field label="Resultado observado"><input value={dec.outcome} onChange={(e) => setDec({ ...dec, outcome: e.target.value })} /></Field>
              <ErrorNote error={err} />
              <div className="row"><button className="btn-primary">Guardar</button>{editDec && <button type="button" onClick={() => { setEditDec(null); setDec({ title: '', description: '', recommendation_id: '', outcome: '' }); }}>Cancelar</button>}</div>
            </form>
          </Card>
        </div>
      )}
      {tab === 'experimentos' && (
        <SortTable rows={data.experiments} columns={[
          { key: 'd', label: 'Concluido', value: (e) => e.concluded_at, render: (e) => fmtDate(e.concluded_at) },
          { key: 't', label: 'Experimento', wrap: true, value: (e) => e.title, render: (e) => <><Link to={`/laboratorio?id=${e.id}`}>{e.title}</Link><div className="small muted">{e.hypothesis}</div></> },
          { key: 'v', label: 'Veredicto', value: (e) => e.verdict },
          { key: 'c', label: 'Conclusión', wrap: true, value: (e) => e.conclusion },
        ]} empty={<p className="muted">Ningún experimento concluido.</p>} />
      )}
      {tab === 'analisis' && (
        <SortTable rows={data.runs} columns={[
          { key: 'd', label: 'Fecha', value: (r) => r.run_at, render: (r) => fmtDate(r.run_at, true) },
          { key: 't', label: 'Tipo', value: (r) => r.run_type },
          { key: 'v', label: 'Videos', num: true, value: (r) => r.videos_considered },
          { key: 'c', label: 'Comparaciones', num: true, value: (r) => r.summary.comparisons_tested },
          { key: 'p', label: 'Patrones', num: true, value: (r) => r.summary.patterns_found },
          { key: 'n', label: 'Recomendaciones nuevas', num: true, value: (r) => r.summary.new_recommendations },
        ]} empty={<p className="muted">Todavía no se ha ejecutado ningún análisis.</p>} />
      )}
      {tab === 'notas' && (
        <SortTable rows={data.notes} columns={[
          { key: 'd', label: 'Fecha', value: (n) => n.created_at, render: (n) => fmtDate(n.created_at, true) },
          { key: 'v', label: 'Video', value: (n) => n.title, render: (n) => n.video_id ? <Link to={`/videos/${n.video_id}`}>{n.title}</Link> : null },
          { key: 'n', label: 'Nota', wrap: true, value: (n) => n.note },
        ]} empty={<p className="muted">Sin notas de producción.</p>} />
      )}
      {tab === 'cambios' && (
        <SortTable rows={data.audit.map((a: any) => ({ ...a, id: String(a.id) }))} columns={[
          { key: 'd', label: 'Fecha', value: (a) => a.at, render: (a) => fmtDate(a.at, true) },
          { key: 'e', label: 'Registro', value: (a) => ENTITY[a.entity] || a.entity },
          { key: 'a', label: 'Acción', value: (a) => a.action },
          { key: 'c', label: 'Detalle', wrap: true, sortable: false, render: (a) => a.changes ? <code className="small" style={{ wordBreak: 'break-all' }}>{JSON.stringify(a.changes).slice(0, 220)}</code> : null },
        ]} empty={<p className="muted">Sin cambios registrados.</p>} />
      )}
    </>
  );
}

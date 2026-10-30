import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorText } from '../api';
import { Card, Empty, ErrorNote, Field, Loading, PageHead, SortTable, toast, useApi } from '../components/ui';
import { fmtDate, fmtMetric } from '../format';
import { METRIC_LABELS } from '../../../shared/metrics';

const VARIABLES: [string, string][] = [
  ['hook', 'Hooks'], ['duracion', 'Duración'], ['tematica', 'Temáticas'], ['ritmo', 'Ritmo narrativo'], ['animacion', 'Estilos de animación'],
  ['color_composicion', 'Colores y composiciones'], ['musica', 'Música'], ['storytelling', 'Tipos de storytelling'], ['otro', 'Otra'],
];
const METRICS = ['retention_approx', 'engagement_rate', 'share_rate', 'save_rate', 'profile_visit_rate', 'follower_conversion_rate', 'views', 'reach', 'follows', 'avg_watch_time'];
const VERDICT: Record<string, string> = { respaldada: 'Respaldada', no_respaldada: 'No respaldada', no_concluyente: 'No concluyente' };
const blank = { title: '', hypothesis: '', variable: 'hook', primary_metric: 'retention_approx', control_description: '', variant_description: '', controlled_factors: '', uncontrolled_factors: '', status: 'planificado', verdict: '', conclusion: '' };

function ExperimentEditor({ id, onSaved, onCancel }: { id: string | null; onSaved: (id: string) => void; onCancel: () => void }) {
  const [f, setF] = useState<Record<string, string>>(blank);
  const [arms, setArms] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const videos = useApi<any[]>('/api/videos');
  const existing = useApi<any>(id ? `/api/experiments/${id}` : null);
  useEffect(() => {
    const e = existing.data;
    if (!e) return;
    setF(Object.fromEntries(Object.keys(blank).map((k) => [k, e[k] ?? ''])));
    setArms(Object.fromEntries(e.videos.map((v: any) => [v.video_id, v.arm])));
  }, [existing.data]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const body = {
      ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : v])),
      title: f.title, hypothesis: f.hypothesis, variable: f.variable, primary_metric: f.primary_metric, status: f.status,
      videos: Object.entries(arms).filter(([, a]) => a).map(([video_id, arm]) => ({ video_id, arm })),
    };
    try {
      const r = id ? await api.put(`/api/experiments/${id}`, body) : await api.post('/api/experiments', body);
      toast('Experimento guardado');
      onSaved(r.id);
    } catch (x) { setErr(errorText(x)); }
  }
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <form onSubmit={submit}>
      <Card title={id ? 'Editar experimento' : 'Nueva hipótesis'}>
        <div className="form-grid">
          <Field label="Título *" wide><input required value={f.title} onChange={set('title')} /></Field>
          <Field label="Hipótesis *" wide hint="Ejemplo: los hooks visuales generan mayor retención que los hooks basados solo en narración."><textarea required value={f.hypothesis} onChange={set('hypothesis')} /></Field>
          <Field label="Variable que se prueba"><select value={f.variable} onChange={set('variable')}>{VARIABLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Métrica principal"><select value={f.primary_metric} onChange={set('primary_metric')}>{METRICS.map((m) => <option key={m} value={m}>{METRIC_LABELS[m]}</option>)}</select></Field>
          <Field label="Estado"><select value={f.status} onChange={set('status')}>{['planificado', 'en_curso', 'concluido', 'descartado'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></Field>
          <Field label="Control (versión A)"><input value={f.control_description} onChange={set('control_description')} placeholder="Ej. hook narrado" /></Field>
          <Field label="Variante (versión B)"><input value={f.variant_description} onChange={set('variant_description')} placeholder="Ej. hook visual" /></Field>
          <Field label="Factores controlados" wide hint="Lo que mantuviste igual: categoría, duración, hora de publicación…"><input value={f.controlled_factors} onChange={set('controlled_factors')} /></Field>
          <Field label="Factores no controlados" wide hint="Lo que pudo variar y podría explicar la diferencia."><input value={f.uncontrolled_factors} onChange={set('uncontrolled_factors')} /></Field>
          {f.status === 'concluido' && <>
            <Field label="Veredicto"><select value={f.verdict} onChange={set('verdict')}><option value="">Sin veredicto</option>{Object.entries(VERDICT).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="Conclusión (se guarda en la memoria)" wide><textarea value={f.conclusion} onChange={set('conclusion')} /></Field>
          </>}
        </div>
      </Card>
      <Card title="Videos involucrados" className="section-gap">
        {!videos.data?.length ? <Empty title="No hay videos registrados" /> : (
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            <SortTable rows={videos.data} initialSort={{ key: 'd', dir: 'desc' }} columns={[
              { key: 't', label: 'Video', value: (v) => v.title },
              { key: 'd', label: 'Publicado', value: (v) => v.published_at, render: (v) => fmtDate(v.published_at) },
              { key: 'c', label: 'Categoría', value: (v) => v.category },
              { key: 'arm', label: 'Grupo', sortable: false, render: (v) => (
                <select value={arms[v.id] || ''} onChange={(e) => setArms({ ...arms, [v.id]: e.target.value })} aria-label={`Grupo de ${v.title}`}>
                  <option value="">No participa</option><option value="control">Control</option><option value="variante">Variante</option>
                </select>) },
            ]} />
          </div>
        )}
        <ErrorNote error={err} />
        <div className="row" style={{ marginTop: 12 }}><button className="btn-primary">Guardar experimento</button><button type="button" onClick={onCancel}>Cancelar</button></div>
      </Card>
    </form>
  );
}

function ExperimentView({ id, onEdit, onDeleted }: { id: string; onEdit: () => void; onDeleted: () => void }) {
  const { data, error, reload } = useApi<any>(`/api/experiments/${id}`);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  async function evaluate() {
    setBusy(true);
    try { setResult(await api.post(`/api/experiments/${id}/evaluate`)); reload(); } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); }
  }
  async function remove() {
    if (!confirm('¿Eliminar este experimento y sus resultados?')) return;
    await api.del(`/api/experiments/${id}`);
    onDeleted();
  }
  const r = result;
  return (
    <>
      <Card title={data.title} actions={<div className="row"><button onClick={onEdit}>Editar</button><button className="btn-danger" onClick={remove}>Eliminar</button></div>}>
        <p><strong>Hipótesis:</strong> {data.hypothesis}</p>
        <dl className="dl">
          <dt>Variable</dt><dd>{VARIABLES.find(([v]) => v === data.variable)?.[1]}</dd>
          <dt>Métrica principal</dt><dd>{METRIC_LABELS[data.primary_metric]}</dd>
          <dt>Control</dt><dd>{data.control_description || '—'} ({data.videos.filter((v: any) => v.arm === 'control').length} videos)</dd>
          <dt>Variante</dt><dd>{data.variant_description || '—'} ({data.videos.filter((v: any) => v.arm === 'variante').length} videos)</dd>
          <dt>Controlados</dt><dd>{data.controlled_factors || '—'}</dd>
          <dt>No controlados</dt><dd>{data.uncontrolled_factors || '—'}</dd>
          <dt>Estado</dt><dd>{data.status.replace('_', ' ')}{data.verdict && <> · <strong>{VERDICT[data.verdict]}</strong></>}</dd>
          {data.conclusion && <><dt>Conclusión</dt><dd>{data.conclusion}</dd></>}
        </dl>
        <div className="row" style={{ marginTop: 12 }}><button className="btn-primary" onClick={evaluate} disabled={busy}>{busy ? 'Calculando…' : 'Comparar resultados'}</button></div>
      </Card>
      {r && (
        <Card title="Comparación" className="section-gap">
          <div className="kpis">
            <div className="kpi"><div className="label">Control · mediana</div><div className="value">{fmtMetric(r.metric, r.control_median)}</div><div className="foot">n={r.control_n} de {r.control_total}</div></div>
            <div className="kpi"><div className="label">Variante · mediana</div><div className="value">{fmtMetric(r.metric, r.variant_median)}</div><div className="foot">n={r.variant_n} de {r.variant_total}</div></div>
            <div className="kpi"><div className="label">Diferencia</div><div className="value">{r.diff_pct === null ? 'No registrado' : `${r.diff_pct > 0 ? '+' : ''}${r.diff_pct.toFixed(1)} %`}</div><div className="foot">p = {r.p_value === null ? '—' : r.p_value.toFixed(3)}</div></div>
            <div className="kpi"><div className="label">Lectura sugerida</div><div className="value" style={{ fontSize: 16 }}>{VERDICT[r.suggested_verdict]}</div></div>
          </div>
          <p style={{ marginTop: 12 }}>{r.reason}</p>
          {r.confounders.length > 0 && (
            <div className="notice warn" style={{ marginTop: 8 }}>
              Los grupos también difieren en: {r.confounders.map((c: any) => `${c.factor} (control: ${c.control.join(', ')}; variante: ${c.variante.join(', ')})`).join(' · ')}. Estos factores no están controlados, así que no se puede atribuir la diferencia solo a la variable probada.
            </div>
          )}
          <table className="small section-gap"><tbody>{r.per_video.map((p: any) => <tr key={p.id}><td><span className="badge">{p.arm}</span></td><td><Link to={`/videos/${p.id}`}>{p.title}</Link></td><td className="num">{fmtMetric(r.metric, p.value)}</td></tr>)}</tbody></table>
          <p className="legend-note">Prueba de Mann-Whitney bilateral. El veredicto final lo decides tú al editar el experimento y marcarlo como concluido; la conclusión se guarda en la memoria histórica.</p>
        </Card>
      )}
      {data.results.length > 0 && (
        <Card title="Historial de evaluaciones" className="section-gap">
          <table className="small"><thead><tr><th>Fecha</th><th className="num">Control</th><th className="num">Variante</th><th className="num">Dif.</th><th className="num">p</th><th>Lectura</th></tr></thead>
            <tbody>{data.results.map((x: any) => <tr key={x.id}><td>{fmtDate(x.computed_at, true)}</td><td className="num">{fmtMetric(x.metric, x.control_median)} (n={x.control_n})</td><td className="num">{fmtMetric(x.metric, x.variant_median)} (n={x.variant_n})</td><td className="num">{x.diff_pct === null ? '—' : `${x.diff_pct.toFixed(1)} %`}</td><td className="num">{x.p_value === null ? '—' : x.p_value.toFixed(3)}</td><td>{VERDICT[x.suggested_verdict]}</td></tr>)}</tbody></table>
        </Card>
      )}
    </>
  );
}

export default function Lab() {
  const [params, setParams] = useSearchParams();
  const sel = params.get('id');
  const [mode, setMode] = useState<'view' | 'edit' | 'new'>(sel ? 'view' : 'new');
  const list = useApi<any[]>('/api/experiments');
  const choose = (id: string | null, m: 'view' | 'edit' | 'new' = 'view') => { setParams(id ? { id } : {}); setMode(m); };
  return (
    <>
      <PageHead title="Laboratorio de contenido" sub="Formula hipótesis, asigna videos a control y variante, compara y guarda las conclusiones.">
        <button className="btn-primary" onClick={() => choose(null, 'new')}>+ Nueva hipótesis</button>
      </PageHead>
      <div className="grid grid-side">
        <Card title="Experimentos">
          {!list.data?.length ? <p className="muted small">Todavía no hay experimentos.</p> : list.data.map((e) => (
            <div key={e.id} style={{ padding: '8px 0', borderTop: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => choose(e.id)}>
              <div style={{ color: sel === e.id ? 'var(--cyan)' : undefined }}><strong>{e.title}</strong></div>
              <div className="small muted">{e.status.replace('_', ' ')} · {e.control_count} vs {e.variant_count} videos{e.verdict ? ` · ${VERDICT[e.verdict]}` : ''}</div>
            </div>
          ))}
        </Card>
        <div style={{ minWidth: 0 }}>
          {mode === 'new' && <ExperimentEditor id={null} onSaved={(id) => { list.reload(); choose(id); }} onCancel={() => choose(sel)} />}
          {mode === 'edit' && sel && <ExperimentEditor id={sel} onSaved={(id) => { list.reload(); choose(id); }} onCancel={() => choose(sel)} />}
          {mode === 'view' && sel && <ExperimentView key={sel} id={sel} onEdit={() => setMode('edit')} onDeleted={() => { list.reload(); choose(null, 'new'); }} />}
        </div>
      </div>
    </>
  );
}

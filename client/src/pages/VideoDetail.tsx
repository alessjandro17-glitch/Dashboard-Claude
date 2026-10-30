import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { api, errorText } from '../api';
import { Card, ChartTooltip, COLORS, Empty, ErrorNote, Field, Loading, PageHead, SortTable, Thumb, toast, useApi, download, toCsv } from '../components/ui';
import { fmtDate, fmtHours, fmtInt, fmtMetric, fmtPct, fmtSec, fromLocalInput, NR, toLocalInput } from '../format';
import { METRIC_LABELS } from '../../../shared/metrics';
import { videoReportPdf } from '../pdf';

const SNAP_FIELDS: [string, string][] = [
  ['views', 'Reproducciones / visualizaciones'], ['reach', 'Alcance'], ['impressions', 'Impresiones'], ['likes', 'Me gusta'], ['comments', 'Comentarios'],
  ['shares', 'Compartidos'], ['saves', 'Guardados'], ['profile_visits', 'Visitas al perfil'], ['follows', 'Seguidores generados'],
  ['total_watch_time_seconds', 'Tiempo total de reproducción (s)'], ['avg_watch_time_seconds', 'Tiempo promedio de reproducción (s)'],
];
const PRESETS: [string, number][] = [['1 h', 1], ['6 h', 6], ['24 h', 24], ['48 h', 48], ['7 días', 168], ['30 días', 720]];
const emptySnap = () => ({ captured_at: toLocalInput(new Date().toISOString()), notes: '', ...Object.fromEntries(SNAP_FIELDS.map(([k]) => [k, ''])) }) as Record<string, string>;

function SnapshotForm({ video, initial, onDone, onCancel }: { video: any; initial?: any; onDone: () => void; onCancel?: () => void }) {
  const [f, setF] = useState<Record<string, string>>(() => initial
    ? { captured_at: toLocalInput(initial.captured_at), notes: initial.notes ?? '', ...Object.fromEntries(SNAP_FIELDS.map(([k]) => [k, initial[k]?.toString() ?? ''])) }
    : emptySnap());
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    const body: Record<string, unknown> = { captured_at: fromLocalInput(f.captured_at), notes: f.notes || null, source: initial?.source ?? 'manual' };
    for (const [k] of SNAP_FIELDS) body[k] = f[k].trim() === '' ? null : Number(f[k].replace(',', '.'));
    try {
      if (initial) await api.put(`/api/snapshots/${initial.id}`, body); else await api.post(`/api/videos/${video.id}/snapshots`, body);
      toast(initial ? 'Medición actualizada' : 'Medición guardada');
      if (!initial) setF(emptySnap());
      onDone();
    } catch (x) { setErr(errorText(x)); } finally { setSaving(false); }
  }
  return (
    <form onSubmit={submit} className="stack">
      <div className="form-grid">
        <Field label="Fecha y hora de la medición *">
          <input type="datetime-local" required value={f.captured_at} onChange={(e) => setF({ ...f, captured_at: e.target.value })} />
        </Field>
        {video.published_at && (
          <Field label="Momento tras publicar">
            <div className="seg">
              {PRESETS.map(([l, h]) => <button type="button" key={l} onClick={() => setF({ ...f, captured_at: toLocalInput(new Date(new Date(video.published_at).getTime() + h * 3600_000).toISOString()) })}>{l}</button>)}
            </div>
          </Field>
        )}
        {SNAP_FIELDS.map(([k, l]) => (
          <Field key={k} label={l}><input inputMode="decimal" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder="No registrado" /></Field>
        ))}
        <Field label="Notas" wide><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <ErrorNote error={err} />
      <div className="row">
        <button className="btn-primary" disabled={saving}>{saving ? 'Guardando…' : initial ? 'Guardar cambios' : 'Agregar medición'}</button>
        {onCancel && <button type="button" onClick={onCancel}>Cancelar</button>}
      </div>
    </form>
  );
}

export default function VideoDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const v = useApi<any>(`/api/videos/${id}`);
  const cmp = useApi<any>(`/api/analytics/video/${id}`, [v.data?.snapshots?.length, v.data?.updated_at]);
  const [editing, setEditing] = useState<any>(null);
  const [note, setNote] = useState('');
  const [chartMetric, setChartMetric] = useState('views');
  if (v.error) return <ErrorNote error={v.error} />;
  if (!v.data) return <Loading />;
  const d = v.data;
  const c = d.creative || {};
  const reload = () => { v.reload(); cmp.reload(); };
  const latest = d.snapshots[d.snapshots.length - 1];

  async function remove() {
    if (!confirm(`¿Eliminar «${d.title}» y todas sus mediciones? Esta acción no se puede deshacer.`)) return;
    try { await api.del(`/api/videos/${d.id}`); toast('Video eliminado'); nav('/videos'); } catch (e) { toast(errorText(e), 'error'); }
  }
  async function removeSnap(s: any) {
    if (!confirm(`¿Eliminar la medición del ${fmtDate(s.captured_at, true)}?`)) return;
    try { await api.del(`/api/snapshots/${s.id}`); toast('Medición eliminada'); reload(); } catch (e) { toast(errorText(e), 'error'); }
  }
  async function addNote(e: FormEvent) {
    e.preventDefault();
    try { await api.post(`/api/videos/${d.id}/notes`, { note }); setNote(''); reload(); } catch (x) { toast(errorText(x), 'error'); }
  }
  const yesNo = (b: boolean | null | undefined) => (b === null || b === undefined ? NR : b ? 'Sí' : 'No');
  const chartData = d.snapshots.filter((s: any) => s.hours_since_publish !== null).map((s: any) => ({
    h: Number(s.hours_since_publish.toFixed(1)), label: fmtHours(s.hours_since_publish),
    value: chartMetric in s ? s[chartMetric] : s.derived[chartMetric],
  }));

  return (
    <>
      <PageHead title={d.title} sub={<>{d.category ?? 'Sin categoría'}{d.subcategory ? ` · ${d.subcategory}` : ''} · {d.status} · Publicado {fmtDate(d.published_at, true)}</>}>
        <button onClick={() => videoReportPdf(d, cmp.data)}>Informe PDF</button>
        <button onClick={() => download(`${d.title}-mediciones.csv`, toCsv(d.snapshots.map((s: any) => ({ captured_at: s.captured_at, horas_desde_publicacion: s.hours_since_publish?.toFixed(1), ...Object.fromEntries(SNAP_FIELDS.map(([k]) => [k, s[k]])), ...s.derived }))))} disabled={!d.snapshots.length}>CSV</button>
        <Link className="btn" to={`/videos/${d.id}/editar`}>Editar</Link>
        <button className="btn-danger" onClick={remove}>Eliminar</button>
      </PageHead>

      <div className="grid grid-2">
        <Card title="Información general">
          <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <Thumb src={d.thumbnail_url} alt={d.title} />
            <dl className="dl">
              <dt>Instagram</dt><dd>{d.instagram_url ? <a href={d.instagram_url} target="_blank" rel="noreferrer">Abrir publicación ↗</a> : NR}</dd>
              <dt>Publicación</dt><dd>{fmtDate(d.published_at, true)}</dd>
              <dt>Duración</dt><dd>{fmtSec(d.duration_seconds)}</dd>
              <dt>Mediciones</dt><dd>{d.snapshots.length}</dd>
            </dl>
          </div>
          {d.description && <><h3 className="section-gap">Descripción</h3><p style={{ whiteSpace: 'pre-wrap' }}>{d.description}</p></>}
          {d.script && <details className="section-gap"><summary className="muted">Guion utilizado</summary><p style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{d.script}</p></details>}
        </Card>
        <Card title="Variables creativas">
          <dl className="dl">
            <dt>Hook</dt><dd>{c.hook_type ?? NR}</dd>
            <dt>Estilo narrativo</dt><dd>{c.narrative_style ?? NR}</dd>
            <dt>Storytelling</dt><dd>{c.storytelling_structure ?? NR}</dd>
            <dt>Estilo visual</dt><dd>{c.visual_style ?? NR}</dd>
            <dt>Animación</dt><dd>{c.animation_type ?? NR}</dd>
            <dt>Code Art</dt><dd>{yesNo(c.uses_code_art)}</dd>
            <dt>2D / 3D</dt><dd>{c.dimension ?? NR}</dd>
            <dt>Música</dt><dd>{c.music_type ?? NR}</dd>
            <dt>Voz en off</dt><dd>{yesNo(c.has_voiceover)}</dd>
            <dt>Velocidad narrativa</dt><dd>{c.narrative_pace ?? NR}</dd>
            <dt>Escenas</dt><dd>{c.scene_count ?? NR}</dd>
            <dt>Complejidad</dt><dd>{c.production_complexity ? `${c.production_complexity} / 5` : NR}</dd>
            <dt>Colores y composición</dt><dd>{c.color_composition ?? NR}</dd>
          </dl>
        </Card>
      </div>

      <Card title="Rendimiento (medición más reciente)" className="section-gap">
        {!latest ? <Empty title="Sin mediciones">Agrega la primera medición más abajo.</Empty> : (
          <>
            <p className="small muted">Medición del {fmtDate(latest.captured_at, true)}{latest.hours_since_publish !== null ? `, ${fmtHours(latest.hours_since_publish)} después de publicar` : ''}. El percentil compara con la medición más reciente de los demás videos de la cuenta.</p>
            <SortTable
              rows={(cmp.data?.comparison || []).map((r: any) => ({ ...r, id: r.metric }))}
              columns={[
                { key: 'label', label: 'Métrica', value: (r) => r.label, render: (r) => <>{r.label} {['engagement_rate', 'share_rate', 'save_rate', 'profile_visit_rate', 'follower_conversion_rate', 'interactions'].includes(r.metric) && <span className="badge est">calculada</span>}{r.metric === 'retention_approx' && <span className="badge est">aproximación</span>}{r.metric === 'avg_watch_time' && latest.derived.avg_watch_time_is_computed && <span className="badge est">calculado</span>}</> },
                { key: 'value', label: 'Este video', num: true, value: (r) => r.value, render: (r) => r.value === null ? null : fmtMetric(r.metric, r.value) },
                { key: 'median', label: 'Mediana de la cuenta', num: true, value: (r) => r.account_median, render: (r) => r.account_median === null ? null : fmtMetric(r.metric, r.account_median) },
                { key: 'pct', label: 'Percentil', num: true, value: (r) => r.percentile, render: (r) => r.percentile === null ? <span className="muted small">{r.n < (cmp.data?.min_ranking ?? 5) ? `n=${r.n}, insuficiente` : NR}</span> : `P${Math.round(r.percentile)}` },
              ]}
            />
            <p className="legend-note">La retención aproximada es (tiempo promedio de reproducción ÷ duración) × 100. No es la cifra oficial de Instagram y puede superar el 100 % cuando hay repeticiones.</p>
          </>
        )}
      </Card>

      <Card title="Evolución del video" className="section-gap" actions={
        <select value={chartMetric} onChange={(e) => setChartMetric(e.target.value)} aria-label="Métrica">
          {['views', 'reach', 'impressions', 'likes', 'shares', 'saves', 'follows', 'engagement_rate', 'retention_approx'].map((m) => <option key={m} value={m}>{METRIC_LABELS[m]}</option>)}
        </select>}>
        {chartData.filter((x: any) => x.value !== null && x.value !== undefined).length < 2 ? <Empty title="Se necesitan al menos dos mediciones con fecha de publicación">Registra mediciones en distintos momentos (1 h, 24 h, 7 días…) para ver la curva.</Empty> : (
          <div className="chart-box">
            <ResponsiveContainer>
              <LineChart data={chartData.filter((x: any) => x.value !== null && x.value !== undefined)}>
                <CartesianGrid stroke={COLORS.grid} vertical={false} />
                <XAxis dataKey="h" type="number" stroke={COLORS.muted} fontSize={11} tickFormatter={(h) => fmtHours(h)} domain={['dataMin', 'dataMax']} />
                <YAxis stroke={COLORS.muted} fontSize={11} width={60} tickFormatter={(x) => fmtMetric(chartMetric, x)} />
                <Tooltip content={<ChartTooltip format={(x: number) => fmtMetric(chartMetric, x)} />} labelFormatter={(h) => fmtHours(h as number)} />
                <Legend />
                <Line dataKey="value" name={METRIC_LABELS[chartMetric]} stroke={COLORS.cyan} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card title="Historial de mediciones" className="section-gap">
        <SortTable
          rows={[...d.snapshots].reverse()}
          empty={<Empty title="Sin mediciones registradas" />}
          columns={[
            { key: 'captured_at', label: 'Fecha', value: (s) => s.captured_at, render: (s) => fmtDate(s.captured_at, true) },
            { key: 'h', label: 'Tras publicar', num: true, value: (s) => s.hours_since_publish, render: (s) => (s.hours_since_publish === null ? null : fmtHours(s.hours_since_publish)) },
            { key: 'source', label: 'Origen', value: (s) => s.source },
            ...['views', 'reach', 'impressions', 'likes', 'comments', 'shares', 'saves', 'profile_visits', 'follows'].map((k) => ({ key: k, label: METRIC_LABELS[k], num: true, value: (s: any) => s[k], render: (s: any) => (s[k] === null ? null : fmtInt(s[k])) })),
            { key: 'er', label: 'ER', num: true, value: (s) => s.derived.engagement_rate, render: (s) => (s.derived.engagement_rate === null ? null : fmtPct(s.derived.engagement_rate)) },
            { key: 'act', label: '', sortable: false, render: (s) => <div className="row"><button className="btn-ghost" onClick={() => setEditing(s)}>Editar</button><button className="btn-ghost btn-danger" onClick={() => removeSnap(s)}>Eliminar</button></div> },
          ]}
        />
      </Card>

      <Card title={editing ? `Editar medición del ${fmtDate(editing.captured_at, true)}` : 'Agregar medición'} className="section-gap">
        <SnapshotForm key={editing?.id ?? 'new'} video={d} initial={editing} onDone={() => { setEditing(null); reload(); }} onCancel={editing ? () => setEditing(null) : undefined} />
      </Card>

      <div className="grid grid-2 section-gap">
        <Card title="Notas de producción">
          <form onSubmit={addNote} className="row" style={{ flexWrap: 'nowrap', marginBottom: 10 }}>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Qué se hizo distinto, aprendizajes, problemas…" style={{ flex: 1 }} />
            <button disabled={!note.trim()}>Agregar</button>
          </form>
          {!d.notes.length ? <p className="muted small">Sin notas.</p> : d.notes.map((n: any) => (
            <div key={n.id} className="spread" style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
              <div><div style={{ whiteSpace: 'pre-wrap' }}>{n.note}</div><div className="small muted">{fmtDate(n.created_at, true)}</div></div>
              <button className="btn-ghost btn-danger" onClick={async () => { await api.del(`/api/notes/${n.id}`); reload(); }}>Eliminar</button>
            </div>
          ))}
        </Card>
        <Card title="Experimentos y cambios">
          {d.experiments.length ? <ul>{d.experiments.map((e: any) => <li key={e.id}><Link to={`/laboratorio?id=${e.id}`}>{e.title}</Link> <span className="badge">{e.arm}</span> <span className="small muted">{e.status}</span></li>)}</ul> : <p className="muted small">No participa en experimentos.</p>}
          <h3 className="section-gap">Historial de cambios</h3>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {d.history.map((h: any) => <div key={h.id} className="small" style={{ padding: '4px 0', borderTop: '1px solid var(--border)' }}><span className="muted">{fmtDate(h.at, true)}</span> · {h.action} {h.entity === 'snapshot' ? 'medición' : h.entity}</div>)}
          </div>
        </Card>
      </div>
    </>
  );
}

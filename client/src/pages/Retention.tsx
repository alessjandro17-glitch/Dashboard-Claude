import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ZAxis, Legend, ReferenceLine } from 'recharts';
import { Card, COLORS, Empty, ErrorNote, Loading, PageHead, SERIES, SortTable, useApi } from '../components/ui';
import { useBasis, BASIS_NOTE } from '../components/basis';
import { GroupAnalysis } from '../components/GroupAnalysis';
import { fmtHours, fmtInt, fmtPct, fmtSec } from '../format';
import { METRIC_LABELS } from '../../../shared/metrics';

export default function Retention() {
  const { basis, picker } = useBasis();
  const { data, error, loading } = useApi<any[]>(`/api/analytics/videos?basis=${basis}`);
  const [curveMetric, setCurveMetric] = useState('views');
  const curves = useApi<any[]>(`/api/analytics/curves?metric=${curveMetric}`);
  const [selected, setSelected] = useState<string[]>([]);
  const rows = (data || []).filter((r) => r.derived?.retention_approx != null || r.derived?.avg_watch_time != null);
  const pts = rows.filter((r) => r.duration_seconds && r.derived.retention_approx != null).map((r) => ({ x: r.duration_seconds, y: r.derived.retention_approx, title: r.title }));
  const curveList = (curves.data || []).filter((c) => c.points.length >= 2);
  const shown = selected.length ? curveList.filter((c) => selected.includes(c.id)) : curveList.slice(0, 5);
  return (
    <>
      <PageHead title="Retención" sub="Tiempo de reproducción, retención aproximada y evolución de cada video tras publicarse.">{picker}</PageHead>
      <div className="notice warn" style={{ marginBottom: 14 }}>La retención que muestra esta sección es una aproximación: (tiempo promedio de reproducción ÷ duración del video) × 100. No es la cifra oficial de Instagram y puede superar el 100 % cuando hay reproducciones repetidas.</div>
      <ErrorNote error={error} />
      {loading && !data && <Loading />}
      {data && (
        <>
          <div className="grid grid-2">
            <Card title="Duración frente a retención aproximada">
              {pts.length < 3 ? <Empty title="Datos insuficientes">Necesitas al menos 3 videos con duración y tiempo de reproducción.</Empty> : (
                <div className="chart-box">
                  <ResponsiveContainer>
                    <ScatterChart>
                      <CartesianGrid stroke={COLORS.grid} />
                      <XAxis dataKey="x" type="number" name="Duración" unit=" s" stroke={COLORS.muted} fontSize={11} />
                      <YAxis dataKey="y" type="number" name="Retención" stroke={COLORS.muted} fontSize={11} tickFormatter={(v) => `${v.toFixed(0)}%`} width={48} />
                      <ZAxis range={[60, 60]} />
                      <ReferenceLine y={100} stroke={COLORS.violet} strokeDasharray="4 4" />
                      <Tooltip content={({ payload }) => payload?.[0] ? <div className="tt"><strong>{(payload[0].payload as any).title}</strong><div>Duración: {fmtSec((payload[0].payload as any).x)}</div><div>Retención aprox.: {fmtPct((payload[0].payload as any).y, 1)}</div></div> : null} />
                      <Scatter data={pts} fill={COLORS.turquoise} />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <Card title="Videos">
              <div style={{ maxHeight: 290, overflowY: 'auto' }}>
                <SortTable rows={rows} initialSort={{ key: 'ret', dir: 'desc' }} empty={<Empty title="Sin datos de tiempo de reproducción" />}
                  columns={[
                    { key: 't', label: 'Video', value: (r) => r.title, render: (r) => <Link to={`/videos/${r.id}`}>{r.title}</Link> },
                    { key: 'd', label: 'Duración', num: true, value: (r) => r.duration_seconds, render: (r) => r.duration_seconds ? fmtSec(r.duration_seconds) : null },
                    { key: 'a', label: 'Tiempo medio', num: true, value: (r) => r.derived.avg_watch_time, render: (r) => r.derived.avg_watch_time != null ? fmtSec(r.derived.avg_watch_time) : null },
                    { key: 'ret', label: 'Retención aprox.', num: true, value: (r) => r.derived.retention_approx, render: (r) => r.derived.retention_approx != null ? fmtPct(r.derived.retention_approx, 1) : null },
                  ]} />
              </div>
            </Card>
          </div>
          <p className="legend-note">{BASIS_NOTE}</p>
          <div className="section-gap">
            <GroupAnalysis dimension="duration_bucket" basis={basis} defaultMetric="retention_approx" title="Retención por duración" />
          </div>
        </>
      )}
      <Card title="Evolución tras la publicación" className="section-gap" actions={
        <select value={curveMetric} onChange={(e) => setCurveMetric(e.target.value)} aria-label="Métrica">
          {['views', 'reach', 'impressions', 'likes', 'shares', 'saves', 'follows'].map((m) => <option key={m} value={m}>{METRIC_LABELS[m]}</option>)}
        </select>}>
        {!curveList.length ? <Empty title="Sin curvas disponibles">Registra al menos dos mediciones de un mismo video (por ejemplo, a las 24 h y a los 7 días).</Empty> : (
          <>
            <div className="row" style={{ marginBottom: 10 }}>
              <span className="small muted">Videos:</span>
              {curveList.slice(0, 20).map((c) => (
                <label key={c.id} className="small row" style={{ gap: 4 }}>
                  <input type="checkbox" checked={selected.length ? selected.includes(c.id) : shown.includes(c)} onChange={(e) => {
                    const base = selected.length ? selected : shown.map((s) => s.id);
                    setSelected(e.target.checked ? [...base, c.id] : base.filter((x) => x !== c.id));
                  }} />{c.title}
                </label>
              ))}
            </div>
            <div className="chart-box" style={{ height: 320 }}>
              <ResponsiveContainer>
                <ScatterChart>
                  <CartesianGrid stroke={COLORS.grid} vertical={false} />
                  <XAxis dataKey="hours" type="number" scale="log" domain={['auto', 'auto']} stroke={COLORS.muted} fontSize={11} tickFormatter={(h) => fmtHours(h)} name="Tiempo" />
                  <YAxis dataKey="value" type="number" stroke={COLORS.muted} fontSize={11} width={60} tickFormatter={(v) => fmtInt(v)} name={METRIC_LABELS[curveMetric]} />
                  <ZAxis range={[36, 36]} />
                  <Tooltip content={({ payload }) => payload?.[0] ? <div className="tt"><strong>{(payload[0].payload as any).title}</strong><div>{fmtHours((payload[0].payload as any).hours)} tras publicar</div><div>{METRIC_LABELS[curveMetric]}: {fmtInt((payload[0].payload as any).value)}</div></div> : null} />
                  <Legend />
                  {shown.map((c, i) => <Scatter key={c.id} name={c.title} data={c.points.filter((p: any) => p.hours > 0).map((p: any) => ({ ...p, title: c.title }))} fill={SERIES[i % SERIES.length]} line={{ stroke: SERIES[i % SERIES.length], strokeWidth: 2 }} />)}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <p className="legend-note">Eje horizontal en escala logarítmica para ver con detalle las primeras horas.</p>
          </>
        )}
      </Card>
    </>
  );
}

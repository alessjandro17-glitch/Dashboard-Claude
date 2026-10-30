import { useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Cell } from 'recharts';
import { Card, ChartTooltip, COLORS, Empty, ErrorNote, Loading, SortTable, useApi } from './ui';
import { fmtMetric, NR } from '../format';
import { METRIC_LABELS } from '../../../shared/metrics';

export const GROUP_METRICS = ['views', 'reach', 'engagement_rate', 'share_rate', 'save_rate', 'profile_visit_rate', 'follower_conversion_rate', 'retention_approx', 'follows'];

export function GroupAnalysis({ dimension, basis = 'latest', defaultMetric = 'engagement_rate', title }: { dimension: string; basis?: string; defaultMetric?: string; title?: string }) {
  const [metric, setMetric] = useState(defaultMetric);
  const { data, error, loading } = useApi<any>(`/api/analytics/groups?dimension=${dimension}&basis=${basis}`);
  if (error) return <ErrorNote error={error} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const rows = data.groups.map((g: any) => ({ ...g.stats[metric], id: g.value, value: g.value, n: g.n, n_data: g.stats[metric].n }));
  const ordered = ['duration_bucket', 'hour_bucket', 'production_complexity'].includes(dimension);
  const order = ['≤15 s', '16–30 s', '31–45 s', '46–60 s', '61–90 s', '>90 s'];
  const chart = rows.filter((r: any) => r.median !== null)
    .sort((a: any, b: any) => (ordered ? (order.indexOf(a.value) - order.indexOf(b.value)) || String(a.value).localeCompare(String(b.value)) : b.median - a.median));
  return (
    <Card title={title ?? `Por ${data.label.toLowerCase()}`} actions={
      <select value={metric} onChange={(e) => setMetric(e.target.value)} aria-label="Métrica">
        {GROUP_METRICS.map((m) => <option key={m} value={m}>{METRIC_LABELS[m]}</option>)}
      </select>}>
      {!data.groups.length ? (
        <Empty title={`No hay videos con «${data.label.toLowerCase()}» registrado y métricas`}>Completa este atributo en el formulario de cada video para poder comparar.</Empty>
      ) : (
        <>
          {chart.length > 0 && (
            <div className="chart-box" style={{ height: Math.max(180, chart.length * 34 + 40) }}>
              <ResponsiveContainer>
                <BarChart data={chart} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <CartesianGrid stroke={COLORS.grid} horizontal={false} />
                  <XAxis type="number" stroke={COLORS.muted} fontSize={11} tickFormatter={(v) => fmtMetric(metric, v)} />
                  <YAxis type="category" dataKey="value" stroke={COLORS.muted} fontSize={11} width={150} />
                  <Tooltip content={<ChartTooltip format={(v: number) => fmtMetric(metric, v)} />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                  {data.overall[metric] !== null && <ReferenceLine x={data.overall[metric]} stroke={COLORS.violet} strokeDasharray="4 4" label={{ value: 'mediana cuenta', fill: COLORS.violet, fontSize: 10, position: 'top' }} />}
                  <Bar dataKey="median" name={`Mediana de ${METRIC_LABELS[metric].toLowerCase()}`} radius={[0, 4, 4, 0]}>
                    {chart.map((r: any) => <Cell key={r.value} fill={r.enough ? COLORS.electric : '#2a3a5e'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <SortTable rows={rows} initialSort={{ key: 'median', dir: 'desc' }} columns={[
            { key: 'value', label: data.label, value: (r) => r.value },
            { key: 'n', label: 'Videos', num: true, value: (r) => r.n },
            { key: 'nd', label: 'Con dato', num: true, value: (r) => r.n_data },
            { key: 'median', label: 'Mediana', num: true, value: (r) => r.median, render: (r) => r.median === null ? null : fmtMetric(metric, r.median) },
            { key: 'rest', label: 'Mediana del resto', num: true, value: (r) => r.rest_median, render: (r) => r.rest_median === null ? null : fmtMetric(metric, r.rest_median) },
            { key: 'lift', label: 'Diferencia', num: true, value: (r) => r.lift_pct, render: (r) => r.lift_pct === null ? null : `${r.lift_pct > 0 ? '+' : ''}${r.lift_pct.toFixed(0)} %` },
            { key: 'p', label: 'p-valor', num: true, value: (r) => r.p_value, render: (r) => r.p_value === null ? null : r.p_value.toFixed(3) },
            { key: 'st', label: 'Lectura', sortable: false, render: (r) => !r.enough ? <span className="badge warn">Muestra insuficiente</span> : r.p_value < 0.05 ? <span className="badge alta">Diferencia significativa</span> : <span className="badge">Sin diferencia clara</span> },
          ]} />
          <p className="legend-note">
            Cada grupo se compara con el resto de videos mediante la prueba de Mann-Whitney (no asume distribución normal). Se necesitan al menos {data.min_group} videos con dato en el grupo y en el resto.
            {data.unassigned > 0 && ` ${data.unassigned} videos no tienen este atributo registrado.`} Una diferencia significativa indica asociación, no que ese factor cause el resultado. «{NR}» indica datos que faltan.
          </p>
        </>
      )}
    </Card>
  );
}

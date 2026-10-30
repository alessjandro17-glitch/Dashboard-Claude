import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts';
import { Card, COLORS, Empty, ErrorNote, Loading, PageHead, Seg, SortTable, Thumb, Tier, useApi } from '../components/ui';
import { useBasis, BASIS_NOTE } from '../components/basis';
import { fmtDate, fmtInt, fmtMetric, fmtPct, TIER_LABEL } from '../format';

const METRICS = [
  { value: 'score', label: 'Puntuación global' }, { value: 'reach', label: 'Mayor alcance' }, { value: 'views', label: 'Más reproducciones' },
  { value: 'shares', label: 'Más compartidos' }, { value: 'saves', label: 'Más guardados' }, { value: 'retention_approx', label: 'Mejor retención' },
  { value: 'engagement_rate', label: 'Mayor engagement' }, { value: 'follows', label: 'Más seguidores' },
];

export default function Ranking() {
  const [metric, setMetric] = useState('score');
  const { basis, picker } = useBasis();
  const { data, error, loading } = useApi<any>(`/api/analytics/ranking?metric=${metric}&basis=${basis}`);
  const tiers = ['extraordinario', 'superior', 'normal', 'inferior'];
  const dist = data?.enough_data ? tiers.map((t) => ({ tier: TIER_LABEL[t], key: t, n: data.items.filter((i: any) => i.tier === t).length })) : [];
  const tierColor: Record<string, string> = { extraordinario: COLORS.violet, superior: COLORS.turquoise, normal: '#3a4a6e', inferior: '#f472b6' };
  return (
    <>
      <PageHead title="Ranking" sub="Clasificación relativa al historial de la propia cuenta, sin umbrales fijos de viralidad.">{picker}</PageHead>
      <div className="row" style={{ marginBottom: 14 }}><Seg value={metric} onChange={setMetric} options={METRICS} /></div>
      <ErrorNote error={error} />
      {loading && !data && <Loading />}
      {data && (
        <>
          {!data.enough_data && <div className="notice warn" style={{ marginBottom: 14 }}>Hay {data.with_value} videos con este dato. La clasificación por niveles necesita al menos {data.min_required}; mientras tanto se muestra solo el orden.</div>}
          <Card title="Top 10 videos de Mundo Curioso">
            {!data.items.length ? <Empty title="Sin videos con este dato" /> : (
              <div className="top-list">
                {data.items.slice(0, 10).map((v: any, i: number) => (
                  <div key={v.id} className="top-item">
                    <div className="top-rank">{i + 1}</div>
                    <Thumb src={v.thumbnail_url} alt={v.title} />
                    <div style={{ minWidth: 0 }}>
                      <Link to={`/videos/${v.id}`}><strong>{v.title}</strong></Link>
                      <div className="small muted">{fmtDate(v.published_at)} · {v.category ?? 'Sin categoría'}</div>
                      <div className="small" style={{ marginTop: 4 }}>{METRICS.find((m) => m.value === metric)!.label}: <strong>{fmtMetric(metric, v.value)}</strong></div>
                      <div className="small muted">Alcance {fmtInt(v.snapshot?.reach)} · ER {fmtPct(v.derived?.engagement_rate)} · Guardados {fmtInt(v.snapshot?.saves)}</div>
                      <div style={{ marginTop: 4 }}><Tier tier={v.tier} /></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <div className="grid grid-3 section-gap">
            <Card title="Distribución por nivel">
              {!dist.length ? <p className="muted small">Disponible con {data.min_required} o más videos con dato.</p> : (
                <div className="chart-box" style={{ height: 200 }}>
                  <ResponsiveContainer>
                    <BarChart data={dist} layout="vertical">
                      <XAxis type="number" allowDecimals={false} stroke={COLORS.muted} fontSize={11} />
                      <YAxis type="category" dataKey="tier" width={140} stroke={COLORS.muted} fontSize={11} />
                      <Tooltip contentStyle={{ background: '#16213a', border: '1px solid #2a3a5e', borderRadius: 8 }} />
                      <Bar dataKey="n" name="Videos">{dist.map((d) => <Cell key={d.key} fill={tierColor[d.key]} />)}</Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <Card title="Cómo se clasifica" className="" >
              <p className="small">Cada video se compara con la mediana de la cuenta usando una puntuación robusta (mediana y desviación absoluta mediana; escala logarítmica para conteos):</p>
              <ul className="small">
                <li><strong>Extraordinario</strong>: 2 o más desviaciones por encima de la mediana.</li>
                <li><strong>Superior</strong>: entre 0,5 y 2 por encima.</li>
                <li><strong>Normal</strong>: entre −0,5 y 0,5.</li>
                <li><strong>Inferior</strong>: 0,5 o más por debajo.</li>
              </ul>
              <p className="small muted">La puntuación global promedia alcance, engagement, share rate, save rate, seguidores y retención (mínimo 3 disponibles). Los umbrales se adaptan a medida que crece el historial.</p>
            </Card>
            <Card title="Sin dato">
              {!data.missing.length ? <p className="small muted">Todos los videos tienen este dato.</p> : <><p className="small muted">{data.missing.length} videos sin este dato quedan fuera:</p><ul className="small">{data.missing.slice(0, 8).map((m: any) => <li key={m.id}><Link to={`/videos/${m.id}`}>{m.title}</Link></li>)}</ul></>}
            </Card>
          </div>
          <p className="legend-note">{BASIS_NOTE}</p>
          <Card title="Ranking completo" className="section-gap">
            <SortTable rows={data.items} initialSort={{ key: 'value', dir: 'desc' }} columns={[
              { key: 'pos', label: '#', num: true, sortable: false, render: (v) => data.items.indexOf(v) + 1 },
              { key: 'title', label: 'Video', value: (v) => v.title, render: (v) => <Link to={`/videos/${v.id}`}>{v.title}</Link> },
              { key: 'cat', label: 'Categoría', value: (v) => v.category },
              { key: 'date', label: 'Fecha', value: (v) => v.published_at, render: (v) => fmtDate(v.published_at) },
              { key: 'value', label: METRICS.find((m) => m.value === metric)!.label, num: true, value: (v) => v.value, render: (v) => fmtMetric(metric, v.value) },
              { key: 'z', label: 'Desv. robusta', num: true, value: (v) => v.z, render: (v) => (v.z === null ? null : v.z.toFixed(2)) },
              { key: 'tier', label: 'Nivel', value: (v) => v.z, render: (v) => <Tier tier={v.tier} /> },
            ]} />
          </Card>
        </>
      )}
    </>
  );
}

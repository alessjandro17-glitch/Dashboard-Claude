import { Link } from 'react-router-dom';
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ZAxis } from 'recharts';
import { Card, COLORS, Empty, ErrorNote, Loading, PageHead, SortTable, useApi } from '../components/ui';
import { useBasis, BASIS_NOTE } from '../components/basis';
import { fmtDate, fmtInt, fmtPct, fmtSec, NR } from '../format';

export default function Performance() {
  const { basis, picker } = useBasis();
  const { data, error, loading } = useApi<any[]>(`/api/analytics/videos?basis=${basis}`);
  const rows = (data || []).filter((r) => r.snapshot);
  const pts = rows.filter((r) => r.snapshot.reach != null && r.derived.engagement_rate != null).map((r) => ({ x: r.snapshot.reach, y: r.derived.engagement_rate, title: r.title }));
  const d = (k: string) => (r: any) => r.derived?.[k] ?? null;
  return (
    <>
      <PageHead title="Rendimiento" sub="Métricas calculadas para cada Reel. Las tasas se calculan sobre el alcance.">{picker}</PageHead>
      <p className="legend-note" style={{ marginTop: -10, marginBottom: 14 }}>{BASIS_NOTE}</p>
      <ErrorNote error={error} />
      {loading && !data && <Loading />}
      {data && (
        <>
          <SortTable
            rows={rows}
            initialSort={{ key: 'er', dir: 'desc' }}
            empty={<Empty title="Sin videos con mediciones para esta base de comparación" />}
            columns={[
              { key: 'title', label: 'Video', value: (r) => r.title, wrap: true, render: (r) => <div><Link to={`/videos/${r.id}`}>{r.title}</Link><div className="small muted">{fmtDate(r.published_at)} · {r.category ?? 'Sin categoría'}</div></div> },
              { key: 'reach', label: 'Alcance', num: true, value: (r) => r.snapshot.reach, render: (r) => r.snapshot.reach != null ? fmtInt(r.snapshot.reach) : null },
              { key: 'inter', label: 'Interacciones', num: true, value: d('interactions'), render: (r) => r.derived.interactions != null ? fmtInt(r.derived.interactions) : null },
              { key: 'er', label: 'Engagement rate', num: true, value: d('engagement_rate'), render: (r) => r.derived.engagement_rate != null ? fmtPct(r.derived.engagement_rate) : null },
              { key: 'sr', label: 'Share rate', num: true, value: d('share_rate'), render: (r) => r.derived.share_rate != null ? fmtPct(r.derived.share_rate) : null },
              { key: 'svr', label: 'Save rate', num: true, value: d('save_rate'), render: (r) => r.derived.save_rate != null ? fmtPct(r.derived.save_rate) : null },
              { key: 'pvr', label: 'Profile visit rate', num: true, value: d('profile_visit_rate'), render: (r) => r.derived.profile_visit_rate != null ? fmtPct(r.derived.profile_visit_rate) : null },
              { key: 'fcr', label: 'Conversión a seguidores', num: true, value: d('follower_conversion_rate'), render: (r) => r.derived.follower_conversion_rate != null ? fmtPct(r.derived.follower_conversion_rate) : null },
              { key: 'awt', label: 'Tiempo medio', num: true, value: d('avg_watch_time'), render: (r) => r.derived.avg_watch_time != null ? <>{fmtSec(r.derived.avg_watch_time)}{r.derived.avg_watch_time_is_computed && <span className="badge est" title="Calculado: tiempo total / reproducciones">calc.</span>}</> : null },
              { key: 'ret', label: 'Retención aprox.', num: true, value: d('retention_approx'), render: (r) => r.derived.retention_approx != null ? fmtPct(r.derived.retention_approx, 1) : null },
            ]}
          />
          <div className="grid grid-2 section-gap">
            <Card title="Alcance frente a engagement rate">
              {pts.length < 3 ? <Empty title="Datos insuficientes">Se necesitan al menos 3 videos con alcance e interacciones.</Empty> : (
                <div className="chart-box">
                  <ResponsiveContainer>
                    <ScatterChart margin={{ left: 0, right: 10 }}>
                      <CartesianGrid stroke={COLORS.grid} />
                      <XAxis dataKey="x" name="Alcance" type="number" stroke={COLORS.muted} fontSize={11} tickFormatter={(v) => fmtInt(v)} />
                      <YAxis dataKey="y" name="ER" type="number" stroke={COLORS.muted} fontSize={11} tickFormatter={(v) => `${v.toFixed(1)}%`} width={50} />
                      <ZAxis range={[60, 60]} />
                      <Tooltip content={({ payload }) => payload?.[0] ? <div className="tt"><strong>{(payload[0].payload as any).title}</strong><div>Alcance: {fmtInt((payload[0].payload as any).x)}</div><div>ER: {fmtPct((payload[0].payload as any).y)}</div></div> : null} />
                      <Scatter data={pts} fill={COLORS.cyan} />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <Card title="Definiciones">
              <dl className="dl small">
                <dt>Interacciones</dt><dd>me gusta + comentarios + compartidos + guardados</dd>
                <dt>Engagement rate</dt><dd>(interacciones ÷ alcance) × 100</dd>
                <dt>Share rate</dt><dd>(compartidos ÷ alcance) × 100</dd>
                <dt>Save rate</dt><dd>(guardados ÷ alcance) × 100</dd>
                <dt>Profile visit rate</dt><dd>(visitas al perfil ÷ alcance) × 100</dd>
                <dt>Conversión</dt><dd>(seguidores generados ÷ visitas al perfil) × 100</dd>
                <dt>Tiempo medio</dt><dd>Valor registrado; si falta, tiempo total ÷ reproducciones (marcado «calc.»)</dd>
                <dt>Retención aprox.</dt><dd>(tiempo medio ÷ duración) × 100. Aproximación propia, no es el dato oficial de Instagram; puede superar el 100 % por repeticiones.</dd>
              </dl>
              <p className="legend-note">Si falta cualquier dato de una fórmula, el resultado se muestra como «{NR}».</p>
            </Card>
          </div>
        </>
      )}
    </>
  );
}

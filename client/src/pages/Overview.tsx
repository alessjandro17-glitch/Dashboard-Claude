import { Link } from 'react-router-dom';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar } from 'recharts';
import { Card, ChartTooltip, COLORS, Empty, ErrorNote, Kpi, Loading, PageHead, useApi } from '../components/ui';
import { usePeriod } from '../components/period';
import { delta, fmtDate, fmtInt, fmtPct } from '../format';

function sumFoot(s: { with_data: number; total: number }) {
  if (!s.total) return null;
  return s.with_data < s.total ? <span className="small">{s.with_data} de {s.total} videos con dato</span> : null;
}

export default function Overview() {
  const { range, picker } = usePeriod('30');
  const { data, error, loading } = useApi<any>(`/api/analytics/overview?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`);
  const a = data?.account;
  const ap = data?.account_previous;
  const c = data?.content;
  const cp = data?.content_previous;
  const contentKpis: [string, string][] = [
    ['views', 'Reproducciones'], ['reach', 'Alcance (suma por video)'], ['impressions', 'Impresiones'], ['interactions', 'Interacciones'],
    ['likes', 'Me gusta'], ['comments', 'Comentarios'], ['shares', 'Compartidos'], ['saves', 'Guardados'],
    ['profile_visits', 'Visitas al perfil desde videos'], ['follows', 'Seguidores obtenidos por contenido'],
  ];
  return (
    <>
      <PageHead title="Overview" sub="Indicadores de la cuenta y del contenido publicado en el periodo, comparados con el periodo anterior de igual duración.">
        {picker}
        <Link className="btn" to="/informes">Exportar informe</Link>
      </PageHead>
      <ErrorNote error={error} />
      {loading && !data && <Loading />}
      {data && (
        <>
          <p className="muted small">
            Periodo: {fmtDate(data.period.from)} – {fmtDate(new Date(new Date(data.period.to).getTime() - 1).toISOString())} · Comparado con {fmtDate(data.previous_period.from)} – {fmtDate(new Date(new Date(data.previous_period.to).getTime() - 1).toISOString())}
          </p>
          <h3 className="section-gap">Cuenta</h3>
          {a.days_recorded === 0 && a.followers_current === null ? (
            <div className="notice">No hay métricas de cuenta registradas en este periodo. Agrégalas en <Link to="/configuracion">Configuración → Métricas de la cuenta</Link> o impórtalas por CSV.</div>
          ) : null}
          <div className="kpis" style={{ marginTop: 10 }}>
            <Kpi label="Seguidores actuales" value={a.followers_current} foot={a.followers_current_date ? `al ${fmtDate(a.followers_current_date)}` : null} />
            <Kpi label="Nuevos seguidores" value={a.new_followers} delta={delta(a.new_followers, ap.new_followers)} foot={a.new_followers_method === 'diferencia de seguidores' ? 'neto, por diferencia' : null} />
            <Kpi label="Crecimiento" value={a.growth_pct} display={fmtPct(a.growth_pct)} />
            <Kpi label="Alcance de la cuenta" value={a.reach} delta={delta(a.reach, ap.reach)} foot="suma de valores diarios" />
            <Kpi label="Impresiones de la cuenta" value={a.impressions} delta={delta(a.impressions, ap.impressions)} />
            <Kpi label="Visualizaciones de la cuenta" value={a.views} delta={delta(a.views, ap.views)} />
            <Kpi label="Visitas al perfil" value={a.profile_visits} delta={delta(a.profile_visits, ap.profile_visits)} />
            <Kpi label="Publicaciones totales" value={data.total_posts_all_time} foot="registradas como publicadas" />
          </div>
          <h3 className="section-gap">Contenido publicado en el periodo</h3>
          <div className="kpis" style={{ marginTop: 10 }}>
            <Kpi label="Publicaciones" value={c.posts} delta={delta(c.posts, cp.posts)} foot={c.posts ? `${c.posts_with_metrics} con métricas` : null} />
            {contentKpis.map(([k, l]) => <Kpi key={k} label={l} value={c[k].value} delta={delta(c[k].value, cp[k].value)} foot={sumFoot(c[k])} />)}
          </div>
          <p className="legend-note">Las métricas de contenido usan la medición más reciente de cada video publicado en el periodo. El alcance sumado por video no equivale al alcance único de la cuenta: una misma persona puede ver varios videos.</p>

          <div className="grid grid-2 section-gap">
            <Card title="Evolución de seguidores">
              {a.series.filter((s: any) => s.followers_count !== null).length < 2 ? <Empty title="Datos insuficientes">Se necesitan al menos dos registros de seguidores en el periodo.</Empty> : (
                <div className="chart-box">
                  <ResponsiveContainer>
                    <LineChart data={a.series.filter((s: any) => s.followers_count !== null)}>
                      <CartesianGrid stroke={COLORS.grid} vertical={false} />
                      <XAxis dataKey="date" tickFormatter={(d) => fmtDate(d).slice(0, 6)} stroke={COLORS.muted} fontSize={11} />
                      <YAxis stroke={COLORS.muted} fontSize={11} domain={['auto', 'auto']} tickFormatter={(v) => fmtInt(v)} width={60} />
                      <Tooltip content={<ChartTooltip />} />
                      <Line type="monotone" dataKey="followers_count" name="Seguidores" stroke={COLORS.cyan} strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <Card title="Reproducciones por fecha de publicación">
              {!data.content_series.length ? <Empty title="Sin publicaciones en el periodo" /> : (
                <div className="chart-box">
                  <ResponsiveContainer>
                    <BarChart data={data.content_series}>
                      <CartesianGrid stroke={COLORS.grid} vertical={false} />
                      <XAxis dataKey="date" tickFormatter={(d) => fmtDate(d).slice(0, 6)} stroke={COLORS.muted} fontSize={11} />
                      <YAxis stroke={COLORS.muted} fontSize={11} tickFormatter={(v) => fmtInt(v)} width={60} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                      <Bar dataKey="views" name="Reproducciones" fill={COLORS.electric} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
          </div>
          <Card title="Videos que más seguidores generaron en el periodo" className="section-gap">
            {!data.top_followers.length ? <Empty title="Sin datos de seguidores generados">Registra «Seguidores generados» en las mediciones de cada video.</Empty> : (
              <table><tbody>{data.top_followers.map((v: any) => <tr key={v.id}><td><Link to={`/videos/${v.id}`}>{v.title}</Link></td><td className="num">{fmtInt(v.follows)}</td></tr>)}</tbody></table>
            )}
          </Card>
        </>
      )}
    </>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorText } from '../api';
import { Card, ErrorNote, Field, PageHead, Seg, download, toCsv, useApi } from '../components/ui';
import { fmtDate, fmtMetric } from '../format';
import { periodReportPdf, type PeriodReportData } from '../pdf';

type Kind = 'semanal' | 'mensual' | 'trimestral' | 'anual';

function periodFor(kind: Kind, ref: Date) {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  let from: Date, to: Date;
  if (kind === 'semanal') {
    const dow = (d.getDay() + 6) % 7; // lunes = 0
    from = new Date(d); from.setDate(d.getDate() - dow);
    to = new Date(from); to.setDate(from.getDate() + 7);
  } else if (kind === 'mensual') {
    from = new Date(d.getFullYear(), d.getMonth(), 1); to = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  } else if (kind === 'trimestral') {
    const q = Math.floor(d.getMonth() / 3) * 3;
    from = new Date(d.getFullYear(), q, 1); to = new Date(d.getFullYear(), q + 3, 1);
  } else {
    from = new Date(d.getFullYear(), 0, 1); to = new Date(d.getFullYear() + 1, 0, 1);
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

const pctChange = (a: number | null, b: number | null) => (a !== null && b !== null && b !== 0 ? ((a - b) / Math.abs(b)) * 100 : null);

async function buildReport(kind: Kind, ref: string): Promise<PeriodReportData> {
  const { from, to } = periodFor(kind, new Date(`${ref}T12:00:00`));
  const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const [overview, ranking, patterns, recs] = await Promise.all([
    api.get(`/api/analytics/overview?${q}`), api.get(`/api/analytics/ranking?metric=views&${q}`),
    api.get<any[]>('/api/patterns?status=activo'), api.get<any[]>('/api/recommendations'),
  ]);
  const c = overview.content, cp = overview.content_previous, a = overview.account, ap = overview.account_previous;
  const kpis = [
    { label: 'Publicaciones', cur: c.posts, prev: cp.posts, metric: 'posts' },
    { label: 'Seguidores al cierre', cur: a.followers_current, prev: ap.followers_current, metric: 'followers' },
    { label: 'Nuevos seguidores (cuenta)', cur: a.new_followers, prev: ap.new_followers, metric: 'new_followers' },
    { label: 'Alcance de la cuenta (suma diaria)', cur: a.reach, prev: ap.reach, metric: 'reach' },
    { label: 'Reproducciones de videos del periodo', cur: c.views.value, prev: cp.views.value, metric: 'views' },
    { label: 'Alcance de videos del periodo (suma)', cur: c.reach.value, prev: cp.reach.value, metric: 'reach' },
    { label: 'Interacciones', cur: c.interactions.value, prev: cp.interactions.value, metric: 'interactions' },
    { label: 'Compartidos', cur: c.shares.value, prev: cp.shares.value, metric: 'shares' },
    { label: 'Guardados', cur: c.saves.value, prev: cp.saves.value, metric: 'saves' },
    { label: 'Seguidores generados por contenido', cur: c.follows.value, prev: cp.follows.value, metric: 'follows' },
  ];
  // Conclusiones descriptivas, solo a partir de los datos registrados.
  const conclusions: string[] = [];
  conclusions.push(`Se registraron ${c.posts} publicaciones en el periodo (${cp.posts} en el anterior); ${c.posts_with_metrics} tienen métricas.`);
  const vc = pctChange(c.views.value, cp.views.value);
  if (vc !== null) conclusions.push(`Las reproducciones de los videos publicados variaron un ${vc.toLocaleString('es-ES', { maximumFractionDigits: 1 })} % respecto al periodo anterior.`);
  const fc = a.new_followers;
  if (fc !== null) conclusions.push(`La cuenta ${fc >= 0 ? 'ganó' : 'perdió'} ${Math.abs(fc).toLocaleString('es-ES')} seguidores netos${a.growth_pct !== null ? ` (${a.growth_pct.toLocaleString('es-ES', { maximumFractionDigits: 2 })} %)` : ''}.`);
  if (ranking.items[0]) conclusions.push(`El video con más reproducciones fue «${ranking.items[0].title}» con ${fmtMetric('views', ranking.items[0].value)}.`);
  if (c.posts && c.posts_with_metrics < c.posts) conclusions.push(`${c.posts - c.posts_with_metrics} publicaciones del periodo no tienen mediciones: los totales pueden estar incompletos.`);
  if (c.posts < 5) conclusions.push('Con menos de 5 publicaciones en el periodo, las comparaciones deben leerse con cautela.');
  return {
    label: kind[0].toUpperCase() + kind.slice(1), from, to, overview, ranking, kpis, conclusions,
    patterns, recommendations: recs.filter((r) => r.status === 'pendiente'),
  };
}

export default function Reports() {
  const [kind, setKind] = useState<Kind>('mensual');
  const [ref, setRef] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<PeriodReportData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const videos = useApi<any[]>('/api/videos');
  const p = periodFor(kind, new Date(`${ref}T12:00:00`));
  async function generate() {
    setErr(null); setBusy(true);
    try { setData(await buildReport(kind, ref)); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  }
  function csv() {
    if (!data) return;
    const rows = [
      ...data.kpis.map((k) => ({ seccion: 'indicador', nombre: k.label, periodo: k.cur, anterior: k.prev })),
      ...data.ranking.items.map((i: any) => ({ seccion: 'video', nombre: i.title, fecha: i.published_at, reproducciones: i.snapshot?.views, alcance: i.snapshot?.reach, engagement_rate: i.derived?.engagement_rate, compartidos: i.snapshot?.shares, guardados: i.snapshot?.saves, seguidores: i.snapshot?.follows, nivel: i.tier })),
      ...data.conclusions.map((c) => ({ seccion: 'conclusion', nombre: c })),
      ...data.recommendations.map((r) => ({ seccion: 'recomendacion', nombre: r.text })),
    ];
    const cols = ['seccion', 'nombre', 'periodo', 'anterior', 'fecha', 'reproducciones', 'alcance', 'engagement_rate', 'compartidos', 'guardados', 'seguidores', 'nivel'];
    download(`informe-${kind}-${data.from.slice(0, 10)}.csv`, toCsv(rows, cols));
  }
  return (
    <>
      <PageHead title="Informes" sub="Informes semanales, mensuales, trimestrales y anuales en PDF o CSV, con gráficos, conclusiones y recomendaciones." />
      <Card title="Informe por periodo">
        <div className="row">
          <Seg value={kind} onChange={(k) => { setKind(k); setData(null); }} options={[{ value: 'semanal', label: 'Semanal' }, { value: 'mensual', label: 'Mensual' }, { value: 'trimestral', label: 'Trimestral' }, { value: 'anual', label: 'Anual' }]} />
          <Field label="Fecha de referencia"><input type="date" value={ref} onChange={(e) => { setRef(e.target.value); setData(null); }} /></Field>
          <span className="small muted">Periodo: {fmtDate(p.from)} – {fmtDate(new Date(new Date(p.to).getTime() - 1).toISOString())}</span>
          <button className="btn-primary" onClick={generate} disabled={busy}>{busy ? 'Generando…' : 'Generar'}</button>
        </div>
        <ErrorNote error={err} />
        {data && (
          <div className="section-gap">
            <h3>Conclusiones</h3>
            <ul>{data.conclusions.map((c) => <li key={c}>{c}</li>)}</ul>
            <div className="row"><button className="btn-primary" onClick={() => periodReportPdf(data)}>Descargar PDF</button><button onClick={csv}>Descargar CSV</button></div>
          </div>
        )}
      </Card>
      <Card title="Informe individual de un video" className="section-gap">
        <p className="small muted">Abre el video y usa «Informe PDF» o «CSV».</p>
        <div className="row">{(videos.data || []).slice(0, 30).map((v) => <Link key={v.id} className="btn" to={`/videos/${v.id}`}>{v.title}</Link>)}</div>
      </Card>
    </>
  );
}

import { Link } from 'react-router-dom';
import { Card, ErrorNote, Loading, PageHead, useApi } from '../components/ui';

export default function Advisor() {
  const { data, error, loading } = useApi<any>('/api/advisor/context');
  const c = data?.context;
  return (
    <>
      <PageHead title="AI Advisor" sub="Asistente que responde con los datos históricos de Mundo Curioso." />
      <ErrorNote error={error} />
      {loading && !data && <Loading />}
      {data && (
        <>
          {!data.configured && (
            <div className="notice warn" style={{ marginBottom: 16 }}>
              El asistente todavía no está activo. Se activará en la fase 2, cuando se configure una clave de la API de Claude en el servidor (<code>ANTHROPIC_API_KEY</code>). No se simulan respuestas.
            </div>
          )}
          <Card title="Datos que el asistente podrá usar">
            <p className="small muted">El asistente solo tendrá acceso a lo almacenado en la base de datos. Si algo no está registrado, debe decirlo en lugar de inventarlo.</p>
            <dl className="dl">
              <dt>Videos registrados</dt><dd>{c.videos_total}</dd>
              <dt>Con métricas</dt><dd>{c.videos_with_metrics}</dd>
              <dt>Ranking disponible</dt><dd>{c.ranking_available ? 'Sí' : 'Aún no (faltan videos con métricas)'}</dd>
              <dt>Patrones activos</dt><dd>{c.active_patterns.length}</dd>
              <dt>Experimentos</dt><dd>{c.experiments.length}</dd>
              <dt>Recomendaciones</dt><dd>{c.recommendations.length}</dd>
            </dl>
            <p className="small section-gap">Mientras tanto, las respuestas basadas en datos están en <Link to="/inteligencia">Inteligencia de contenido</Link>, <Link to="/ranking">Ranking</Link> y <Link to="/memoria">Memoria histórica</Link>.</p>
          </Card>
        </>
      )}
    </>
  );
}

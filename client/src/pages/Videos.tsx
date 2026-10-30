import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, ErrorNote, Loading, PageHead, SortTable, Thumb, useApi } from '../components/ui';
import { fmtDate, fmtInt, fmtPct, fmtSec } from '../format';

export default function Videos() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [status, setStatus] = useState('');
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (cat) params.set('category_id', cat);
  if (status) params.set('status', status);
  const { data, error, loading } = useApi<any[]>(`/api/videos?${params}`);
  const { data: cats } = useApi<any[]>('/api/categories');
  return (
    <>
      <PageHead title="Videos" sub="Base de datos de Reels. Cada publicación con sus variables creativas y su historial de mediciones.">
        <Link className="btn" to="/importar">Importar CSV</Link>
        <Link className="btn btn-primary" to="/videos/nuevo">+ Nuevo video</Link>
      </PageHead>
      <div className="row" style={{ marginBottom: 14 }}>
        <input placeholder="Buscar por nombre…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 220 }} aria-label="Buscar" />
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoría">
          <option value="">Todas las categorías</option>
          {cats?.filter((c) => !c.parent_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Estado">
          <option value="">Todos los estados</option>
          {['publicado', 'programado', 'borrador', 'idea', 'archivado'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {data && <span className="muted small">{data.length} videos</span>}
      </div>
      <ErrorNote error={error} />
      {loading && !data && <Loading />}
      {data && (
        <SortTable
          rows={data}
          initialSort={{ key: 'published_at', dir: 'desc' }}
          empty={<Empty title="Todavía no hay videos registrados"><p>Registra tu primer Reel o importa un CSV con tu historial.</p><div className="row" style={{ justifyContent: 'center', marginTop: 10 }}><Link className="btn btn-primary" to="/videos/nuevo">+ Nuevo video</Link><Link className="btn" to="/importar">Importar CSV</Link></div></Empty>}
          columns={[
            { key: 'thumb', label: '', render: (v) => <Thumb src={v.thumbnail_url} alt={v.title} />, sortable: false },
            { key: 'title', label: 'Video', value: (v) => v.title, wrap: true, render: (v) => <div><Link to={`/videos/${v.id}`}><strong>{v.title}</strong></Link><div className="small muted">{v.category ?? 'Sin categoría'}{v.subcategory ? ` · ${v.subcategory}` : ''}</div></div> },
            { key: 'published_at', label: 'Publicado', value: (v) => v.published_at, render: (v) => fmtDate(v.published_at, true) },
            { key: 'status', label: 'Estado', value: (v) => v.status },
            { key: 'duration', label: 'Duración', num: true, value: (v) => v.duration_seconds, render: (v) => v.duration_seconds ? fmtSec(v.duration_seconds) : null },
            { key: 'views', label: 'Reproducciones', num: true, value: (v) => v.snapshot?.views, render: (v) => v.snapshot?.views != null ? fmtInt(v.snapshot.views) : null },
            { key: 'reach', label: 'Alcance', num: true, value: (v) => v.snapshot?.reach, render: (v) => v.snapshot?.reach != null ? fmtInt(v.snapshot.reach) : null },
            { key: 'er', label: 'ER', num: true, value: (v) => v.derived?.engagement_rate, render: (v) => v.derived?.engagement_rate != null ? fmtPct(v.derived.engagement_rate) : null },
            { key: 'snaps', label: 'Mediciones', num: true, value: (v) => v.snapshot_count },
          ]}
        />
      )}
    </>
  );
}

import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Papa from 'papaparse';
import { api, errorText } from '../api';
import { Card, ErrorNote, Field, PageHead, Seg, download } from '../components/ui';
import { toLocalInput, fromLocalInput } from '../format';

type Kind = 'videos' | 'cuenta';
const VIDEO_TARGETS: [string, string, string[]][] = [
  ['title', 'Nombre del video', ['titulo', 'título', 'nombre', 'title', 'name', 'video']],
  ['instagram_url', 'URL de Instagram', ['url', 'enlace', 'link', 'permalink', 'instagram url']],
  ['instagram_media_id', 'ID de publicación (Instagram)', ['media id', 'id publicacion', 'post id', 'id de publicación']],
  ['published_at', 'Fecha y hora de publicación', ['fecha y hora', 'publicado', 'publish time', 'published at', 'fecha de publicacion', 'fecha de publicación', 'publication date']],
  ['published_date', 'Fecha de publicación (solo fecha)', ['fecha', 'date']],
  ['published_time', 'Hora de publicación (solo hora)', ['hora', 'time']],
  ['duration_seconds', 'Duración (s o mm:ss)', ['duracion', 'duración', 'duration', 'segundos']],
  ['category', 'Categoría', ['categoria', 'categoría', 'category', 'tema']],
  ['subcategory', 'Subcategoría', ['subcategoria', 'subcategoría', 'subcategory']],
  ['status', 'Estado', ['estado', 'status']],
  ['thumbnail_url', 'URL de miniatura', ['miniatura', 'portada', 'thumbnail']],
  ['description', 'Descripción', ['descripcion', 'descripción', 'description', 'caption', 'texto']],
  ['script', 'Guion', ['guion', 'guión', 'script']],
  ['hook_type', 'Tipo de hook', ['hook', 'tipo de hook']],
  ['narrative_style', 'Estilo narrativo', ['estilo narrativo']],
  ['storytelling_structure', 'Estructura storytelling', ['estructura', 'storytelling']],
  ['visual_style', 'Estilo visual', ['estilo visual']],
  ['animation_type', 'Tipo de animación', ['animacion', 'animación', 'tipo de animacion']],
  ['uses_code_art', 'Code Art (sí/no)', ['code art']],
  ['dimension', '2D / 3D', ['2d/3d', 'dimension', '2d o 3d']],
  ['music_type', 'Tipo de música', ['musica', 'música', 'music']],
  ['has_voiceover', 'Voz en off (sí/no)', ['voz en off', 'voiceover', 'voz']],
  ['narrative_pace', 'Velocidad narrativa', ['ritmo', 'velocidad']],
  ['scene_count', 'Cantidad de escenas', ['escenas', 'scenes']],
  ['production_complexity', 'Complejidad (1–5)', ['complejidad']],
  ['color_composition', 'Colores y composición', ['colores', 'composicion', 'composición']],
  ['captured_at', 'Fecha y hora de la medición', ['fecha medicion', 'fecha de medición', 'medido', 'captured at', 'snapshot']],
  ['views', 'Reproducciones / visualizaciones', ['reproducciones', 'visualizaciones', 'views', 'plays', 'vistas']],
  ['reach', 'Alcance', ['alcance', 'reach', 'cuentas alcanzadas']],
  ['impressions', 'Impresiones', ['impresiones', 'impressions']],
  ['likes', 'Me gusta', ['me gusta', 'likes']],
  ['comments', 'Comentarios', ['comentarios', 'comments']],
  ['shares', 'Compartidos', ['compartidos', 'shares', 'veces compartido']],
  ['saves', 'Guardados', ['guardados', 'saves', 'saved']],
  ['profile_visits', 'Visitas al perfil', ['visitas al perfil', 'profile visits']],
  ['follows', 'Seguidores generados', ['seguidores', 'follows', 'nuevos seguidores', 'seguimientos']],
  ['total_watch_time_seconds', 'Tiempo total de reproducción (s)', ['tiempo total', 'tiempo de reproduccion', 'watch time']],
  ['avg_watch_time_seconds', 'Tiempo promedio de reproducción (s)', ['tiempo promedio', 'tiempo medio', 'average watch time', 'avg watch time']],
];
const ACCOUNT_TARGETS: [string, string, string[]][] = [
  ['date', 'Fecha', ['fecha', 'date', 'dia', 'día']],
  ['followers_count', 'Seguidores (total)', ['seguidores', 'followers', 'total seguidores']],
  ['new_followers', 'Nuevos seguidores (netos)', ['nuevos seguidores', 'new followers', 'follows']],
  ['reach', 'Alcance', ['alcance', 'reach']],
  ['impressions', 'Impresiones', ['impresiones', 'impressions']],
  ['views', 'Visualizaciones', ['visualizaciones', 'views', 'reproducciones']],
  ['profile_visits', 'Visitas al perfil', ['visitas al perfil', 'profile visits']],
];

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[_-]/g, ' ').trim();
function guess(headers: string[], targets: [string, string, string[]][]) {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  // Primero coincidencias exactas (nombre interno o sinónimo), después parciales.
  for (const pass of ['exact', 'partial'] as const) {
    for (const [key, , syn] of targets) {
      if (out[key]) continue;
      const cands = [key, ...syn].map(norm);
      const h = headers.find((x) => !used.has(x) && (pass === 'exact' ? cands.includes(norm(x)) : cands.some((c) => c.length > 3 && norm(x).includes(c))));
      if (h) { out[key] = h; used.add(h); }
    }
  }
  return out;
}

const STATUS_LABEL: Record<string, string> = { nuevo: 'Nuevo', duplicado: 'Ya existe', duplicado_en_archivo: 'Medición adicional', error: 'Error' };

export default function Import() {
  const [params] = useSearchParams();
  const [kind, setKind] = useState<Kind>(params.get('tipo') === 'cuenta' ? 'cuenta' : 'videos');
  const targets = kind === 'videos' ? VIDEO_TARGETS : ACCOUNT_TARGETS;
  const [file, setFile] = useState<{ name: string; headers: string[]; rows: Record<string, string>[] } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [defaultCap, setDefaultCap] = useState('');
  const [dupMode, setDupMode] = useState<'skip' | 'update'>('skip');
  const [preview, setPreview] = useState<any>(null);
  const [report, setReport] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('todos');

  function reset(k?: Kind) { setFile(null); setMapping({}); setPreview(null); setReport(null); setErr(null); if (k) setKind(k); }

  function onFile(f: File) {
    reset();
    Papa.parse<Record<string, string>>(f, {
      header: true, skipEmptyLines: 'greedy',
      complete: (res) => {
        const headers = (res.meta.fields || []).filter(Boolean);
        if (!headers.length || !res.data.length) { setErr('No se encontraron columnas o filas en el archivo.'); return; }
        if (res.errors.length) setErr(`Avisos al leer el CSV: ${res.errors.slice(0, 3).map((e) => `fila ${(e.row ?? 0) + 2}: ${e.message}`).join('; ')}`);
        setFile({ name: f.name, headers, rows: res.data });
        setMapping(guess(headers, targets));
      },
      error: (e) => setErr(`No se pudo leer el archivo: ${e.message}`),
    });
  }

  const mappedRows = useMemo(() => file?.rows.map((r) => Object.fromEntries(Object.entries(mapping).filter(([, h]) => h).map(([k, h]) => [k, r[h]]))) || [], [file, mapping]);
  const payload = () => kind === 'videos'
    ? { rows: mappedRows, tz_offset_minutes: -new Date().getTimezoneOffset(), default_captured_at: defaultCap ? fromLocalInput(defaultCap) : null, duplicate_mode: dupMode }
    : { rows: mappedRows, duplicate_mode: dupMode };
  const base = kind === 'videos' ? '/api/import/videos' : '/api/import/account';

  async function runPreview() {
    setErr(null); setBusy(true); setReport(null);
    try { setPreview(await api.post(`${base}/preview`, payload())); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  }
  async function commit() {
    const n = preview.rows.filter((r: any) => r.status !== 'error').length;
    if (!confirm(`Se importarán ${n} filas válidas${preview.summary.error ? ` y se omitirán ${preview.summary.error} con errores` : ''}. ¿Confirmas?`)) return;
    setBusy(true);
    try { setReport(await api.post(`${base}/commit`, payload())); setPreview(null); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  }
  const required = kind === 'videos' ? ['title'] : ['date'];
  const missingRequired = required.filter((r) => !mapping[r]);
  const rows = (preview?.rows || []).filter((r: any) => filter === 'todos' || r.status === filter);

  return (
    <>
      <PageHead title="Importar CSV" sub="Reconoce columnas, permite asignarlas, valida, detecta duplicados y muestra una vista previa antes de guardar.">
        <button onClick={() => download(kind === 'videos' ? 'plantilla-videos.csv' : 'plantilla-cuenta.csv', '\ufeff' + targets.map(([k]) => k).join(',') + '\n')}>Descargar plantilla</button>
      </PageHead>
      <div className="row" style={{ marginBottom: 14 }}>
        <Seg value={kind} onChange={(k) => reset(k)} options={[{ value: 'videos', label: 'Videos y mediciones' }, { value: 'cuenta', label: 'Métricas diarias de la cuenta' }]} />
      </div>
      <Card title="1. Archivo">
        <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} aria-label="Archivo CSV" />
        <p className="hint" style={{ marginTop: 8 }}>
          {kind === 'videos'
            ? 'Cada fila es un video. Si el mismo video aparece en varias filas con distintas fechas de medición, cada fila se guarda como una medición nueva del mismo video. Fechas admitidas: AAAA-MM-DD HH:mm, DD/MM/AAAA HH:mm o ISO 8601; se interpretan en tu zona horaria.'
            : 'Una fila por día. Las columnas vacías se guardan como «no registrado».'} Números: «1.234» y «1,234» se leen como 1234; «12,5» como 12,5.
        </p>
        <ErrorNote error={err} />
      </Card>

      {file && (
        <Card title={`2. Asignar columnas · ${file.name} (${file.rows.length} filas)`} className="section-gap">
          <div className="form-grid">
            {targets.map(([key, label]) => (
              <Field key={key} label={`${label}${required.includes(key) ? ' *' : ''}`}>
                <select value={mapping[key] || ''} onChange={(e) => { setMapping({ ...mapping, [key]: e.target.value }); setPreview(null); }}>
                  <option value="">— No importar —</option>
                  {file.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </Field>
            ))}
          </div>
          <div className="form-grid section-gap">
            {kind === 'videos' && (
              <Field label="Fecha de medición por defecto" hint="Se usa en las filas con métricas que no tengan su propia fecha de medición.">
                <input type="datetime-local" value={defaultCap} onChange={(e) => { setDefaultCap(e.target.value); setPreview(null); }} />
                <button type="button" className="btn-ghost small" onClick={() => setDefaultCap(toLocalInput(new Date().toISOString()))}>Usar ahora</button>
              </Field>
            )}
            <Field label="Si el registro ya existe">
              <select value={dupMode} onChange={(e) => { setDupMode(e.target.value as any); setPreview(null); }}>
                <option value="skip">{kind === 'videos' ? 'No modificar el video (sí añadir sus mediciones nuevas)' : 'Omitir'}</option>
                <option value="update">Actualizar con los valores del CSV (los vacíos no borran nada)</option>
              </select>
            </Field>
          </div>
          {missingRequired.length > 0 && <div className="notice warn" style={{ marginTop: 10 }}>Asigna la columna obligatoria: {missingRequired.map((r) => targets.find(([k]) => k === r)![1]).join(', ')}.</div>}
          <div className="row" style={{ marginTop: 12 }}><button className="btn-primary" onClick={runPreview} disabled={busy || missingRequired.length > 0}>{busy ? 'Validando…' : 'Validar y ver vista previa'}</button></div>
        </Card>
      )}

      {preview && (
        <Card title="3. Vista previa y confirmación" className="section-gap">
          <div className="row" style={{ marginBottom: 10 }}>
            {Object.entries(preview.summary).map(([k, v]) => <span key={k} className={`badge ${k === 'error' ? 'inferior' : k === 'nuevo' ? 'superior' : ''}`}>{STATUS_LABEL[k]}: {v as number}</span>)}
            <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar filas"><option value="todos">Todas las filas</option>{Object.keys(STATUS_LABEL).map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}</select>
          </div>
          <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table>
              <thead><tr><th>Fila</th><th>Estado</th>{kind === 'videos' ? <><th>Video</th><th>Publicado</th><th>Medición</th></> : <><th>Fecha</th><th>Datos</th></>}<th>Errores y avisos</th></tr></thead>
              <tbody>
                {rows.slice(0, 500).map((r: any) => (
                  <tr key={r.index}>
                    <td className="num">{r.index + 2}</td>
                    <td><span className={`badge ${r.status === 'error' ? 'inferior' : r.status === 'nuevo' ? 'superior' : ''}`}>{STATUS_LABEL[r.status]}</span></td>
                    {kind === 'videos' ? <>
                      <td className="wrap">{r.normalized.video.title || '—'}{r.match && <div className="small muted">Coincide con: <Link to={`/videos/${r.match.id}`}>{r.match.title}</Link></div>}</td>
                      <td>{r.normalized.video.published_at ? new Date(r.normalized.video.published_at).toLocaleString('es-ES') : '—'}</td>
                      <td className="small">{r.normalized.snapshot ? `${Object.keys(r.normalized.snapshot).length - 2} métricas · ${r.normalized.snapshot.captured_at ? new Date(r.normalized.snapshot.captured_at).toLocaleString('es-ES') : 'sin fecha'}` : 'Sin métricas'}</td>
                    </> : <>
                      <td>{r.normalized.date ?? '—'}</td>
                      <td className="small">{Object.keys(r.normalized).filter((k) => !['date', 'source'].includes(k) && r.normalized[k] !== null).join(', ') || '—'}</td>
                    </>}
                    <td className="wrap small">{r.errors.map((e: string) => <div key={e} style={{ color: 'var(--bad)' }}>{e}</div>)}{(r.warnings || []).map((w: string) => <div key={w} className="muted">{w}</div>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 500 && <p className="hint">Se muestran las primeras 500 filas.</p>}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn-primary" onClick={commit} disabled={busy || preview.rows.every((r: any) => r.status === 'error')}>{busy ? 'Importando…' : 'Confirmar e importar'}</button>
            <button onClick={() => setPreview(null)}>Volver a asignar columnas</button>
          </div>
        </Card>
      )}

      {report && (
        <Card title="Importación completada" className="section-gap">
          <dl className="dl">
            <dt>Creados</dt><dd>{report.created}</dd>
            <dt>Actualizados</dt><dd>{report.updated}</dd>
            <dt>Omitidos (ya existían)</dt><dd>{report.skipped}</dd>
            {kind === 'videos' && <><dt>Mediciones añadidas</dt><dd>{report.snapshots_added}</dd><dt>Mediciones repetidas omitidas</dt><dd>{report.snapshots_skipped}</dd><dt>Categorías creadas</dt><dd>{report.categories_created}</dd></>}
            <dt>Filas con errores</dt><dd>{report.errors.length}</dd>
          </dl>
          {report.errors.length > 0 && <ul className="small">{report.errors.slice(0, 50).map((e: any) => <li key={e.index}>Fila {e.index + 2}: {e.errors.join('; ')}</li>)}</ul>}
          <div className="row" style={{ marginTop: 10 }}><Link className="btn" to={kind === 'videos' ? '/videos' : '/configuracion'}>Ver registros</Link><button onClick={() => reset()}>Importar otro archivo</button></div>
        </Card>
      )}
    </>
  );
}

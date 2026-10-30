import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorText } from '../api';
import { Card, ErrorNote, Field, Loading, PageHead, toast, useApi } from '../components/ui';
import { fromLocalInput, toLocalInput } from '../format';

// Sugerencias de vocabulario. Solo ayudan a escribir: no son datos de rendimiento.
const SUGGEST: Record<string, string[]> = {
  hook_type: ['Pregunta', 'Dato sorprendente', 'Visual impactante', 'Promesa', 'Misterio', 'Contradicción', 'Desafío al espectador', 'Narración directa'],
  narrative_style: ['Divulgativo', 'Misterio y revelación', 'Humor', 'Épico', 'Contemplativo', 'Conversacional'],
  storytelling_structure: ['Problema → explicación → revelación', 'Lista', 'Cronológica', 'Pregunta → respuesta', 'Mito vs realidad', 'Comparación de escalas'],
  visual_style: ['Code Art abstracto', 'Motion graphics', 'Infografía animada', 'Minimalista', 'Cinemático', 'Collage'],
  animation_type: ['Partículas generativas', 'Tipografía cinética', 'Simulación física', 'Shaders', 'Transiciones geométricas', 'Animación 3D'],
  music_type: ['Ambiental', 'Electrónica', 'Orquestal', 'Lo-fi', 'Tensión / suspense', 'Sin música'],
  narrative_pace: ['Lenta', 'Media', 'Rápida', 'Variable'],
  color_composition: ['Fría (azules/cian)', 'Alto contraste', 'Monocromática', 'Neón sobre negro'],
};

const empty = {
  title: '', instagram_url: '', published_at: '', duration_seconds: '', category_id: '', subcategory_id: '', status: 'publicado', thumbnail_url: '', description: '', script: '',
  creative: {
    hook_type: '', narrative_style: '', storytelling_structure: '', visual_style: '', animation_type: '', uses_code_art: '', dimension: '', music_type: '',
    has_voiceover: '', narrative_pace: '', scene_count: '', production_complexity: '', color_composition: '',
  } as Record<string, string>,
};

const triToBool = (v: string) => (v === '' ? null : v === 'si');
const boolToTri = (v: boolean | null | undefined) => (v === null || v === undefined ? '' : v ? 'si' : 'no');
const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));

export default function VideoForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const [form, setForm] = useState(empty);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newCat, setNewCat] = useState('');
  const cats = useApi<any[]>('/api/categories');
  const vocab = useApi<Record<string, string[]>>('/api/videos/vocabulary');
  const existing = useApi<any>(id ? `/api/videos/${id}` : null);

  useEffect(() => {
    const v = existing.data;
    if (!v) return;
    const c = v.creative || {};
    setForm({
      title: v.title ?? '', instagram_url: v.instagram_url ?? '', published_at: toLocalInput(v.published_at), duration_seconds: v.duration_seconds?.toString() ?? '',
      category_id: v.category_id ?? '', subcategory_id: v.subcategory_id ?? '', status: v.status, thumbnail_url: v.thumbnail_url ?? '', description: v.description ?? '', script: v.script ?? '',
      creative: {
        hook_type: c.hook_type ?? '', narrative_style: c.narrative_style ?? '', storytelling_structure: c.storytelling_structure ?? '', visual_style: c.visual_style ?? '',
        animation_type: c.animation_type ?? '', uses_code_art: boolToTri(c.uses_code_art), dimension: c.dimension ?? '', music_type: c.music_type ?? '',
        has_voiceover: boolToTri(c.has_voiceover), narrative_pace: c.narrative_pace ?? '', scene_count: c.scene_count?.toString() ?? '',
        production_complexity: c.production_complexity?.toString() ?? '', color_composition: c.color_composition ?? '',
      },
    });
  }, [existing.data]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const setC = (k: string, v: string) => setForm((f) => ({ ...f, creative: { ...f.creative, [k]: v } }));
  const options = (k: string) => [...new Set([...(vocab.data?.[k] || []), ...(SUGGEST[k] || [])])];
  const text = (k: string, label: string) => (
    <Field label={label}>
      <input list={`dl-${k}`} value={form.creative[k]} onChange={(e) => setC(k, e.target.value)} />
      <datalist id={`dl-${k}`}>{options(k).map((o) => <option key={o} value={o} />)}</datalist>
    </Field>
  );

  async function addCategory(parent: string | null) {
    if (!newCat.trim()) return;
    try {
      const c = await api.post('/api/categories', { name: newCat.trim(), parent_id: parent });
      await cats.reload();
      if (parent) set('subcategory_id', c.id); else set('category_id', c.id);
      setNewCat('');
    } catch (e) { toast(errorText(e), 'error'); }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    const c = form.creative;
    const body = {
      title: form.title, instagram_url: form.instagram_url || null, published_at: fromLocalInput(form.published_at), duration_seconds: numOrNull(form.duration_seconds),
      category_id: form.category_id || null, subcategory_id: form.subcategory_id || null, status: form.status, thumbnail_url: form.thumbnail_url || null,
      description: form.description || null, script: form.script || null,
      creative: {
        hook_type: c.hook_type || null, narrative_style: c.narrative_style || null, storytelling_structure: c.storytelling_structure || null, visual_style: c.visual_style || null,
        animation_type: c.animation_type || null, uses_code_art: triToBool(c.uses_code_art), dimension: c.dimension || null, music_type: c.music_type || null,
        has_voiceover: triToBool(c.has_voiceover), narrative_pace: c.narrative_pace || null, scene_count: numOrNull(c.scene_count),
        production_complexity: numOrNull(c.production_complexity), color_composition: c.color_composition || null,
      },
    };
    try {
      const saved = id ? await api.put(`/api/videos/${id}`, body) : await api.post('/api/videos', body);
      toast(id ? 'Cambios guardados' : 'Video creado');
      nav(`/videos/${saved.id}`);
    } catch (x) { setErr(errorText(x)); } finally { setSaving(false); }
  }

  if (id && existing.loading && !existing.data) return <Loading />;
  const parents = cats.data?.filter((c) => !c.parent_id) || [];
  const subs = cats.data?.filter((c) => c.parent_id && c.parent_id === form.category_id) || [];
  return (
    <form onSubmit={submit}>
      <PageHead title={id ? 'Editar video' : 'Nuevo video'} sub="Los campos vacíos se guardan como «no registrado».">
        <Link className="btn" to={id ? `/videos/${id}` : '/videos'}>Cancelar</Link>
        <button className="btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
      </PageHead>
      <ErrorNote error={err || existing.error} />
      <Card title="Información general">
        <div className="form-grid">
          <Field label="Nombre del video *" wide><input required value={form.title} onChange={(e) => set('title', e.target.value)} /></Field>
          <Field label="URL de Instagram" hint="https://www.instagram.com/reel/…"><input type="url" value={form.instagram_url} onChange={(e) => set('instagram_url', e.target.value)} /></Field>
          <Field label="Fecha y hora de publicación" hint="En tu zona horaria local"><input type="datetime-local" value={form.published_at} onChange={(e) => set('published_at', e.target.value)} /></Field>
          <Field label="Duración (segundos)"><input inputMode="decimal" value={form.duration_seconds} onChange={(e) => set('duration_seconds', e.target.value)} /></Field>
          <Field label="Estado">
            <select value={form.status} onChange={(e) => set('status', e.target.value)}>
              {['publicado', 'programado', 'borrador', 'idea', 'archivado'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Categoría temática">
            <select value={form.category_id} onChange={(e) => { set('category_id', e.target.value); set('subcategory_id', ''); }}>
              <option value="">Sin categoría</option>
              {parents.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Subcategoría">
            <select value={form.subcategory_id} onChange={(e) => set('subcategory_id', e.target.value)} disabled={!form.category_id}>
              <option value="">Sin subcategoría</option>
              {subs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Crear categoría o subcategoría">
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Nombre" style={{ flex: 1 }} />
              <button type="button" onClick={() => addCategory(null)}>Categoría</button>
              <button type="button" onClick={() => addCategory(form.category_id)} disabled={!form.category_id}>Sub</button>
            </div>
          </Field>
          <Field label="Portada o miniatura (URL de imagen)"><input type="url" value={form.thumbnail_url} onChange={(e) => set('thumbnail_url', e.target.value)} /></Field>
          <Field label="Descripción" wide><textarea value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>
          <Field label="Guion utilizado" wide><textarea style={{ minHeight: 140 }} value={form.script} onChange={(e) => set('script', e.target.value)} /></Field>
        </div>
      </Card>
      <Card title="Variables creativas">
        <div className="form-grid">
          {text('hook_type', 'Tipo de hook')}
          {text('narrative_style', 'Estilo narrativo')}
          {text('storytelling_structure', 'Estructura del storytelling')}
          {text('visual_style', 'Estilo visual')}
          {text('animation_type', 'Tipo de animación')}
          <Field label="Uso de Code Art">
            <select value={form.creative.uses_code_art} onChange={(e) => setC('uses_code_art', e.target.value)}><option value="">No registrado</option><option value="si">Sí</option><option value="no">No</option></select>
          </Field>
          <Field label="Elementos 2D o 3D">
            <select value={form.creative.dimension} onChange={(e) => setC('dimension', e.target.value)}>
              <option value="">No registrado</option>{['2D', '3D', '2D+3D', 'ninguno'].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          {text('music_type', 'Tipo de música')}
          <Field label="Voz en off">
            <select value={form.creative.has_voiceover} onChange={(e) => setC('has_voiceover', e.target.value)}><option value="">No registrado</option><option value="si">Sí</option><option value="no">No</option></select>
          </Field>
          {text('narrative_pace', 'Velocidad narrativa')}
          <Field label="Cantidad de escenas"><input inputMode="numeric" value={form.creative.scene_count} onChange={(e) => setC('scene_count', e.target.value)} /></Field>
          <Field label="Complejidad de producción (1–5)">
            <select value={form.creative.production_complexity} onChange={(e) => setC('production_complexity', e.target.value)}>
              <option value="">No registrado</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
          {text('color_composition', 'Colores y composición')}
        </div>
      </Card>
    </form>
  );
}

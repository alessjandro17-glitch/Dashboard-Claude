import { useState, type FormEvent } from 'react';
import { api, errorText } from '../api';
import { Card, ErrorNote, PageHead, SortTable, Tabs, toast, useApi } from '../components/ui';
import { useBasis } from '../components/basis';
import { GroupAnalysis } from '../components/GroupAnalysis';
import { PatternList } from './Intelligence';

export default function Categories() {
  const cats = useApi<any[]>('/api/categories');
  const { basis, picker } = useBasis();
  const [level, setLevel] = useState<'category' | 'subcategory'>('category');
  const [form, setForm] = useState({ name: '', parent_id: '', description: '' });
  const [edit, setEdit] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const parents = cats.data?.filter((c) => !c.parent_id) || [];
  const nameOf = (id: string) => cats.data?.find((c) => c.id === id)?.name;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const body = { name: form.name, parent_id: form.parent_id || null, description: form.description || null };
    try {
      if (edit) await api.put(`/api/categories/${edit.id}`, body); else await api.post('/api/categories', body);
      toast(edit ? 'Categoría actualizada' : 'Categoría creada');
      setForm({ name: '', parent_id: '', description: '' });
      setEdit(null);
      cats.reload();
    } catch (x) { setErr(errorText(x)); }
  }
  async function remove(c: any) {
    if (!confirm(`¿Eliminar «${c.name}»? Los videos quedarán sin esta categoría${!c.parent_id ? ' y se eliminarán sus subcategorías' : ''}.`)) return;
    try { await api.del(`/api/categories/${c.id}`); cats.reload(); } catch (x) { toast(errorText(x), 'error'); }
  }
  return (
    <>
      <PageHead title="Categorías" sub="Rendimiento por temática y gestión de categorías y subcategorías.">{picker}</PageHead>
      <Tabs value={level} onChange={setLevel} options={[{ value: 'category', label: 'Categorías' }, { value: 'subcategory', label: 'Subcategorías' }]} />
      <GroupAnalysis key={level + basis} dimension={level} basis={basis} defaultMetric="share_rate" />
      <div className="section-gap"><PatternList dimensions={['category', 'subcategory']} title="Patrones por temática" /></div>
      <div className="grid grid-2 section-gap">
        <Card title="Categorías registradas">
          <SortTable rows={cats.data || []} columns={[
            { key: 'n', label: 'Nombre', value: (c) => c.name, render: (c) => <>{c.parent_id && <span className="muted">{nameOf(c.parent_id)} › </span>}{c.name}</> },
            { key: 'v', label: 'Videos', num: true, value: (c) => c.video_count },
            { key: 'a', label: '', sortable: false, render: (c) => <div className="row"><button className="btn-ghost" onClick={() => { setEdit(c); setForm({ name: c.name, parent_id: c.parent_id ?? '', description: c.description ?? '' }); }}>Editar</button><button className="btn-ghost btn-danger" onClick={() => remove(c)}>Eliminar</button></div> },
          ]} />
        </Card>
        <Card title={edit ? `Editar «${edit.name}»` : 'Nueva categoría'}>
          <form onSubmit={submit} className="stack">
            <label className="field">Nombre<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="field">Pertenece a (para subcategorías)
              <select value={form.parent_id} onChange={(e) => setForm({ ...form, parent_id: e.target.value })}>
                <option value="">— Es una categoría principal —</option>
                {parents.filter((p) => p.id !== edit?.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="field">Descripción<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
            <ErrorNote error={err} />
            <div className="row"><button className="btn-primary">{edit ? 'Guardar' : 'Crear'}</button>{edit && <button type="button" onClick={() => { setEdit(null); setForm({ name: '', parent_id: '', description: '' }); }}>Cancelar</button>}</div>
          </form>
        </Card>
      </div>
    </>
  );
}

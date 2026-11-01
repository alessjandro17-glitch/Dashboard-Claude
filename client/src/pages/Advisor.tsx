import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorText } from '../api';
import { Card, ErrorNote, Field, Loading, PageHead, Tabs, toast, useApi } from '../components/ui';
import { Markdown } from '../components/Markdown';
import { fmtDate } from '../format';

type Mode = 'pregunta' | 'ideas' | 'guion';
const KIND_LABEL: Record<string, string> = { pregunta: 'Pregunta', ideas: 'Ideas', guion: 'Guion' };
const EXAMPLES = [
  '¿Qué tipo de video debería producir esta semana?',
  '¿Qué tienen en común mis videos con más guardados?',
  '¿Qué hook funciona mejor según mi historial?',
  '¿Qué debería probar en el laboratorio?',
];

function Answer({ item, onDelete }: { item: any; onDelete?: () => void }) {
  return (
    <Card title={<span>{KIND_LABEL[item.kind] ?? item.kind} · <span className="muted small">{item.question}</span></span>}
      actions={<div className="row">
        <span className="small muted">{fmtDate(item.created_at, true)}</span>
        <button className="btn-ghost" onClick={() => { navigator.clipboard?.writeText(item.answer); toast('Copiado'); }}>Copiar</button>
        {onDelete && <button className="btn-ghost" onClick={onDelete}>Eliminar</button>}
      </div>}>
      <Markdown text={item.answer} />
      <p className="hint section-gap">
        Basado en {item.context_summary?.videos_con_metricas ?? '?'} videos con métricas, {item.context_summary?.patrones ?? 0} patrones activos y {item.context_summary?.experimentos ?? 0} experimentos.
        {item.context_summary?.truncada ? ' La respuesta se cortó por longitud.' : ''} Modelo: {item.model}.
      </p>
    </Card>
  );
}

export default function Advisor() {
  const ctx = useApi<any>('/api/advisor/context');
  const history = useApi<any[]>('/api/advisor/history');
  const [mode, setMode] = useState<Mode>('pregunta');
  const [question, setQuestion] = useState('');
  const [count, setCount] = useState(5);
  const [focus, setFocus] = useState('');
  const [topic, setTopic] = useState('');
  const [duration, setDuration] = useState(45);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [latest, setLatest] = useState<any>(null);

  const configured = ctx.data?.configured;
  const c = ctx.data?.context;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const r = mode === 'pregunta' ? await api.post('/api/advisor/ask', { question })
        : mode === 'ideas' ? await api.post('/api/advisor/ideas', { count, focus: focus || null })
        : await api.post('/api/advisor/script', { topic, duration_seconds: duration, notes: notes || null });
      setLatest(r);
      history.reload();
    } catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  }
  async function remove(id: string) {
    await api.del(`/api/advisor/history/${id}`);
    if (latest?.id === id) setLatest(null);
    history.reload();
  }

  return (
    <>
      <PageHead title="AI Advisor" sub="Preguntas, ideas y guiones con Claude, usando solo los datos guardados de Mundo Curioso." />
      <ErrorNote error={ctx.error} />
      {ctx.loading && !ctx.data && <Loading />}
      {ctx.data && !configured && (
        <div className="notice warn" style={{ marginBottom: 16 }}>
          El asistente no está activo: falta la clave <code>ANTHROPIC_API_KEY</code> en el archivo <code>.env</code> del servidor. Añádela y reinicia la app. No se simulan respuestas.
        </div>
      )}
      {c && (
        <div className="notice" style={{ marginBottom: 16 }}>
          El asistente ve {c.videos_total} videos ({c.videos_with_metrics} con métricas), {c.active_patterns.length} patrones activos, {c.experiments.length} experimentos y {c.recommendations.length} recomendaciones.
          {c.videos_with_metrics < 5 && ' Con tan pocos datos, sus sugerencias serán hipótesis creativas más que conclusiones del historial.'}
          {' '}Para cifras exactas consulta <Link to="/inteligencia">Inteligencia</Link> y <Link to="/ranking">Ranking</Link>.
        </div>
      )}
      <Card>
        <Tabs value={mode} onChange={(m) => { setMode(m); setErr(null); }} options={[
          { value: 'pregunta', label: 'Preguntar' }, { value: 'ideas', label: 'Generador de ideas' }, { value: 'guion', label: 'Generador de guiones' },
        ]} />
        <form className="stack" onSubmit={submit}>
          {mode === 'pregunta' && (
            <>
              <Field label="Tu pregunta" wide>
                <textarea rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="¿Qué tipo de video debería producir esta semana?" />
              </Field>
              <div className="row">{EXAMPLES.map((q) => <button type="button" key={q} className="btn-ghost small" onClick={() => setQuestion(q)}>{q}</button>)}</div>
            </>
          )}
          {mode === 'ideas' && (
            <div className="row">
              <Field label="Número de ideas"><input type="number" min={1} max={10} value={count} onChange={(e) => setCount(Number(e.target.value))} /></Field>
              <Field label="Enfoque (opcional)" wide><input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="p. ej. física cuántica, ideas rápidas de producir, serie de 3 partes" /></Field>
            </div>
          )}
          {mode === 'guion' && (
            <>
              <div className="row">
                <Field label="Tema o idea" wide><input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Por qué el cielo es azul" /></Field>
                <Field label="Duración (s)"><input type="number" min={10} max={180} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></Field>
              </div>
              <Field label="Indicaciones (opcional)" wide><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Tono, público, elementos visuales que quieras usar…" /></Field>
            </>
          )}
          <div className="row">
            <button className="btn-primary" disabled={busy || !configured}>{busy ? 'Pensando… (puede tardar un minuto)' : mode === 'pregunta' ? 'Preguntar' : mode === 'ideas' ? 'Generar ideas' : 'Generar guion'}</button>
          </div>
          <ErrorNote error={err} />
        </form>
      </Card>
      {latest && <div className="section-gap"><Answer item={latest} onDelete={() => remove(latest.id)} /></div>}
      <h3 className="section-gap">Historial</h3>
      <p className="small muted">Cada respuesta se guarda en la base de datos con el resumen de los datos que se usaron.</p>
      {history.data && !history.data.length && <p className="small muted">Todavía no hay respuestas guardadas.</p>}
      <div className="stack">
        {(history.data || []).filter((h) => h.id !== latest?.id).map((h) => <Answer key={h.id} item={h} onDelete={() => remove(h.id)} />)}
      </div>
    </>
  );
}

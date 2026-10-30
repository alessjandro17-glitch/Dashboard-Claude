import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, errorText } from '../api';
import { NR } from '../format';

export const COLORS = { electric: '#3b74ff', cyan: '#22d3ee', turquoise: '#2dd4bf', violet: '#8b7cf6', deep: '#0b2a6b', grid: '#1d2944', muted: '#7d8aa3', text: '#b8c3d8' };
export const SERIES = [COLORS.electric, COLORS.cyan, COLORS.violet, COLORS.turquoise, '#6b8cff', '#a5b4fc', '#67e8f9', '#5eead4'];

/** Carga datos de la API con estado de carga y error. */
export function useApi<T = any>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    setError(null);
    try { setData(await api.get<T>(url)); } catch (e) { setError(errorText(e)); } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}

let toastTimer: number | undefined;
export function toast(message: string, kind: 'ok' | 'error' = 'ok') {
  window.dispatchEvent(new CustomEvent('mca:toast', { detail: { message, kind } }));
}
export function Toaster() {
  const [t, setT] = useState<{ message: string; kind: string } | null>(null);
  useEffect(() => {
    const h = (e: Event) => {
      setT((e as CustomEvent).detail);
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => setT(null), 4500);
    };
    window.addEventListener('mca:toast', h);
    return () => window.removeEventListener('mca:toast', h);
  }, []);
  if (!t) return null;
  return <div className={`toast ${t.kind === 'error' ? 'error' : ''}`} role="status" onClick={() => setT(null)}>{t.message}</div>;
}

export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

export function Card({ title, children, actions, className = '' }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && <div className="spread" style={{ marginBottom: 12 }}>{title ? <h2 style={{ margin: 0 }}>{title}</h2> : <span />}{actions}</div>}
      {children}
    </section>
  );
}

export function Delta({ value, invert = false }: { value: number | null }  & { invert?: boolean }) {
  if (value === null || !Number.isFinite(value)) return null;
  const up = invert ? value < 0 : value > 0;
  const cls = value === 0 ? '' : up ? 'up' : 'down';
  return <span className={`delta ${cls}`}>{value > 0 ? '▲' : value < 0 ? '▼' : '='} {Math.abs(value).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %</span>;
}

export function Kpi({ label, value, display, delta, foot, tag }: { label: string; value: number | null | undefined; display?: string; delta?: number | null; foot?: ReactNode; tag?: ReactNode }) {
  const missing = value === null || value === undefined;
  return (
    <div className="kpi">
      <div className="label"><span>{label}</span>{tag}</div>
      <div className={`value ${missing ? 'nr' : ''}`}>{missing ? NR : display ?? value.toLocaleString('es-ES')}</div>
      <div className="foot">{delta !== undefined && <Delta value={delta ?? null} />} {foot}</div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><strong>{title}</strong>{children}</div>;
}

export function ErrorNote({ error }: { error: string | null }) {
  return error ? <div className="notice error">{error}</div> : null;
}

export function Loading() {
  return <div className="muted small">Cargando…</div>;
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="group">
      {options.map((o) => <button key={o.value} type="button" className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {options.map((o) => <button key={o.value} role="tab" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export interface Column<T> {
  key: string;
  label: ReactNode;
  value?: (row: T) => number | string | null | undefined;
  render?: (row: T) => ReactNode;
  num?: boolean;
  wrap?: boolean;
  sortable?: boolean;
}

/** Tabla ordenable. Los valores no registrados siempre quedan al final, sea cual sea el orden. */
export function SortTable<T = any>({ rows, columns, initialSort, empty, rowKey }: { rows: T[]; columns: Column<T>[]; initialSort?: { key: string; dir: 'asc' | 'desc' }; empty?: ReactNode; rowKey?: (r: T, i: number) => string }) {
  const [sort, setSort] = useState(initialSort || null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.value) return rows;
    const get = col.value;
    return [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      const xn = x === null || x === undefined || x === '';
      const yn = y === null || y === undefined || y === '';
      if (xn && yn) return 0;
      if (xn) return 1;
      if (yn) return -1;
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'es');
      return sort.dir === 'asc' ? c : -c;
    });
  }, [rows, sort, columns]);
  if (!rows.length) return <>{empty ?? <Empty title="Sin registros" />}</>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => {
              const can = c.sortable !== false && !!c.value;
              const on = sort?.key === c.key;
              return (
                <th key={c.key} className={`${c.num ? 'num' : ''} ${can ? 'sortable' : ''}`} aria-sort={on ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  onClick={() => can && setSort(on && sort!.dir === 'desc' ? { key: c.key, dir: 'asc' } : { key: c.key, dir: 'desc' })}>
                  {c.label}{on ? (sort!.dir === 'desc' ? ' ↓' : ' ↑') : ''}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={rowKey ? rowKey(r, i) : (r as any).id ?? i}>
              {columns.map((c) => {
                const content = c.render ? c.render(r) : c.value ? c.value(r) : null;
                return <td key={c.key} className={`${c.num ? 'num' : ''} ${c.wrap ? 'wrap' : ''}`}>{content === null || content === undefined || content === '' ? <span className="nr">{NR}</span> : content}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Field({ label, children, hint, wide }: { label: string; children: ReactNode; hint?: ReactNode; wide?: boolean }) {
  return <label className={`field ${wide ? 'wide' : ''}`}>{label}{children}{hint && <span className="hint">{hint}</span>}</label>;
}

export function Tier({ tier }: { tier: string | null | undefined }) {
  if (!tier) return <span className="badge">Sin clasificar</span>;
  const label: Record<string, string> = { extraordinario: 'Extraordinario', superior: 'Superior', normal: 'Normal', inferior: 'Inferior' };
  return <span className={`badge ${tier}`}>{label[tier]}</span>;
}

export function Thumb({ src, alt }: { src?: string | null; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <div className="thumb">Sin portada</div>;
  return <img className="thumb" src={src} alt={alt} onError={() => setBroken(true)} loading="lazy" />;
}

export function ChartTooltip({ active, payload, label, format }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tt">
      {label !== undefined && <div style={{ marginBottom: 4, color: COLORS.text }}>{label}</div>}
      {payload.map((p: any) => (
        <div key={p.dataKey ?? p.name} style={{ color: p.color || p.fill }}>
          {p.name}: <strong>{format ? format(p.value, p) : p.value === null ? NR : typeof p.value === 'number' ? p.value.toLocaleString('es-ES', { maximumFractionDigits: 2 }) : p.value}</strong>
        </div>
      ))}
    </div>
  );
}

export function download(filename: string, content: string | Blob, type = 'text/csv;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]) {
  if (!rows.length) return '';
  const cols = columns || Object.keys(rows[0]);
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

import { RATE_METRICS } from '../../shared/metrics';

export const NR = 'No registrado';

export function fmtInt(x: number | null | undefined) {
  return x === null || x === undefined ? NR : Math.round(x).toLocaleString('es-ES');
}
export function fmtPct(x: number | null | undefined, digits = 2) {
  return x === null || x === undefined ? NR : `${x.toLocaleString('es-ES', { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`;
}
export function fmtSec(x: number | null | undefined) {
  return x === null || x === undefined ? NR : `${x.toLocaleString('es-ES', { maximumFractionDigits: 1 })} s`;
}
export function fmtMetric(metric: string, x: number | null | undefined) {
  if (RATE_METRICS.has(metric)) return fmtPct(x);
  if (metric.includes('watch_time')) return fmtSec(x);
  if (metric === 'score') return x === null || x === undefined ? NR : x.toFixed(2);
  return fmtInt(x);
}
export function fmtDate(x: string | null | undefined, withTime = false) {
  if (!x) return NR;
  const d = new Date(x);
  return withTime
    ? d.toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}
export function fmtHours(h: number | null | undefined) {
  if (h === null || h === undefined) return NR;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} h`;
  return `${(h / 24).toFixed(1)} días`;
}
export function delta(cur: number | null | undefined, prev: number | null | undefined) {
  if (cur === null || cur === undefined || prev === null || prev === undefined || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}
/** Convierte un ISO a valor para <input type="datetime-local"> en la zona local. */
export function toLocalInput(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fromLocalInput(v: string) {
  return v ? new Date(v).toISOString() : null;
}
export const TIER_LABEL: Record<string, string> = {
  extraordinario: 'Extraordinario', superior: 'Superior al promedio', normal: 'Normal', inferior: 'Inferior al promedio',
};

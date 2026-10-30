import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { METRIC_LABELS } from '../../shared/metrics';
import { fmtDate, fmtMetric, NR } from './format';

const DEEP: [number, number, number] = [11, 42, 107];
const ELECTRIC: [number, number, number] = [59, 116, 255];
const CYAN: [number, number, number] = [34, 211, 238];
const INK: [number, number, number] = [20, 28, 45];
const GREY: [number, number, number] = [110, 120, 140];

// Las fuentes estándar de PDF solo cubren Latin-1: se sustituyen los símbolos que no existen en ella.
const clean = (s: unknown) => String(s ?? '')
  .replace(/[≤]/g, '<=').replace(/[≥]/g, '>=').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[≈]/g, '~')
  .replace(/[→]/g, '->').replace(/[▲]/g, '+').replace(/[▼]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x00-\xFF]/g, '');

export class Report {
  doc = new jsPDF({ unit: 'pt', format: 'a4' });
  y = 0;
  w = this.doc.internal.pageSize.getWidth();
  h = this.doc.internal.pageSize.getHeight();
  m = 40;

  constructor(title: string, subtitle: string) {
    const d = this.doc;
    d.setFillColor(...DEEP);
    d.rect(0, 0, this.w, 86, 'F');
    d.setFillColor(...CYAN);
    d.rect(0, 86, this.w, 3, 'F');
    d.setTextColor(255, 255, 255);
    d.setFont('helvetica', 'bold');
    d.setFontSize(18);
    d.text(clean(title), this.m, 40);
    d.setFont('helvetica', 'normal');
    d.setFontSize(10);
    d.text(clean(subtitle), this.m, 60);
    d.text(clean(`Generado el ${new Date().toLocaleString('es-ES')} · Mundo Curioso Analytics`), this.m, 75);
    this.y = 112;
  }
  ensure(space: number) {
    if (this.y + space > this.h - 50) { this.doc.addPage(); this.y = 50; }
  }
  heading(t: string) {
    this.ensure(40);
    this.doc.setTextColor(...DEEP);
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(13);
    this.doc.text(clean(t), this.m, this.y);
    this.y += 16;
  }
  para(t: string, opts: { size?: number; color?: [number, number, number] } = {}) {
    const d = this.doc;
    d.setFont('helvetica', 'normal');
    d.setFontSize(opts.size ?? 10);
    d.setTextColor(...(opts.color ?? INK));
    const lines = d.splitTextToSize(clean(t), this.w - this.m * 2);
    for (const l of lines) { this.ensure(14); d.text(l, this.m, this.y); this.y += (opts.size ?? 10) * 1.4; }
    this.y += 4;
  }
  bullets(items: string[]) {
    for (const it of items) this.para(`•  ${it}`);
  }
  table(head: string[], body: (string | number)[][]) {
    autoTable(this.doc, {
      startY: this.y, head: [head.map(clean)], body: body.map((r) => r.map(clean)), margin: { left: this.m, right: this.m },
      styles: { fontSize: 8.5, cellPadding: 4, textColor: INK }, headStyles: { fillColor: ELECTRIC, textColor: 255 },
      alternateRowStyles: { fillColor: [244, 247, 252] },
    });
    this.y = (this.doc as any).lastAutoTable.finalY + 16;
  }
  /** Gráfico de barras horizontal dibujado directamente en el PDF. */
  bars(title: string, data: { label: string; value: number | null }[], format: (v: number) => string) {
    const valid = data.filter((d) => d.value !== null) as { label: string; value: number }[];
    if (!valid.length) return;
    const rowH = 16;
    this.ensure(30 + valid.length * rowH);
    const d = this.doc;
    d.setFont('helvetica', 'bold'); d.setFontSize(10); d.setTextColor(...INK);
    d.text(clean(title), this.m, this.y); this.y += 12;
    const labelW = 170;
    const max = Math.max(...valid.map((v) => v.value), 1);
    const barMax = this.w - this.m * 2 - labelW - 60;
    d.setFont('helvetica', 'normal'); d.setFontSize(8.5);
    for (const v of valid) {
      const label = clean(v.label);
      d.setTextColor(...INK);
      d.text(label.length > 34 ? `${label.slice(0, 33)}...` : label, this.m, this.y + 10);
      d.setFillColor(...ELECTRIC);
      d.rect(this.m + labelW, this.y + 2, Math.max(1, (v.value / max) * barMax), 10, 'F');
      d.setTextColor(...GREY);
      d.text(clean(format(v.value)), this.m + labelW + Math.max(1, (v.value / max) * barMax) + 4, this.y + 10);
      this.y += rowH;
    }
    this.y += 10;
  }
  save(name: string) {
    const pages = this.doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      this.doc.setPage(i);
      this.doc.setFontSize(8); this.doc.setTextColor(...GREY);
      this.doc.text(`${i} / ${pages}`, this.w - this.m, this.h - 20, { align: 'right' });
      this.doc.text('Valores "No registrado" = dato no disponible. Las métricas calculadas y la retención aproximada no son cifras oficiales de Instagram.'.replace(/[^\x00-\xFF]/g, ''), this.m, this.h - 20);
    }
    this.doc.save(name);
  }
}

export function videoReportPdf(v: any, cmp: any) {
  const r = new Report(`Informe de video: ${v.title}`, `${v.category ?? 'Sin categoría'} · publicado ${fmtDate(v.published_at, true)}`);
  r.heading('Información general');
  const c = v.creative || {};
  r.table(['Campo', 'Valor'], [
    ['URL', v.instagram_url ?? NR], ['Duración', v.duration_seconds ? `${v.duration_seconds} s` : NR], ['Estado', v.status],
    ['Hook', c.hook_type ?? NR], ['Storytelling', c.storytelling_structure ?? NR], ['Estilo visual', c.visual_style ?? NR],
    ['Animación', c.animation_type ?? NR], ['Code Art', c.uses_code_art == null ? NR : c.uses_code_art ? 'Sí' : 'No'], ['2D/3D', c.dimension ?? NR],
    ['Música', c.music_type ?? NR], ['Voz en off', c.has_voiceover == null ? NR : c.has_voiceover ? 'Sí' : 'No'], ['Mediciones registradas', String(v.snapshots.length)],
  ]);
  if (cmp?.comparison) {
    r.heading('Rendimiento frente a la cuenta');
    r.table(['Métrica', 'Este video', 'Mediana cuenta', 'Percentil'], cmp.comparison.map((m: any) => [
      m.label, fmtMetric(m.metric, m.value), fmtMetric(m.metric, m.account_median), m.percentile === null ? NR : `P${Math.round(m.percentile)}`,
    ]));
    const strong = cmp.comparison.filter((m: any) => m.percentile !== null && m.percentile >= 75).map((m: any) => m.label.toLowerCase());
    const weak = cmp.comparison.filter((m: any) => m.percentile !== null && m.percentile <= 25).map((m: any) => m.label.toLowerCase());
    r.heading('Conclusiones');
    const out: string[] = [];
    if (strong.length) out.push(`Destaca (cuartil superior de la cuenta) en: ${strong.join(', ')}.`);
    if (weak.length) out.push(`Por debajo de lo habitual (cuartil inferior) en: ${weak.join(', ')}.`);
    if (!out.length) out.push('No hay suficientes videos con datos para situar este video en la distribución de la cuenta, o su rendimiento es intermedio en todas las métricas.');
    r.bullets(out);
  }
  if (v.snapshots.length) {
    r.heading('Evolución de las mediciones');
    r.table(['Fecha', 'Horas', 'Reprod.', 'Alcance', 'Me gusta', 'Compart.', 'Guard.', 'Seguid.'], v.snapshots.map((s: any) => [
      fmtDate(s.captured_at, true), s.hours_since_publish === null ? NR : s.hours_since_publish.toFixed(1),
      ...['views', 'reach', 'likes', 'shares', 'saves', 'follows'].map((k) => fmtMetric(k, s[k])),
    ]));
    r.bars('Reproducciones por medición', v.snapshots.map((s: any) => ({ label: fmtDate(s.captured_at, true), value: s.views })), (x) => fmtMetric('views', x));
  }
  if (v.notes?.length) { r.heading('Notas de producción'); r.bullets(v.notes.map((n: any) => `${fmtDate(n.created_at)}: ${n.note}`)); }
  r.save(`informe-${v.title.slice(0, 40).replace(/[^\w-]+/g, '-')}.pdf`);
}

export interface PeriodReportData {
  label: string;
  from: string;
  to: string;
  overview: any;
  ranking: any;
  patterns: any[];
  recommendations: any[];
  conclusions: string[];
  kpis: { label: string; cur: number | null; prev: number | null; metric: string }[];
}

export function periodReportPdf(d: PeriodReportData) {
  const r = new Report(`Informe ${d.label} · Mundo Curioso`, `${fmtDate(d.from)} - ${fmtDate(new Date(new Date(d.to).getTime() - 1).toISOString())} · comparado con el periodo anterior equivalente`);
  r.heading('Indicadores');
  r.table(['Indicador', 'Periodo', 'Anterior', 'Variación'], d.kpis.map((k) => [
    k.label, fmtMetric(k.metric, k.cur), fmtMetric(k.metric, k.prev),
    k.cur !== null && k.prev !== null && k.prev !== 0 ? `${(((k.cur - k.prev) / Math.abs(k.prev)) * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %` : '-',
  ]));
  r.heading('Conclusiones');
  r.bullets(d.conclusions);
  const items = d.ranking?.items || [];
  if (items.length) {
    r.heading('Videos del periodo');
    r.bars('Reproducciones por video (medición más reciente)', items.slice(0, 12).map((i: any) => ({ label: i.title, value: i.snapshot?.views ?? null })), (x) => fmtMetric('views', x));
    r.table(['Video', 'Fecha', 'Alcance', 'Reprod.', 'ER', 'Compart.', 'Guard.', 'Nivel'], items.map((i: any) => [
      i.title, fmtDate(i.published_at), fmtMetric('reach', i.snapshot?.reach), fmtMetric('views', i.snapshot?.views), fmtMetric('engagement_rate', i.derived?.engagement_rate),
      fmtMetric('shares', i.snapshot?.shares), fmtMetric('saves', i.snapshot?.saves), i.tier ?? 'Sin clasificar',
    ]));
  }
  if (d.patterns.length) { r.heading('Patrones activos (asociaciones, no causalidad)'); r.bullets(d.patterns.map((p) => p.statement)); }
  if (d.recommendations.length) { r.heading('Recomendaciones pendientes'); r.bullets(d.recommendations.map((x) => x.text)); }
  r.save(`informe-${d.label.toLowerCase()}-${d.from.slice(0, 10)}.pdf`);
}

export { METRIC_LABELS };

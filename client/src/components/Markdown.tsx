import type { ReactNode } from 'react';

/** Markdown mínimo (títulos, listas, negrita, cursiva, código) renderizado como elementos de React, sin HTML crudo. */
function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0, m: RegExpExecArray | null, i = key;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) out.push(<strong key={i++}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={i++}>{t.slice(1, -1)}</code>);
    else out.push(<em key={i++}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flush = () => {
    if (para.length) { blocks.push(<p key={blocks.length}>{inline(para.join(' '))}</p>); para = []; }
    if (list) {
      const items = list.items.map((it, j) => <li key={j}>{inline(it)}</li>);
      blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
      list = null;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (!line.trim()) { flush(); continue; }
    if (/^-{3,}$/.test(line.trim())) { flush(); blocks.push(<hr key={blocks.length} />); continue; }
    if (h) { flush(); const lvl = Math.min(4, h[1].length + 1); const Tag = `h${lvl}` as 'h2'; blocks.push(<Tag key={blocks.length}>{inline(h[2])}</Tag>); continue; }
    if (ul || ol) {
      if (para.length) { blocks.push(<p key={blocks.length}>{inline(para.join(' '))}</p>); para = []; }
      const ordered = !!ol;
      if (list && list.ordered !== ordered) flush();
      if (!list) list = { ordered, items: [] };
      list.items.push((ul || ol)![1]);
      continue;
    }
    if (list) flush();
    para.push(line.trim());
  }
  flush();
  return <div className="md">{blocks}</div>;
}

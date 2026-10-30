import { useMemo, useState } from 'react';
import { Seg } from './ui';

export type PeriodKey = '7' | '30' | '90' | '180' | '365' | 'custom';
export const PERIODS: { value: PeriodKey; label: string }[] = [
  { value: '7', label: '7 días' }, { value: '30', label: '30 días' }, { value: '90', label: '90 días' },
  { value: '180', label: '6 meses' }, { value: '365', label: '1 año' }, { value: 'custom', label: 'Personalizado' },
];

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Devuelve un rango [from, to) en ISO. El día final se incluye completo. */
export function usePeriod(initial: PeriodKey = '30') {
  const [key, setKey] = useState<PeriodKey>(initial);
  const today = new Date();
  const [custom, setCustom] = useState({ from: day(new Date(today.getTime() - 29 * 86400_000)), to: day(today) });
  const range = useMemo(() => {
    if (key === 'custom') {
      const from = new Date(`${custom.from}T00:00:00`);
      const to = new Date(`${custom.to}T00:00:00`);
      to.setDate(to.getDate() + 1);
      return { from: from.toISOString(), to: to.toISOString() };
    }
    const to = new Date();
    to.setHours(0, 0, 0, 0);
    to.setDate(to.getDate() + 1);
    const from = new Date(to.getTime() - Number(key) * 86400_000);
    return { from: from.toISOString(), to: to.toISOString() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, custom.from, custom.to]);
  const picker = (
    <div className="row">
      <Seg value={key} options={PERIODS} onChange={setKey} />
      {key === 'custom' && (
        <>
          <input type="date" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} aria-label="Desde" />
          <span className="muted">a</span>
          <input type="date" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} aria-label="Hasta" />
        </>
      )}
    </div>
  );
  return { key, range, picker };
}

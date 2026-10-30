import { useState } from 'react';
import { Seg } from './ui';

export type Basis = 'latest' | '24h' | '7d' | '30d';
export function useBasis() {
  const [basis, setBasis] = useState<Basis>('latest');
  const picker = (
    <div className="row">
      <span className="small muted">Comparar con</span>
      <Seg value={basis} onChange={setBasis} options={[
        { value: 'latest', label: 'Última medición' }, { value: '24h', label: '≈24 h' }, { value: '7d', label: '≈7 días' }, { value: '30d', label: '≈30 días' },
      ]} />
    </div>
  );
  return { basis, picker };
}
export const BASIS_NOTE = 'Con «≈24 h», «≈7 días» o «≈30 días» se usa la medición más cercana a ese momento tras la publicación (±25 %), para comparar videos de distinta antigüedad en igualdad de condiciones. Los videos sin una medición en esa ventana quedan fuera.';

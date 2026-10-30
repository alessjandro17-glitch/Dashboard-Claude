import { useState } from 'react';
import { PageHead, Tabs } from '../components/ui';
import { useBasis, BASIS_NOTE } from '../components/basis';
import { GroupAnalysis } from '../components/GroupAnalysis';
import { PatternList } from './Intelligence';

function DimensionPage({ title, sub, dims }: { title: string; sub: string; dims: { value: string; label: string; metric?: string }[] }) {
  const [dim, setDim] = useState(dims[0].value);
  const { basis, picker } = useBasis();
  const current = dims.find((d) => d.value === dim)!;
  return (
    <>
      <PageHead title={title} sub={sub}>{picker}</PageHead>
      <Tabs value={dim} onChange={setDim} options={dims} />
      <GroupAnalysis key={dim + basis} dimension={dim} basis={basis} defaultMetric={current.metric} />
      <p className="legend-note">{BASIS_NOTE}</p>
      <div className="section-gap"><PatternList dimensions={dims.map((d) => d.value)} title="Patrones detectados en estas variables" /></div>
    </>
  );
}

export function HooksPage() {
  return <DimensionPage title="Hooks y storytelling" sub="Qué hooks, estilos narrativos y estructuras se asocian a mejores resultados en la cuenta."
    dims={[
      { value: 'hook_type', label: 'Tipo de hook', metric: 'retention_approx' },
      { value: 'narrative_style', label: 'Estilo narrativo' },
      { value: 'storytelling_structure', label: 'Estructura' },
      { value: 'narrative_pace', label: 'Velocidad narrativa', metric: 'retention_approx' },
      { value: 'has_voiceover', label: 'Voz en off' },
    ]} />;
}

export function VisualPage() {
  return <DimensionPage title="Estilos visuales" sub="Estilo visual, animación, Code Art, 2D/3D, música y composición."
    dims={[
      { value: 'visual_style', label: 'Estilo visual' },
      { value: 'animation_type', label: 'Animación' },
      { value: 'uses_code_art', label: 'Code Art' },
      { value: 'dimension', label: '2D / 3D', metric: 'save_rate' },
      { value: 'music_type', label: 'Música' },
      { value: 'color_composition', label: 'Colores y composición' },
      { value: 'production_complexity', label: 'Complejidad' },
    ]} />;
}

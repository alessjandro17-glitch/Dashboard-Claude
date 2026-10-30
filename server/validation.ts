import { z } from 'zod';

const nullableText = z.string().trim().transform((v) => (v === '' ? null : v)).nullable().optional();
const count = z.number().int('Debe ser un número entero').min(0, 'No puede ser negativo').nullable().optional();
const nonNeg = z.number().min(0, 'No puede ser negativo').nullable().optional();
const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Fecha u hora no válida');
const uuid = z.string().uuid('Identificador no válido');

export const VIDEO_STATUSES = ['idea', 'borrador', 'programado', 'publicado', 'archivado'] as const;
export const DIMENSIONS = ['2D', '3D', '2D+3D', 'ninguno'] as const;

export const creativeSchema = z.object({
  hook_type: nullableText,
  narrative_style: nullableText,
  storytelling_structure: nullableText,
  visual_style: nullableText,
  animation_type: nullableText,
  uses_code_art: z.boolean().nullable().optional(),
  dimension: z.enum(DIMENSIONS).nullable().optional(),
  music_type: nullableText,
  has_voiceover: z.boolean().nullable().optional(),
  narrative_pace: nullableText,
  scene_count: count,
  production_complexity: z.number().int().min(1).max(5).nullable().optional(),
  color_composition: nullableText,
});

export const videoSchema = z.object({
  title: z.string().trim().min(1, 'El nombre del video es obligatorio'),
  instagram_url: z.string().trim().url('URL no válida').refine((u) => /instagram\.com\//i.test(u), 'Debe ser una URL de instagram.com').nullable().optional().or(z.literal('').transform(() => null)),
  instagram_media_id: nullableText,
  published_at: isoDate.nullable().optional(),
  duration_seconds: z.number().positive('La duración debe ser mayor que 0').nullable().optional(),
  category_id: uuid.nullable().optional(),
  subcategory_id: uuid.nullable().optional(),
  status: z.enum(VIDEO_STATUSES).default('publicado'),
  thumbnail_url: z.string().trim().url('URL no válida').nullable().optional().or(z.literal('').transform(() => null)),
  description: nullableText,
  script: nullableText,
  creative: creativeSchema.optional(),
});

export const SNAPSHOT_FIELDS = [
  'views', 'reach', 'impressions', 'total_watch_time_seconds', 'avg_watch_time_seconds',
  'likes', 'comments', 'shares', 'saves', 'profile_visits', 'follows',
] as const;

export const snapshotSchema = z.object({
  captured_at: isoDate,
  source: z.enum(['manual', 'csv', 'instagram']).default('manual'),
  views: count,
  reach: count,
  impressions: count,
  total_watch_time_seconds: nonNeg,
  avg_watch_time_seconds: nonNeg,
  likes: count,
  comments: count,
  shares: count,
  saves: count,
  profile_visits: count,
  follows: count,
  notes: nullableText,
}).refine((s) => SNAPSHOT_FIELDS.some((f) => s[f] !== null && s[f] !== undefined), 'Registra al menos una métrica en la medición');

export const accountMetricSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha con formato AAAA-MM-DD'),
  followers_count: count,
  new_followers: z.number().int().nullable().optional(),
  reach: count,
  impressions: count,
  views: count,
  profile_visits: count,
  source: z.enum(['manual', 'csv', 'instagram']).default('manual'),
  notes: nullableText,
});

export const categorySchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio'),
  parent_id: uuid.nullable().optional(),
  description: nullableText,
});

export const EXPERIMENT_VARIABLES = ['hook', 'duracion', 'tematica', 'ritmo', 'animacion', 'color_composicion', 'musica', 'storytelling', 'otro'] as const;

export const experimentSchema = z.object({
  title: z.string().trim().min(1, 'El título es obligatorio'),
  hypothesis: z.string().trim().min(1, 'La hipótesis es obligatoria'),
  variable: z.enum(EXPERIMENT_VARIABLES),
  primary_metric: z.string().min(1),
  control_description: nullableText,
  variant_description: nullableText,
  controlled_factors: nullableText,
  uncontrolled_factors: nullableText,
  status: z.enum(['planificado', 'en_curso', 'concluido', 'descartado']).default('planificado'),
  verdict: z.enum(['respaldada', 'no_respaldada', 'no_concluyente']).nullable().optional(),
  conclusion: nullableText,
  videos: z.array(z.object({ video_id: uuid, arm: z.enum(['control', 'variante']) })).default([]),
});

export const decisionSchema = z.object({
  title: z.string().trim().min(1, 'El título es obligatorio'),
  description: nullableText,
  recommendation_id: uuid.nullable().optional(),
  experiment_id: uuid.nullable().optional(),
  decided_at: isoDate.optional(),
  outcome: nullableText,
});

export function formatZodError(e: z.ZodError) {
  return e.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
}

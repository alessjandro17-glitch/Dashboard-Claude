import { z } from 'zod';
import type { Db } from './db.js';
import { formatZodError, creativeSchema } from './validation.js';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}

export function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, 'Datos no válidos', formatZodError(r.error));
  return r.data;
}

const CREATIVE_FIELDS = Object.keys(creativeSchema.shape);

export async function upsertCreative(c: { query: Db['query'] }, videoId: string, creative: Record<string, unknown> | undefined) {
  if (!creative) return;
  const cols = CREATIVE_FIELDS.filter((f) => f in creative);
  if (!cols.length) return;
  await c.query(
    `insert into video_creative_attributes (video_id, ${cols.join(',')}) values ($1, ${cols.map((_, i) => `$${i + 2}`).join(',')})
     on conflict (video_id) do update set ${cols.map((f) => `${f} = excluded.${f}`).join(', ')}, updated_at = now()`,
    [videoId, ...cols.map((f) => creative[f] ?? null)]);
}


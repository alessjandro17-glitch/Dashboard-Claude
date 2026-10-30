import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Las columnas NUMERIC y BIGINT llegan como texto en node-postgres: se convierten a número.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('Falta la variable DATABASE_URL.');
  const ssl = /supabase\.(co|com)|sslmode=require/.test(connectionString) ? { rejectUnauthorized: false } : undefined;
  return new pg.Pool({ connectionString, ssl, max: 10 });
}

export type Db = pg.Pool;

export async function migrate(db: Db) {
  await db.query(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const dir = path.join(here, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await db.query<{ name: string }>('select name from schema_migrations');
  const done = new Set(rows.map((r) => r.name));
  for (const f of files) {
    if (done.has(f)) continue;
    const client = await db.connect();
    try {
      await client.query('begin');
      await client.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await client.query('insert into schema_migrations (name) values ($1)', [f]);
      await client.query('commit');
      console.log(`Migración aplicada: ${f}`);
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }
}

/** La cuenta es configuración, no datos de rendimiento: se crea con el handle configurado y nada más. */
export async function ensureAccount(db: Db, handle = process.env.ACCOUNT_HANDLE || 'mundo.curioso13') {
  const { rows } = await db.query('select * from accounts order by created_at limit 1');
  if (rows[0]) return rows[0];
  const r = await db.query('insert into accounts (handle, display_name) values ($1, $2) returning *', [handle, 'Mundo Curioso']);
  return r.rows[0];
}

export async function audit(db: Db | pg.PoolClient, entity: string, entityId: string, action: string, changes?: unknown) {
  await db.query('insert into audit_log (entity, entity_id, action, changes) values ($1,$2,$3,$4)', [entity, entityId, action, changes ? JSON.stringify(changes) : null]);
}

export async function tx<T>(db: Db, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query('begin');
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

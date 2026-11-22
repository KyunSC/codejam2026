import { Pool, PoolClient, types } from "pg";

// numeric → number, date → 'YYYY-MM-DD' string
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
types.setTypeParser(1082, (v) => v);

const g = globalThis as unknown as { pgPool?: Pool };
export const pool = g.pgPool ?? new Pool({ connectionString: process.env.DATABASE_URL });
g.pgPool = pool;

export type Db = Pool | PoolClient;
export type PoolClientLike = Db;

export async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T[]> {
  const res = await db.query(sql, params);
  return res.rows as T[];
}

export async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T | null> {
  const rows = await query<T>(sql, params, db);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

export async function nextId(prefix: string, db: Db = pool): Promise<string> {
  const row = await one<{ n: string }>("SELECT nextval('id_seq') AS n", [], db);
  return `${prefix}-${row!.n}`;
}

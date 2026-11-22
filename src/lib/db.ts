import { Pool, PoolClient, types } from "pg";

// numeric → number, date → 'YYYY-MM-DD' string
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
types.setTypeParser(1082, (v) => v);

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// An idle connection the database closed (a restart, the reset script) is dropped; the pool opens a new one on the next query.
pool.on("error", (e) => console.error("idle database connection closed:", e.message));

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

// How each kind of record is numbered: the dataset's own formats (V001, AP-00001, PAY-00001…), continued from the highest number in use.
const ID_FORMATS: Record<string, { table: string; column: string; prefix: () => string; width: number }> = {
  ORG: { table: "organizations", column: "organization_id", prefix: () => "ORG-", width: 3 },
  U: { table: "users", column: "user_id", prefix: () => "U", width: 3 },
  V: { table: "vendors", column: "vendor_id", prefix: () => "V", width: 3 },
  BC: { table: "vendor_bank_changes", column: "change_id", prefix: () => "BC-", width: 3 },
  RAW: { table: "raw_items", column: "raw_item_id", prefix: () => "RAW-", width: 4 },
  PRS: { table: "parsed_invoices", column: "parsed_invoice_id", prefix: () => "PRS-", width: 4 },
  FLG: { table: "invoice_flags", column: "flag_id", prefix: () => "FLG-", width: 4 },
  INV: { table: "invoices", column: "invoice_id", prefix: () => "AP-", width: 5 },
  APR: { table: "approvals", column: "approval_id", prefix: () => "AP-A-", width: 5 },
  PAY: { table: "payments", column: "payment_id", prefix: () => "PAY-", width: 5 },
  D: { table: "departments", column: "department_id", prefix: () => "D", width: 2 },
  GL: { table: "gl_accounts", column: "account_number", prefix: () => "", width: 4 },
  C: { table: "contracts", column: "contract_id", prefix: () => "C", width: 3 },
  PO: { table: "purchase_orders", column: "po_id", prefix: () => `PO-${new Date().getFullYear()}-`, width: 4 },
  P: { table: "approval_policies", column: "rule_id", prefix: () => "P", width: 2 },
  TOK: { table: "api_tokens", column: "token_id", prefix: () => "TOK-", width: 4 },
};

// Call inside a transaction: the lock keeps two inserts from taking the same number.
export async function nextId(kind: string, db: Db = pool): Promise<string> {
  const f = ID_FORMATS[kind];
  const prefix = f.prefix();
  await query("SELECT pg_advisory_xact_lock(hashtext($1))", [f.table], db);
  const row = await one<{ n: number }>(
    `SELECT COALESCE(max(substring(${f.column} from ${prefix.length + 1})::int), 0) + 1 AS n FROM ${f.table} WHERE ${f.column} ~ $1`,
    [`^${prefix.replace(/[-]/g, "\\-")}[0-9]+$`],
    db,
  );
  return prefix + String(row!.n).padStart(f.width, "0");
}

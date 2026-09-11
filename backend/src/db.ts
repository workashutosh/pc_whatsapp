import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";

export interface QueryResult<T> {
  rows: T[];
}

const dataDir = dirname(config.sqlitePath);
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(config.sqlitePath);
db.exec("PRAGMA foreign_keys = ON");
db.function("uuid", () => randomUUID());
db.function("now_iso", () => new Date().toISOString());

function rewriteSql(sql: string): string {
  return sql
    .replace(/payload->>'text'/g, "json_extract(payload, '$.text')")
    .replace(/0::int/g, "0")
    .replace(/COUNT\(\*\)::text/g, "CAST(COUNT(*) AS TEXT)")
    .replace(/\bnow\(\)/g, "now_iso()")
    .replace(/NULLS LAST/g, "");
}

function bindParam(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === undefined) return null;
  return value;
}

function toSqlite(sql: string, params: unknown[]): { sql: string; params: unknown[] } {
  const mapped: unknown[] = [];
  const converted = rewriteSql(sql).replace(/\$(\d+)/g, (_, raw: string) => {
    mapped.push(bindParam(params[Number(raw) - 1]));
    return "?";
  });
  return { sql: converted, params: mapped };
}

function hydrate<T>(row: Record<string, unknown> | undefined): T {
  if (!row) return row as T;
  const next = { ...row };
  if (typeof next.payload === "string") {
    try {
      next.payload = JSON.parse(next.payload);
    } catch {
      // keep raw string
    }
  }
  return next as T;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  const converted = toSqlite(text, params);
  try {
    const stmt = db.prepare(converted.sql);
    const returnsRows = /^\s*(SELECT|WITH|RETURNING)\b/i.test(converted.sql) || /\bRETURNING\b/i.test(converted.sql);
    if (returnsRows) {
      const rows = stmt.all(...converted.params) as Record<string, unknown>[];
      return { rows: rows.map((row) => hydrate<T>(row)) };
    }
    stmt.run(...converted.params);
    return { rows: [] };
  } catch (error) {
    console.error("SQL failed:", converted.sql, converted.params);
    throw error;
  }
}

export async function withTransaction<T>(
  fn: (client: { query: typeof query }) => Promise<T>,
): Promise<T> {
  db.exec("BEGIN");
  try {
    const result = await fn({ query });
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string }).code ?? "";
  const message = error instanceof Error ? error.message : String(error);
  return (
    code === "23505" ||
    message.includes("UNIQUE constraint") ||
    (code.includes("SQLITE") && message.includes("UNIQUE"))
  );
}

export async function migrateAndSeed(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const schema = readFileSync(join(here, "schema.sql"), "utf8");
  db.exec(schema);
  try {
    db.exec("ALTER TABLE conversations ADD COLUMN customer_jid TEXT");
  } catch {
    // already present on existing databases
  }

  if (!config.demoMode) {
    await query(
      `UPDATE whatsapp_connections
       SET status = 'disconnected'
       WHERE provider = 'demo' AND status IN ('pending', 'connected')`,
    );
  }

  const { rows } = await query<{ count: string }>("SELECT CAST(COUNT(*) AS TEXT) AS count FROM tenants");
  if (Number(rows[0]?.count ?? 0) > 0) {
    return;
  }

  await query(
    `INSERT INTO tenants (name, assignment_mode)
     VALUES ($1, $2)`,
    ["Acme Support", config.assignmentMode],
  );
  const tenant = await query<{ id: string }>("SELECT id FROM tenants WHERE name = $1", ["Acme Support"]);
  const tenantId = tenant.rows[0].id;
  await query(
    `INSERT INTO agents (tenant_id, name, email)
     VALUES
       ($1, 'Alice Sharma', 'alice@acme.test'),
       ($1, 'Bob Fernandes', 'bob@acme.test')`,
    [tenantId],
  );

  console.log("Seeded demo tenant Acme Support (alice@acme.test / bob@acme.test)");
}

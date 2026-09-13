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
  for (const statement of [
    "ALTER TABLE conversations ADD COLUMN customer_jid TEXT",
    "ALTER TABLE tenants ADD COLUMN agents_can_see_phone INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE agents ADD COLUMN role TEXT NOT NULL DEFAULT 'agent'",
    "ALTER TABLE agents ADD COLUMN password_hash TEXT",
    "ALTER TABLE agents ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
    "ALTER TABLE agents ADD COLUMN disabled_at TEXT",
    "ALTER TABLE tenants ADD COLUMN allow_all_ips INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE tenants ADD COLUMN agents_can_see_history INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE conversations ADD COLUMN assigned_at TEXT",
    "ALTER TABLE conversations ADD COLUMN assignee_can_see_history INTEGER",
    `CREATE TABLE IF NOT EXISTS tenant_allowed_ips (
      id TEXT PRIMARY KEY DEFAULT (uuid()),
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      ip TEXT NOT NULL,
      created_at TEXT DEFAULT (now_iso()),
      UNIQUE (tenant_id, ip)
    )`,
  ]) {
    try {
      db.exec(statement);
    } catch {
      // already present on existing databases
    }
  }

  if (!config.demoMode) {
    await query(
      `UPDATE whatsapp_connections
       SET status = 'disconnected'
       WHERE provider = 'demo' AND status IN ('pending', 'connected')`,
    );
  }

  const { rows } = await query<{ count: string }>("SELECT CAST(COUNT(*) AS TEXT) AS count FROM tenants");
  if (Number(rows[0]?.count ?? 0) === 0) {
    await query(
      `INSERT INTO tenants (name, assignment_mode, agents_can_see_phone)
       VALUES ($1, $2, 0)`,
      ["Acme Support", config.assignmentMode],
    );
  }

  const tenant = await query<{ id: string }>("SELECT id FROM tenants WHERE name = $1", ["Acme Support"]);
  const tenantId = tenant.rows[0]?.id;
  if (tenantId) {
    await ensureDemoAccounts(tenantId);
  }
}

async function ensureDemoAccounts(tenantId: string): Promise<void> {
  const { hashPassword } = await import("./inbox/password.js");
  const accounts = [
    { name: "Alice Sharma", email: "alice@acme.test", role: "super_admin", password: "AcmeAdmin!1" },
    { name: "Bob Fernandes", email: "bob@acme.test", role: "manager", password: "AcmeManager!1" },
    { name: "Riya Kapoor", email: "riya@acme.test", role: "agent", password: "AcmeAgent!1" },
  ];
  for (const account of accounts) {
    const existing = await query<{ id: string; password_hash: string | null }>(
      "SELECT id, password_hash FROM agents WHERE lower(email) = lower($1)",
      [account.email],
    );
    const passwordHash = await hashPassword(account.password);
    if (existing.rows[0]) {
      await query(
        `UPDATE agents
         SET role = $2, status = 'active', disabled_at = NULL, password_hash = $3
         WHERE id = $1`,
        [existing.rows[0].id, account.role, passwordHash],
      );
    } else {
      await query(
        `INSERT INTO agents (tenant_id, name, email, role, password_hash, status)
         VALUES ($1, $2, $3, $4, $5, 'active')`,
        [tenantId, account.name, account.email, account.role, passwordHash],
      );
    }
  }
  console.log(
    "Demo accounts: alice@acme.test / AcmeAdmin!1 · bob@acme.test / AcmeManager!1 · riya@acme.test / AcmeAgent!1",
  );
}

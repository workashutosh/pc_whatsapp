import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
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

function bindParam(value: unknown): SQLInputValue {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === undefined) return null;
  return value as SQLInputValue;
}

function toSqlite(sql: string, params: unknown[]): { sql: string; params: SQLInputValue[] } {
  const mapped: SQLInputValue[] = [];
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
  // Columns added after the first release. Older databases get them here; fresh ones already have them from schema.sql.
  addColumnIfMissing("conversations", "customer_jid", "TEXT");
  addColumnIfMissing("tenants", "agents_can_see_phone", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("agents", "role", "TEXT NOT NULL DEFAULT 'agent'");
  addColumnIfMissing("agents", "password_hash", "TEXT");
  addColumnIfMissing("agents", "status", "TEXT NOT NULL DEFAULT 'active'");
  addColumnIfMissing("agents", "disabled_at", "TEXT");
  addColumnIfMissing("tenants", "allow_all_ips", "INTEGER NOT NULL DEFAULT 1");
  addColumnIfMissing("tenants", "agents_can_see_history", "INTEGER NOT NULL DEFAULT 1");
  addColumnIfMissing("conversations", "assigned_at", "TEXT");
  addColumnIfMissing("conversations", "assignee_can_see_history", "INTEGER");

  if (!config.demoMode) {
    await query(
      `UPDATE whatsapp_connections
       SET status = 'disconnected'
       WHERE provider = 'demo' AND status IN ('pending', 'connected')`,
    );
  }

  if (!config.seedDemoAccounts) return;

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
  // Only create missing accounts. Never overwrite passwords or roles an admin has since changed.
  for (const account of accounts) {
    const existing = await query<{ id: string }>(
      "SELECT id FROM agents WHERE lower(email) = lower($1)",
      [account.email],
    );
    if (existing.rows[0]) continue;
    await query(
      `INSERT INTO agents (tenant_id, name, email, role, password_hash, status)
       VALUES ($1, $2, $3, $4, $5, 'active')`,
      [tenantId, account.name, account.email, account.role, await hashPassword(account.password)],
    );
  }
  console.log(
    "Demo accounts: alice@acme.test / AcmeAdmin!1 · bob@acme.test / AcmeManager!1 · riya@acme.test / AcmeAgent!1",
  );
}

function addColumnIfMissing(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((item) => item.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

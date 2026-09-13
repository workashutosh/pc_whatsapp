import { query } from "../db.js";
import { hashPassword } from "./password.js";
import { canManageTarget, canSetRole, publicAgent } from "./policy.js";
import type { Agent, AgentRole, AgentStatus, Tenant } from "./types.js";

const DEMO_PASSWORDS: Record<string, string> = {
  "alice@acme.test": "AcmeAdmin!1",
  "bob@acme.test": "AcmeManager!1",
  "riya@acme.test": "AcmeAgent!1",
};

export async function getTenant(tenantId: string): Promise<Tenant | null> {
  const { rows } = await query<Tenant>("SELECT * FROM tenants WHERE id = $1", [tenantId]);
  return rows[0] ?? null;
}

export async function updateTenantSettings(
  tenantId: string,
  input: { agentsCanSeePhone?: boolean; agentsCanSeeHistory?: boolean },
): Promise<Tenant> {
  const current = await getTenant(tenantId);
  if (!current) {
    throw Object.assign(new Error("Tenant not found"), { status: 404 });
  }
  const seePhone = input.agentsCanSeePhone ?? Boolean(current.agents_can_see_phone);
  const seeHistory = input.agentsCanSeeHistory ?? (current.agents_can_see_history !== 0 && current.agents_can_see_history !== false);
  const { rows } = await query<Tenant>(
    `UPDATE tenants
     SET agents_can_see_phone = $2, agents_can_see_history = $3
     WHERE id = $1
     RETURNING *`,
    [tenantId, seePhone ? 1 : 0, seeHistory ? 1 : 0],
  );
  if (!rows[0]) {
    throw Object.assign(new Error("Tenant not found"), { status: 404 });
  }
  return rows[0];
}

export async function getAgentByEmail(email: string): Promise<(Agent & { tenant_name: string }) | null> {
  const { rows } = await query<Agent & { tenant_name: string }>(
    `SELECT a.*, t.name AS tenant_name
     FROM agents a
     JOIN tenants t ON t.id = a.tenant_id
     WHERE lower(a.email) = lower($1)`,
    [email],
  );
  return rows[0] ?? null;
}

export async function getAgentInTenant(agentId: string, tenantId: string): Promise<Agent | null> {
  const { rows } = await query<Agent>(
    "SELECT * FROM agents WHERE id = $1 AND tenant_id = $2",
    [agentId, tenantId],
  );
  return rows[0] ?? null;
}

export async function listAgents(
  tenantId: string,
  filter: { q?: string; role?: AgentRole | "all"; status?: AgentStatus | "all" } = {},
): Promise<Omit<Agent, "password_hash">[]> {
  const params: unknown[] = [tenantId];
  let where = "tenant_id = $1";
  if (filter.q?.trim()) {
    params.push(`%${filter.q.trim().toLowerCase()}%`);
    where += ` AND (lower(name) LIKE $${params.length} OR lower(email) LIKE $${params.length})`;
  }
  if (filter.role && filter.role !== "all") {
    params.push(filter.role);
    where += ` AND role = $${params.length}`;
  }
  if (filter.status && filter.status !== "all") {
    params.push(filter.status);
    where += ` AND status = $${params.length}`;
  }
  const { rows } = await query<Agent>(
    `SELECT * FROM agents WHERE ${where} ORDER BY name`,
    params,
  );
  return rows.map(publicAgent);
}

export async function createAgent(input: {
  actor: Agent;
  tenantId: string;
  name: string;
  email: string;
  password: string;
  role: AgentRole;
}): Promise<Omit<Agent, "password_hash">> {
  if (!canSetRole(input.actor, input.role)) {
    throw Object.assign(new Error("You cannot create that role"), { status: 403 });
  }
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  if (!name || !email || password.length < 8) {
    throw Object.assign(new Error("Name, email, and a password of at least 8 characters are required"), {
      status: 400,
    });
  }
  const passwordHash = await hashPassword(password);
  try {
    const { rows } = await query<Agent>(
      `INSERT INTO agents (tenant_id, name, email, role, password_hash, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       RETURNING *`,
      [input.tenantId, name, email, input.role, passwordHash],
    );
    return publicAgent(rows[0]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE")) {
      throw Object.assign(new Error("An account with that email already exists"), { status: 409 });
    }
    throw error;
  }
}

export async function updateAgent(input: {
  actor: Agent;
  tenantId: string;
  agentId: string;
  name?: string;
  email?: string;
  password?: string;
  role?: AgentRole;
  status?: AgentStatus;
}): Promise<Omit<Agent, "password_hash">> {
  const target = await getAgentInTenant(input.agentId, input.tenantId);
  if (!target) {
    throw Object.assign(new Error("Account not found"), { status: 404 });
  }
  if (!canManageTarget(input.actor, target)) {
    throw Object.assign(new Error("You cannot change this account"), { status: 403 });
  }
  if (input.role && !canSetRole(input.actor, input.role)) {
    throw Object.assign(new Error("You cannot assign that role"), { status: 403 });
  }
  if (input.status === "disabled") {
    await assertCanDisable(input.tenantId, target);
  }

  const name = input.name?.trim() ?? target.name;
  const email = input.email?.trim().toLowerCase() ?? target.email;
  const role = input.role ?? target.role;
  const status = input.status ?? target.status;
  const disabledAt = status === "disabled" ? target.disabled_at ?? new Date().toISOString() : null;
  const passwordHash = input.password
    ? await hashPassword(input.password)
    : target.password_hash;
  if (input.password && input.password.length < 8) {
    throw Object.assign(new Error("Password must be at least 8 characters"), { status: 400 });
  }

  const { rows } = await query<Agent>(
    `UPDATE agents
     SET name = $3, email = $4, role = $5, status = $6, disabled_at = $7, password_hash = $8
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [input.agentId, input.tenantId, name, email, role, status, disabledAt, passwordHash],
  );
  return publicAgent(rows[0]);
}

export async function countSuperAdmins(tenantId: string): Promise<number> {
  const { rows } = await query<{ count: string }>(
    `SELECT CAST(COUNT(*) AS TEXT) AS count
     FROM agents
     WHERE tenant_id = $1 AND role = 'super_admin' AND status = 'active'`,
    [tenantId],
  );
  return Number(rows[0]?.count ?? 0);
}

async function assertCanDisable(tenantId: string, target: Agent): Promise<void> {
  if (target.role !== "super_admin") return;
  const remaining = await countSuperAdmins(tenantId);
  if (remaining <= 1) {
    throw Object.assign(new Error("Cannot disable the last super admin"), { status: 409 });
  }
}

export { DEMO_PASSWORDS };

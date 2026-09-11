import { query } from "../db.js";
import type { Agent, Tenant } from "./types.js";

export async function getTenant(tenantId: string): Promise<Tenant | null> {
  const { rows } = await query<Tenant>("SELECT * FROM tenants WHERE id = $1", [tenantId]);
  return rows[0] ?? null;
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

export async function listAgents(tenantId: string): Promise<Agent[]> {
  const { rows } = await query<Agent>(
    "SELECT * FROM agents WHERE tenant_id = $1 ORDER BY name",
    [tenantId],
  );
  return rows;
}

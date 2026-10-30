import { createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";
import { query } from "../db.js";
import type { Agent } from "./types.js";

/** Opaque bearer tokens. Only a SHA-256 of the token is stored, so a leaked database cannot be replayed. */

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(agent: Pick<Agent, "id" | "tenant_id">): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3600_000).toISOString();
  await query(
    `INSERT INTO agent_sessions (token_hash, agent_id, tenant_id, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [hashToken(token), agent.id, agent.tenant_id, expiresAt],
  );
  return token;
}

export async function getSessionAgent(token: string): Promise<Agent | null> {
  if (!token) return null;
  const { rows } = await query<Agent>(
    `SELECT a.*
     FROM agent_sessions s
     JOIN agents a ON a.id = s.agent_id AND a.tenant_id = s.tenant_id
     WHERE s.token_hash = $1 AND s.expires_at > $2`,
    [hashToken(token), new Date().toISOString()],
  );
  return rows[0] ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  await query("DELETE FROM agent_sessions WHERE token_hash = $1", [hashToken(token)]);
}

export async function revokeAgentSessions(agentId: string): Promise<void> {
  await query("DELETE FROM agent_sessions WHERE agent_id = $1", [agentId]);
}

export async function purgeExpiredSessions(): Promise<void> {
  await query("DELETE FROM agent_sessions WHERE expires_at <= $1", [new Date().toISOString()]);
}

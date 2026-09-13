import { config } from "../config.js";
import { isPreferredJid } from "../core/phone.js";
import { query } from "../db.js";
import { emitToTenant } from "../realtime/bus.js";
import { getAgentInTenant, getTenant, listAgents } from "./agents.js";
import { assertAssignable, canSeeHistoryItem } from "./policy.js";
import type { AgentRole, Conversation, ConversationStatus } from "./types.js";

export interface ConversationListQuery {
  q?: string;
  status?: ConversationStatus | "all";
  assignedAgentId?: string | "unassigned" | "me" | "all";
}

export interface ConversationView extends Conversation {
  assigned_agent_name: string | null;
  locked_by_agent_name: string | null;
  last_message_text: string | null;
  unread_count: number;
}

const CONVERSATION_SELECT = `
  SELECT
    c.*,
    assigned.name AS assigned_agent_name,
    locker.name AS locked_by_agent_name,
    (
      SELECT CASE
        WHEN length(trim(coalesce(json_extract(m.payload, '$.text'), ''))) > 0
          THEN json_extract(m.payload, '$.text')
        WHEN json_extract(m.payload, '$.media.kind') = 'image' THEN 'Photo'
        ELSE json_extract(m.payload, '$.text')
      END
      FROM messages m
      WHERE m.conversation_id = c.id AND m.tenant_id = c.tenant_id
      ORDER BY m.created_at DESC
      LIMIT 1
    ) AS last_message_text,
    0 AS unread_count
  FROM conversations c
  LEFT JOIN agents assigned ON assigned.id = c.assigned_agent_id
  LEFT JOIN agents locker ON locker.id = c.locked_by_agent_id
`;

export async function listConversations(
  tenantId: string,
  actor: { id: string; role: AgentRole },
  filters: ConversationListQuery = {},
): Promise<ConversationView[]> {
  await releaseExpiredLocks(tenantId);
  const params: unknown[] = [tenantId];
  let where = "c.tenant_id = $1";

  if (actor.role === "agent") {
    params.push(actor.id);
    where += ` AND c.assigned_agent_id = $${params.length}`;
  } else if (filters.assignedAgentId === "unassigned") {
    where += " AND c.assigned_agent_id IS NULL";
  } else if (filters.assignedAgentId === "me") {
    params.push(actor.id);
    where += ` AND c.assigned_agent_id = $${params.length}`;
  } else if (filters.assignedAgentId && filters.assignedAgentId !== "all") {
    params.push(filters.assignedAgentId);
    where += ` AND c.assigned_agent_id = $${params.length}`;
  }

  if (filters.status && filters.status !== "all") {
    params.push(filters.status);
    where += ` AND c.status = $${params.length}`;
  }

  if (filters.q?.trim()) {
    params.push(`%${filters.q.trim().toLowerCase()}%`);
    const idx = params.length;
    where += ` AND (
      lower(coalesce(c.customer_name, '')) LIKE $${idx}
      OR lower(c.customer_phone) LIKE $${idx}
      OR lower(coalesce(c.customer_jid, '')) LIKE $${idx}
    )`;
  }

  const { rows } = await query<ConversationView>(
    `${CONVERSATION_SELECT}
     WHERE ${where}
     ORDER BY c.last_message_at IS NULL, c.last_message_at DESC, c.created_at DESC`,
    params,
  );
  return rows.map((row) =>
    canSeeHistoryItem(row, actor, row.last_message_at) ? row : { ...row, last_message_text: null },
  );
}

export async function getConversation(
  tenantId: string,
  conversationId: string,
): Promise<ConversationView | null> {
  await releaseExpiredLocks(tenantId);
  const { rows } = await query<ConversationView>(
    `${CONVERSATION_SELECT}
     WHERE c.id = $1 AND c.tenant_id = $2`,
    [conversationId, tenantId],
  );
  return rows[0] ?? null;
}

export async function getConversationForActor(
  tenantId: string,
  conversationId: string,
  actor: { id: string; role: AgentRole },
): Promise<ConversationView> {
  const conversation = await getConversation(tenantId, conversationId);
  if (!conversation) {
    throw Object.assign(new Error("Conversation not found"), { status: 404 });
  }
  if (actor.role === "agent" && conversation.assigned_agent_id !== actor.id) {
    throw Object.assign(new Error("Conversation not found"), { status: 404 });
  }
  return conversation;
}

export async function findOrCreateConversation(input: {
  tenantId: string;
  connectionId: string;
  customerPhone: string;
  customerJid?: string | null;
  customerName?: string | null;
}): Promise<Conversation> {
  const existing = await query<Conversation>(
    `SELECT * FROM conversations
     WHERE tenant_id = $1 AND connection_id = $2 AND customer_phone = $3`,
    [input.tenantId, input.connectionId, input.customerPhone],
  );
  if (existing.rows[0]) {
    const name = input.customerName && !existing.rows[0].customer_name ? input.customerName : existing.rows[0].customer_name;
    const jid = input.customerJid && isPreferredJid(input.customerJid, existing.rows[0].customer_jid)
      ? input.customerJid
      : existing.rows[0].customer_jid;
    if (name !== existing.rows[0].customer_name || jid !== existing.rows[0].customer_jid) {
      const updated = await query<Conversation>(
        `UPDATE conversations
         SET customer_name = $3, customer_jid = $4
         WHERE id = $1 AND tenant_id = $2
         RETURNING *`,
        [existing.rows[0].id, input.tenantId, name, jid],
      );
      return updated.rows[0];
    }
    return existing.rows[0];
  }

  const assignedAgentId = await maybeAssign(input.tenantId);
  const tenant = assignedAgentId ? await getTenant(input.tenantId) : null;
  const seeHistory = tenant ? tenant.agents_can_see_history !== 0 && tenant.agents_can_see_history !== false : 1;
  const inserted = await query<Conversation>(
    `INSERT INTO conversations (
       tenant_id, connection_id, customer_phone, customer_jid, customer_name,
       assigned_agent_id, assigned_at, assignee_can_see_history, status, last_message_at
     ) VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6 IS NULL THEN NULL ELSE now() END, $7, 'open', now())
     RETURNING *`,
    [
      input.tenantId,
      input.connectionId,
      input.customerPhone,
      input.customerJid ?? null,
      input.customerName ?? null,
      assignedAgentId,
      assignedAgentId ? (seeHistory ? 1 : 0) : null,
    ],
  );
  return inserted.rows[0];
}

export async function claimConversation(
  tenantId: string,
  conversationId: string,
  agentId: string,
): Promise<ConversationView> {
  const current = await getConversation(tenantId, conversationId);
  if (!current) {
    throw Object.assign(new Error("Conversation not found"), { status: 404 });
  }
  if (current.assigned_agent_id && current.assigned_agent_id !== agentId) {
    throw Object.assign(new Error("Conversation is already assigned to another agent"), { status: 409 });
  }
  const tenant = await getTenant(tenantId);
  const seeHistory = tenant ? tenant.agents_can_see_history !== 0 && tenant.agents_can_see_history !== false : true;
  await query(
    `UPDATE conversations
     SET assigned_agent_id = $3,
         assigned_at = CASE WHEN assigned_agent_id = $3 THEN assigned_at ELSE now() END,
         assignee_can_see_history = $4
     WHERE id = $1 AND tenant_id = $2`,
    [conversationId, tenantId, agentId, seeHistory ? 1 : 0],
  );
  return (await getConversation(tenantId, conversationId))!;
}

export async function assignConversation(
  tenantId: string,
  conversationId: string,
  agentId: string | null,
  options: { canSeeHistory?: boolean } = {},
): Promise<ConversationView> {
  const current = await getConversation(tenantId, conversationId);
  if (!current) {
    throw Object.assign(new Error("Conversation not found"), { status: 404 });
  }
  if (agentId) {
    const agent = await getAgentInTenant(agentId, tenantId);
    assertAssignable(agent);
  }
  const tenant = await getTenant(tenantId);
  const defaultSeeHistory = tenant
    ? tenant.agents_can_see_history !== 0 && tenant.agents_can_see_history !== false
    : true;
  const seeHistory = options.canSeeHistory ?? defaultSeeHistory;
  await query(
    `UPDATE conversations
     SET assigned_agent_id = $3,
         assigned_at = CASE
           WHEN $3 IS NULL THEN NULL
           WHEN $4 = 0 THEN now()
           WHEN assigned_agent_id = $3 THEN COALESCE(assigned_at, now())
           ELSE now()
         END,
         assignee_can_see_history = $4
     WHERE id = $1 AND tenant_id = $2`,
    [conversationId, tenantId, agentId, agentId ? (seeHistory ? 1 : 0) : null],
  );
  const updated = (await getConversation(tenantId, conversationId))!;
  emitToTenant(tenantId, "conversation:updated", updated);
  return updated;
}

export async function setConversationStatus(
  tenantId: string,
  conversationId: string,
  status: Conversation["status"],
): Promise<ConversationView> {
  const current = await getConversation(tenantId, conversationId);
  if (!current) {
    throw Object.assign(new Error("Conversation not found"), { status: 404 });
  }
  await query(
    `UPDATE conversations
     SET status = $3, locked_by_agent_id = NULL, locked_at = NULL
     WHERE id = $1 AND tenant_id = $2`,
    [conversationId, tenantId, status],
  );
  const updated = (await getConversation(tenantId, conversationId))!;
  emitToTenant(tenantId, "conversation:updated", updated);
  return updated;
}

export async function lockConversation(
  tenantId: string,
  conversationId: string,
  agentId: string,
): Promise<ConversationView> {
  await releaseExpiredLocks(tenantId);
  const current = await getConversation(tenantId, conversationId);
  if (!current) {
    throw Object.assign(new Error("Conversation not found"), { status: 404 });
  }
  if (current.locked_by_agent_id && current.locked_by_agent_id !== agentId) {
    const assigneeTakeover = current.assigned_agent_id === agentId;
    if (!assigneeTakeover) {
      throw Object.assign(
        new Error(`Conversation is locked by ${current.locked_by_agent_name ?? "another agent"}`),
        { status: 409 },
      );
    }
  }
  await query(
    `UPDATE conversations
     SET locked_by_agent_id = $3, locked_at = now()
     WHERE id = $1 AND tenant_id = $2`,
    [conversationId, tenantId, agentId],
  );
  const updated = (await getConversation(tenantId, conversationId))!;
  emitToTenant(tenantId, "conversation:updated", updated);
  return updated;
}

export async function unlockConversation(
  tenantId: string,
  conversationId: string,
  agentId: string,
): Promise<ConversationView> {
  await query(
    `UPDATE conversations
     SET locked_by_agent_id = NULL, locked_at = NULL
     WHERE id = $1 AND tenant_id = $2 AND (locked_by_agent_id = $3 OR locked_by_agent_id IS NULL)`,
    [conversationId, tenantId, agentId],
  );
  const updated = (await getConversation(tenantId, conversationId))!;
  if (updated) emitToTenant(tenantId, "conversation:updated", updated);
  return updated;
}

export async function touchConversation(tenantId: string, conversationId: string): Promise<void> {
  await query(
    `UPDATE conversations
     SET last_message_at = now()
     WHERE id = $1 AND tenant_id = $2`,
    [conversationId, tenantId],
  );
}

export async function releaseExpiredLocks(tenantId: string): Promise<void> {
  const cutoff = new Date(Date.now() - config.lockTtlSeconds * 1000).toISOString();
  await query(
    `UPDATE conversations
     SET locked_by_agent_id = NULL, locked_at = NULL
     WHERE tenant_id = $1
       AND locked_at IS NOT NULL
       AND locked_at < $2`,
    [tenantId, cutoff],
  );
}

async function maybeAssign(tenantId: string): Promise<string | null> {
  const { rows } = await query<{ assignment_mode: string }>(
    "SELECT assignment_mode FROM tenants WHERE id = $1",
    [tenantId],
  );
  const mode = rows[0]?.assignment_mode ?? config.assignmentMode;
  if (mode !== "round_robin") return null;

  const agents = (await listAgents(tenantId, { status: "active", role: "agent" })).filter(
    (agent) => agent.status === "active",
  );
  if (agents.length === 0) return null;
  const counts = await query<{ id: string }>(
    `SELECT a.id
     FROM agents a
     LEFT JOIN conversations c
       ON c.assigned_agent_id = a.id AND c.tenant_id = a.tenant_id AND c.status = 'open'
     WHERE a.tenant_id = $1 AND a.status = 'active' AND a.role = 'agent'
     GROUP BY a.id
     ORDER BY COUNT(c.id) ASC, a.created_at ASC
     LIMIT 1`,
    [tenantId],
  );
  return counts.rows[0]?.id ?? agents[0].id;
}

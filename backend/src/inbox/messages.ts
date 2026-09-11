import {
  evolutionRecipient,
  getLiveConnection,
  jidFromStoredPayload,
  sendWhatsAppText,
} from "../core/index.js";
import type { MessagePayload, MessageStatus } from "../core/types.js";
import { isUniqueViolation, query } from "../db.js";
import { emitToTenant } from "../realtime/bus.js";
import type { MessageRecord } from "./types.js";
import {
  findOrCreateConversation,
  getConversation,
  lockConversation,
  touchConversation,
  type ConversationView,
} from "./conversations.js";

export async function listMessages(
  tenantId: string,
  conversationId: string,
): Promise<MessageRecord[]> {
  const conversation = await getConversation(tenantId, conversationId);
  if (!conversation) {
    throw Object.assign(new Error("Conversation not found"), { status: 404 });
  }
  const { rows } = await query<MessageRecord>(
    `SELECT * FROM messages
     WHERE tenant_id = $1 AND conversation_id = $2
     ORDER BY created_at ASC`,
    [tenantId, conversationId],
  );
  return rows;
}

export async function insertMessage(input: {
  tenantId: string;
  conversationId: string;
  connectionId: string;
  direction: "in" | "out";
  waMessageId: string | null;
  payload: MessagePayload;
  status: MessageStatus;
  sentByAgentId?: string | null;
  createdAt?: Date;
}): Promise<MessageRecord> {
  let rows: MessageRecord[] = [];
  try {
    const inserted = await query<MessageRecord>(
      `INSERT INTO messages (
         tenant_id, conversation_id, connection_id, direction, wa_message_id, payload, status, sent_by_agent_id, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, now()))
       RETURNING *`,
      [
        input.tenantId,
        input.conversationId,
        input.connectionId,
        input.direction,
        input.waMessageId,
        JSON.stringify(input.payload),
        input.status,
        input.sentByAgentId ?? null,
        input.createdAt ?? null,
      ],
    );
    rows = inserted.rows;
  } catch (error) {
    if (!isUniqueViolation(error) || !input.waMessageId) throw error;
    const existing = await query<MessageRecord>(
      `SELECT * FROM messages WHERE tenant_id = $1 AND wa_message_id = $2`,
      [input.tenantId, input.waMessageId],
    );
    return existing.rows[0];
  }

  await touchConversation(input.tenantId, input.conversationId);
  const saved = rows[0];
  if (!saved) {
    throw new Error("Failed to persist message");
  }
  emitToTenant(input.tenantId, "message:new", saved);
  const conversation = await getConversation(input.tenantId, input.conversationId);
  if (conversation) emitToTenant(input.tenantId, "conversation:updated", conversation);
  return saved;
}

export async function updateMessageStatus(
  tenantId: string,
  waMessageId: string,
  status: MessageStatus,
): Promise<MessageRecord | null> {
  const { rows } = await query<MessageRecord>(
    `UPDATE messages
     SET status = $3
     WHERE tenant_id = $1 AND wa_message_id = $2
     RETURNING *`,
    [tenantId, waMessageId, status],
  );
  if (rows[0]) {
    emitToTenant(tenantId, "message:updated", rows[0]);
  }
  return rows[0] ?? null;
}

export async function sendAgentReply(input: {
  tenantId: string;
  conversationId: string;
  agentId: string;
  text: string;
}): Promise<{ message: MessageRecord; conversation: ConversationView }> {
  const text = input.text.trim();
  if (!text) {
    throw Object.assign(new Error("Message text is required"), { status: 400 });
  }

  const conversation = await getConversation(input.tenantId, input.conversationId);
  if (!conversation) {
    throw Object.assign(new Error("Conversation not found"), { status: 404 });
  }

  await lockConversation(input.tenantId, input.conversationId, input.agentId);

  const live = await getLiveConnection(input.tenantId);
  if (!live || live.status !== "connected") {
    throw Object.assign(new Error("Tenant WhatsApp number is not connected"), { status: 409 });
  }

  const to = await resolveSendRecipient(conversation);
  let sendResult;
  try {
    sendResult = await sendWhatsAppText({
      connection: live,
      to,
      text,
    });
  } catch (error) {
    const failed = await insertMessage({
      tenantId: input.tenantId,
      conversationId: conversation.id,
      connectionId: live.id,
      direction: "out",
      waMessageId: null,
      payload: { text, type: "conversation", raw: { error: String(error) } },
      status: "failed",
      sentByAgentId: input.agentId,
    });
    throw Object.assign(error instanceof Error ? error : new Error("Failed to send"), {
      status: 502,
      failedMessage: failed,
    });
  }

  const message = await insertMessage({
    tenantId: input.tenantId,
    conversationId: conversation.id,
    connectionId: live.id,
    direction: "out",
    waMessageId: sendResult.waMessageId,
    payload: { text, type: "conversation", raw: sendResult.raw },
    status: "sent",
    sentByAgentId: input.agentId,
  });

  return {
    message,
    conversation: (await getConversation(input.tenantId, conversation.id))!,
  };
}

async function resolveSendRecipient(conversation: ConversationView): Promise<string> {
  if (conversation.customer_jid) {
    return evolutionRecipient(conversation.customer_jid);
  }

  const { rows } = await query<{ payload: MessagePayload }>(
    `SELECT payload FROM messages
     WHERE tenant_id = $1 AND conversation_id = $2 AND direction = 'in'
     ORDER BY created_at DESC
     LIMIT 25`,
    [conversation.tenant_id, conversation.id],
  );
  for (const row of rows) {
    const jid = jidFromStoredPayload(row.payload);
    if (!jid) continue;
    await query(
      `UPDATE conversations SET customer_jid = $3 WHERE id = $1 AND tenant_id = $2`,
      [conversation.id, conversation.tenant_id, jid],
    );
    return evolutionRecipient(jid);
  }

  return evolutionRecipient(conversation.customer_phone);
}

export async function addInternalNote(input: {
  tenantId: string;
  conversationId: string;
  agentId: string;
  note: string;
}) {
  const conversation = await getConversation(input.tenantId, input.conversationId);
  if (!conversation) {
    throw Object.assign(new Error("Conversation not found"), { status: 404 });
  }
  const { rows } = await query(
    `INSERT INTO internal_notes (conversation_id, agent_id, note)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [input.conversationId, input.agentId, input.note],
  );
  emitToTenant(input.tenantId, "note:new", {
    ...rows[0],
    tenant_id: input.tenantId,
    conversation_id: input.conversationId,
  });
  return rows[0];
}

export async function listInternalNotes(tenantId: string, conversationId: string) {
  const conversation = await getConversation(tenantId, conversationId);
  if (!conversation) {
    throw Object.assign(new Error("Conversation not found"), { status: 404 });
  }
  const { rows } = await query(
    `SELECT n.*, a.name AS agent_name
     FROM internal_notes n
     JOIN conversations c ON c.id = n.conversation_id
     LEFT JOIN agents a ON a.id = n.agent_id
     WHERE n.conversation_id = $1 AND c.tenant_id = $2
     ORDER BY n.created_at ASC`,
    [conversationId, tenantId],
  );
  return rows;
}

export async function simulateInbound(input: {
  tenantId: string;
  phone: string;
  text: string;
  name?: string;
}): Promise<{ conversation: ConversationView; message: MessageRecord }> {
  const live = await getLiveConnection(input.tenantId);
  if (!live) {
    throw Object.assign(new Error("Connect a WhatsApp number first"), { status: 409 });
  }
  const phone = input.phone.replace(/\D/g, "");
  const text = input.text.trim();
  if (!phone || !text) {
    throw Object.assign(new Error("phone and text are required"), { status: 400 });
  }
  const conversation = await findOrCreateConversation({
    tenantId: input.tenantId,
    connectionId: live.id,
    customerPhone: phone,
    customerJid: `${phone}@s.whatsapp.net`,
    customerName: input.name ?? null,
  });
  const message = await insertMessage({
    tenantId: input.tenantId,
    conversationId: conversation.id,
    connectionId: live.id,
    direction: "in",
    waMessageId: `demo-in-${Date.now()}`,
    payload: { text, type: "conversation", pushName: input.name ?? null },
    status: "sent",
  });
  return {
    conversation: (await getConversation(input.tenantId, conversation.id))!,
    message,
  };
}

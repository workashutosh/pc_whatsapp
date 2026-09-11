import {
  getConnectionByInstanceName,
  markConnectionState,
  parseIncomingWhatsApp,
} from "../core/index.js";
import { emitToTenant } from "../realtime/bus.js";
import { findOrCreateConversation } from "./conversations.js";
import { insertMessage, updateMessageStatus } from "./messages.js";

export async function handleProviderWebhook(raw: unknown): Promise<{ ok: boolean; ignored?: string }> {
  const event = parseIncomingWhatsApp(raw);
  if (!event) {
    return { ok: true, ignored: "unrecognized" };
  }

  const connection = await getConnectionByInstanceName(event.instanceName);
  if (!connection) {
    return { ok: true, ignored: "unknown-instance" };
  }

  if (event.kind === "qr") {
    emitToTenant(connection.tenant_id, "qr:updated", {
      connectionId: connection.id,
      qr: event.qr,
    });
    return { ok: true };
  }

  if (event.kind === "connection") {
    await markConnectionState({
      instanceName: event.instanceName,
      state: event.state,
      phoneNumber: event.phoneNumber,
    });
    return { ok: true };
  }

  if (event.kind === "status") {
    await updateMessageStatus(connection.tenant_id, event.waMessageId, event.status);
    return { ok: true };
  }

  if (event.fromMe) {
    const existing = await updateMessageStatus(
      connection.tenant_id,
      event.waMessageId,
      event.status,
    );
    if (existing) return { ok: true };
  }

  const conversation = await findOrCreateConversation({
    tenantId: connection.tenant_id,
    connectionId: connection.id,
    customerPhone: event.customerPhone,
    customerJid: event.customerJid,
    customerName: event.pushName,
  });

  await insertMessage({
    tenantId: connection.tenant_id,
    conversationId: conversation.id,
    connectionId: connection.id,
    direction: event.fromMe ? "out" : "in",
    waMessageId: event.waMessageId,
    payload: {
      text: event.text,
      type: event.type,
      pushName: event.pushName,
      raw: event.raw,
    },
    status: event.status,
    createdAt: event.timestamp,
  });

  return { ok: true };
}

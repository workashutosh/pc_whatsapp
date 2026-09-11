import type { MessagePayload, MessageStatus } from "../core/types.js";

export type ConversationStatus = "open" | "pending" | "closed";
export type MessageDirection = "in" | "out";

export interface Tenant {
  id: string;
  name: string;
  assignment_mode: "manual" | "round_robin";
}

export interface Agent {
  id: string;
  tenant_id: string;
  name: string;
  email: string;
}

export interface Conversation {
  id: string;
  tenant_id: string;
  connection_id: string;
  customer_phone: string;
  customer_jid: string | null;
  customer_name: string | null;
  assigned_agent_id: string | null;
  locked_by_agent_id: string | null;
  locked_at: string | null;
  status: ConversationStatus;
  last_message_at: string | null;
}

export interface MessageRecord {
  id: string;
  tenant_id: string;
  conversation_id: string;
  connection_id: string;
  direction: MessageDirection;
  wa_message_id: string | null;
  payload: MessagePayload;
  status: MessageStatus;
  sent_by_agent_id: string | null;
  created_at: string;
}

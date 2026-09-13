import type { MessagePayload, MessageStatus } from "../core/types.js";

export type ConversationStatus = "open" | "pending" | "closed";
export type MessageDirection = "in" | "out";
export type AgentRole = "super_admin" | "manager" | "agent";
export type AgentStatus = "active" | "disabled";

export interface Tenant {
  id: string;
  name: string;
  assignment_mode: "manual" | "round_robin";
  agents_can_see_phone: number | boolean;
  allow_all_ips: number | boolean;
  agents_can_see_history: number | boolean;
}

export interface Agent {
  id: string;
  tenant_id: string;
  name: string;
  email: string;
  role: AgentRole;
  password_hash: string | null;
  status: AgentStatus;
  disabled_at: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  tenant_id: string;
  connection_id: string;
  customer_phone: string;
  customer_jid: string | null;
  customer_name: string | null;
  assigned_agent_id: string | null;
  assigned_at: string | null;
  assignee_can_see_history: number | boolean | null;
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

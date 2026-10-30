import type { Agent, AgentRole, Conversation } from "./types.js";

export type PolicyAction =
  | "viewAllChats"
  | "assign"
  | "startConversation"
  | "stopConversation"
  | "manageWhatsApp"
  | "managePeople"
  | "tenantSettings";

const ROLE_ACTIONS: Record<AgentRole, PolicyAction[]> = {
  super_admin: ["viewAllChats", "assign", "startConversation", "stopConversation", "manageWhatsApp", "managePeople", "tenantSettings"],
  manager: ["viewAllChats", "assign", "startConversation", "stopConversation", "managePeople"],
  agent: [],
};

export function can(role: AgentRole, action: PolicyAction): boolean {
  return ROLE_ACTIONS[role].includes(action);
}

export function canSeePhone(role: AgentRole, agentsCanSeePhone: boolean): boolean {
  if (role === "super_admin" || role === "manager") return true;
  return agentsCanSeePhone;
}

export function maskPhone(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  return `••••${digits.slice(-4)}`;
}

export function historyVisibleFrom(
  conversation: Pick<Conversation, "assigned_agent_id" | "assigned_at" | "assignee_can_see_history">,
  actor: { id: string; role: AgentRole },
): string | null {
  if (actor.role !== "agent") return null;
  if (conversation.assigned_agent_id !== actor.id) return null;
  if (conversation.assignee_can_see_history !== 0 && conversation.assignee_can_see_history !== false) {
    return null;
  }
  return conversation.assigned_at;
}

export function canSeeHistoryItem(
  conversation: Pick<Conversation, "assigned_agent_id" | "assigned_at" | "assignee_can_see_history">,
  actor: { id: string; role: AgentRole },
  createdAt: string | null | undefined,
): boolean {
  const cutoff = historyVisibleFrom(conversation, actor);
  if (!cutoff || !createdAt) return true;
  return createdAt >= cutoff;
}

export function redactConversation<T extends Conversation & { last_message_text?: string | null; last_message_at?: string | null }>(
  conversation: T,
  seePhone: boolean,
  actor?: { id: string; role: AgentRole },
): T {
  let next = conversation;
  if (!seePhone) {
    next = {
      ...next,
      customer_phone: maskPhone(conversation.customer_phone),
      customer_jid: conversation.customer_jid ? maskPhone(conversation.customer_jid) : null,
    };
  }
  if (actor && !canSeeHistoryItem(conversation, actor, conversation.last_message_at)) {
    next = { ...next, last_message_text: null };
  }
  return next;
}

export function canManageTarget(actor: Agent, target: Agent): boolean {
  if (actor.role === "super_admin") return true;
  if (actor.role === "manager") return target.role === "agent";
  return false;
}

export function canSetRole(actor: Agent, role: AgentRole): boolean {
  if (actor.role === "super_admin") return true;
  if (actor.role === "manager") return role === "agent";
  return false;
}

export function assertAssignable(agent: Agent | null): void {
  if (!agent) {
    throw Object.assign(new Error("Agent not found"), { status: 404 });
  }
  if (agent.status !== "active") {
    throw Object.assign(new Error("Cannot assign a disabled account"), { status: 409 });
  }
}

export function publicAgent(agent: Agent): Omit<Agent, "password_hash"> {
  const { password_hash: _password, ...rest } = agent;
  return rest;
}

export type AgentRole = "super_admin" | "manager" | "agent";
export type AgentStatus = "active" | "disabled";

export type SessionAgent = {
  id: string;
  name: string;
  email: string;
  tenantId: string;
  tenantName: string;
  role: AgentRole;
  status: AgentStatus;
  seePhone: boolean;
  agentsCanSeePhone: boolean;
  agentsCanSeeHistory: boolean;
};

export type IpAllowlist = {
  allowAllIps: boolean;
  currentIp: string;
  ips: { id: string; ip: string; created_at: string }[];
};

export type Connection = {
  id: string;
  tenant_id: string;
  provider: "evolution" | "cloud_api" | "demo";
  instance_name: string | null;
  phone_number: string | null;
  status: "pending" | "connected" | "disconnected" | "banned";
  connected_at: string | null;
  created_at: string;
};

export type QrPayload = {
  base64?: string | null;
  pairingCode?: string | null;
  code?: string | null;
};

export type Conversation = {
  id: string;
  tenant_id: string;
  connection_id: string;
  customer_phone: string;
  customer_name: string | null;
  assigned_agent_id: string | null;
  assigned_agent_name: string | null;
  assigned_at: string | null;
  assignee_can_see_history: boolean | number | null;
  locked_by_agent_id: string | null;
  locked_by_agent_name: string | null;
  locked_at: string | null;
  status: "open" | "pending" | "closed";
  last_message_at: string | null;
  last_message_text: string | null;
};

export type MessageMedia = {
  kind: "image";
  mimetype: string;
  caption?: string | null;
  filename?: string | null;
  dataUrl?: string | null;
};

export type Message = {
  id: string;
  conversation_id: string;
  direction: "in" | "out";
  wa_message_id: string | null;
  payload: { text: string | null; type: string; media?: MessageMedia | null };
  status: string;
  sent_by_agent_id: string | null;
  created_at: string;
};

export type SendImage = {
  base64: string;
  mimetype?: string;
  filename?: string;
};

export type Note = {
  id: string;
  conversation_id: string;
  agent_id: string;
  agent_name?: string;
  note: string;
  created_at: string;
};

export type Agent = {
  id: string;
  tenant_id: string;
  name: string;
  email: string;
  role: AgentRole;
  status: AgentStatus;
};

export type ChatFilters = {
  q: string;
  status: "all" | "open" | "closed";
  assignedAgentId: string;
};

export function canManage(role: AgentRole): boolean {
  return role === "super_admin" || role === "manager";
}

export function roleLabel(role: AgentRole): string {
  if (role === "super_admin") return "Super admin";
  if (role === "manager") return "Manager";
  return "Agent";
}

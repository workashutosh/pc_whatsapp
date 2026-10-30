import type { Agent, AgentRole, AgentStatus, ChatFilters, Conversation, IpAllowlist, Message, Note, SessionAgent } from "../types";
import { request } from "../lib/http";

export const inboxApi = {
  login: (email: string, password: string) =>
    request<{ token: string; agent: Omit<SessionAgent, "token"> }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  me: () =>
    request<{
      agent: SessionAgent;
      tenant: { id: string; name: string; agentsCanSeePhone: boolean };
    }>("/api/auth/me"),
  agents: (filter: { q?: string; role?: AgentRole | "all"; status?: AgentStatus | "all" } = {}) => {
    const params = new URLSearchParams();
    if (filter.q) params.set("q", filter.q);
    if (filter.role && filter.role !== "all") params.set("role", filter.role);
    if (filter.status && filter.status !== "all") params.set("status", filter.status);
    const query = params.toString();
    return request<{ agents: Agent[] }>(`/api/auth/agents${query ? `?${query}` : ""}`);
  },
  createAgent: (input: { name: string; email: string; password: string; role: AgentRole }) =>
    request<{ agent: Agent }>("/api/auth/agents", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateAgent: (id: string, input: Partial<{ name: string; email: string; password: string; role: AgentRole; status: AgentStatus }>) =>
    request<{ agent: Agent }>(`/api/auth/agents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  updateTenant: (input: { agentsCanSeePhone?: boolean; agentsCanSeeHistory?: boolean }) =>
    request<{ tenant: { id: string; name: string; agentsCanSeePhone: boolean; agentsCanSeeHistory: boolean } }>(
      "/api/auth/tenant",
      {
        method: "PATCH",
        body: JSON.stringify(input),
      },
    ),
  ipAllowlist: () =>
    request<IpAllowlist>("/api/auth/ip-allowlist"),
  setIpAllowlist: (allowAllIps: boolean) =>
    request<IpAllowlist>("/api/auth/ip-allowlist", {
      method: "PATCH",
      body: JSON.stringify({ allowAllIps }),
    }),
  addAllowedIp: (ip?: string) =>
    request<IpAllowlist & { ip: { id: string; ip: string; created_at: string } }>("/api/auth/ip-allowlist", {
      method: "POST",
      body: JSON.stringify(ip ? { ip } : {}),
    }),
  removeAllowedIp: (id: string) =>
    request<IpAllowlist>(`/api/auth/ip-allowlist/${id}`, { method: "DELETE" }),
  conversations: (filters: ChatFilters) => {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.status !== "all") params.set("status", filters.status);
    if (filters.assignedAgentId && filters.assignedAgentId !== "all") {
      params.set("assignedAgentId", filters.assignedAgentId);
    }
    const query = params.toString();
    return request<{ conversations: Conversation[] }>(`/api/conversations${query ? `?${query}` : ""}`);
  },
  conversation: (id: string) =>
    request<{ conversation: Conversation }>(`/api/conversations/${id}`),
  assign: (id: string, agentId: string | null, options: { canSeeHistory?: boolean } = {}) =>
    request<{ conversation: Conversation }>(`/api/conversations/${id}/assign`, {
      method: "POST",
      body: JSON.stringify({ agentId, canSeeHistory: options.canSeeHistory }),
    }),
  lock: (id: string) =>
    request<{ conversation: Conversation }>(`/api/conversations/${id}/lock`, { method: "POST" }),
  unlock: (id: string) =>
    request<{ conversation: Conversation }>(`/api/conversations/${id}/unlock`, { method: "POST" }),
  setStatus: (id: string, status: Conversation["status"]) =>
    request<{ conversation: Conversation }>(`/api/conversations/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  messages: (id: string) =>
    request<{ messages: Message[] }>(`/api/conversations/${id}/messages`),
  notes: (id: string) => request<{ notes: Note[] }>(`/api/conversations/${id}/notes`),
  addNote: (id: string, note: string) =>
    request<{ note: Note }>(`/api/conversations/${id}/notes`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),
  startConversation: (input: { phone: string; text: string; name?: string }) =>
    request<{ conversation: Conversation; message: Message }>("/api/conversations", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  simulate: (input: { phone: string; text: string; name?: string }) =>
    request<{ conversation: Conversation; message: Message }>("/api/conversations/simulate", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};

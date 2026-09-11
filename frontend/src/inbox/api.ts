import type { Agent, Conversation, Message, Note, SessionAgent } from "../types";
import { request } from "../lib/http";

/** Inbox/CRM API — agents, assignment, notes. Does not own WhatsApp login or send. */
export const inboxApi = {
  login: (email: string) =>
    request<{ agent: SessionAgent }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  agents: () => request<{ agents: Agent[] }>("/api/auth/agents"),
  conversations: (filter: string) =>
    request<{ conversations: Conversation[] }>(`/api/conversations?filter=${filter}`),
  conversation: (id: string) =>
    request<{ conversation: Conversation }>(`/api/conversations/${id}`),
  claim: (id: string) =>
    request<{ conversation: Conversation }>(`/api/conversations/${id}/claim`, { method: "POST" }),
  assign: (id: string, agentId: string | null) =>
    request<{ conversation: Conversation }>(`/api/conversations/${id}/assign`, {
      method: "POST",
      body: JSON.stringify({ agentId }),
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
  simulate: (input: { phone: string; text: string; name?: string }) =>
    request<{ conversation: Conversation; message: Message }>("/api/conversations/simulate", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};

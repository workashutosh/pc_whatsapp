import type { Connection, Conversation, Message, QrPayload, SendImage } from "../types";
import { request } from "../lib/http";

/** Core WhatsApp channel API — login/QR, connection, send. Inbox UI should not reimplement these. */
export const channelApi = {
  connections: () => request<{ connections: Connection[] }>("/api/connections"),
  connect: () =>
    request<{ connection: Connection; qr: QrPayload | null }>("/api/connections", {
      method: "POST",
      body: JSON.stringify({ provider: "evolution" }),
    }),
  switchNumber: () =>
    request<{ connection: Connection; qr: QrPayload | null }>("/api/connections/switch", {
      method: "POST",
      body: JSON.stringify({ provider: "evolution" }),
    }),
  disconnect: (id: string) =>
    request<{ connection: Connection }>(`/api/connections/${id}/disconnect`, { method: "POST" }),
  qr: (id: string) =>
    request<{ connection: Connection; qr: QrPayload | null }>(`/api/connections/${id}/qr`),
  status: (id: string) =>
    request<{ connection: Connection }>(`/api/connections/${id}/status`),
  send: (id: string, text: string, image?: SendImage) =>
    request<{ message: Message; conversation: Conversation }>(`/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify(image ? { text, image } : { text }),
    }),
};

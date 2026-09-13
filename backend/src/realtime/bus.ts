import type { Server, Socket } from "socket.io";
import { canSeeHistoryItem, redactConversation } from "../inbox/policy.js";
import type { AgentRole, Conversation } from "../inbox/types.js";

let io: Server | null = null;

export interface SocketAuth {
  tenantId: string;
  agentId: string;
  role: AgentRole;
  seePhone: boolean;
}

export function setIo(server: Server): void {
  io = server;
}

export function getIo(): Server {
  if (!io) {
    throw new Error("Socket.io has not been initialized");
  }
  return io;
}

export function tenantRoom(tenantId: string): string {
  return `tenant:${tenantId}`;
}

export function emitToTenant(tenantId: string, event: string, payload: unknown): void {
  if (!io) return;
  const room = io.sockets.adapter.rooms.get(tenantRoom(tenantId));
  if (!room) return;
  for (const socketId of room) {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) continue;
    const next = payloadForSocket(socket, event, payload);
    if (next === undefined) continue;
    socket.emit(event, next);
  }
}

function payloadForSocket(socket: Socket, event: string, payload: unknown): unknown {
  const auth = socket.data.auth as SocketAuth | undefined;
  if (!auth) return payload;
  if (payload && typeof payload === "object" && "customer_phone" in payload) {
    return redactConversation(
      payload as Parameters<typeof redactConversation>[0],
      auth.seePhone,
      { id: auth.agentId, role: auth.role },
    );
  }
  if ((event === "message:new" || event === "note:new") && payload && typeof payload === "object") {
    const item = payload as {
      created_at?: string;
      assigned_agent_id?: string | null;
      assigned_at?: string | null;
      assignee_can_see_history?: number | boolean | null;
    };
    if (auth.role === "agent" && item.assigned_agent_id && item.assigned_agent_id !== auth.agentId) {
      return undefined;
    }
    if (
      !canSeeHistoryItem(
        {
          assigned_agent_id: item.assigned_agent_id ?? null,
          assigned_at: item.assigned_at ?? null,
          assignee_can_see_history: item.assignee_can_see_history ?? 1,
        } as Conversation,
        { id: auth.agentId, role: auth.role },
        item.created_at,
      )
    ) {
      return undefined;
    }
  }
  return payload;
}

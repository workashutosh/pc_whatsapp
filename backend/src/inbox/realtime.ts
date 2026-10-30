import type { Socket } from "socket.io";
import { canSeeHistoryItem, redactConversation } from "./policy.js";
import type { AgentRole, Conversation } from "./types.js";

export interface SocketAuth {
  tenantId: string;
  agentId: string;
  role: AgentRole;
  seePhone: boolean;
}

/** Per-socket redaction for realtime events: masks phones and hides chats/history an agent may not see. */
export function filterRealtimePayload(socket: Socket, event: string, payload: unknown): unknown {
  const auth = socket.data.auth as SocketAuth | undefined;
  if (!auth) return undefined;
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

/**
 * Inbox / CRM layer on top of the WhatsApp channel.
 * Agents, assignment, locks, notes, and chat history live here.
 * Call core for send/receive/login — never the other way around.
 */
export {
  createAgent,
  getAgentByEmail,
  getAgentInTenant,
  getTenant,
  listAgents,
  updateAgent,
  updateTenantSettings,
} from "./agents.js";
export {
  assignConversation,
  claimConversation,
  findOrCreateConversation,
  getConversation,
  getConversationForActor,
  listConversations,
  lockConversation,
  setConversationStatus,
  unlockConversation,
  type ConversationListQuery,
  type ConversationView,
} from "./conversations.js";
export {
  addInternalNote,
  insertMessage,
  listInternalNotes,
  listMessages,
  sendAgentReply,
  simulateInbound,
  startConversation,
  updateMessageStatus,
} from "./messages.js";
export { can, canSeeHistoryItem, canSeePhone, historyVisibleFrom, maskPhone, redactConversation } from "./policy.js";
export {
  addAllowedIp,
  assertIpAllowed,
  clientIp,
  isIpAllowed,
  listAllowedIps,
  removeAllowedIp,
  setAllowAllIps,
  tenantAllowsAllIps,
} from "./ipAllowlist.js";
export { handleProviderWebhook } from "./webhook.js";
export { filterRealtimePayload } from "./realtime.js";
export {
  createSession,
  deleteSession,
  getSessionAgent,
  purgeExpiredSessions,
  revokeAgentSessions,
} from "./sessions.js";
export type { Agent, AgentRole, Conversation, MessageRecord, Tenant } from "./types.js";

/**
 * Inbox / CRM layer on top of the WhatsApp channel.
 * Agents, assignment, locks, notes, and chat history live here.
 * Call core for send/receive/login — never the other way around.
 */
export { getAgentByEmail, getAgentInTenant, getTenant, listAgents } from "./agents.js";
export {
  assignConversation,
  claimConversation,
  findOrCreateConversation,
  getConversation,
  listConversations,
  lockConversation,
  setConversationStatus,
  unlockConversation,
  type ConversationView,
} from "./conversations.js";
export {
  addInternalNote,
  insertMessage,
  listInternalNotes,
  listMessages,
  sendAgentReply,
  simulateInbound,
  updateMessageStatus,
} from "./messages.js";
export { handleProviderWebhook } from "./webhook.js";
export type { Agent, Conversation, MessageRecord, Tenant } from "./types.js";

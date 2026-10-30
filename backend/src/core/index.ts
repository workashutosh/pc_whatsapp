/**
 * Core WhatsApp channel.
 * Login (QR), send, receive, and connection state live here.
 * Do not import inbox/agents/assignment from this folder.
 */
export { lookupWhatsAppNumber, parseIncomingWhatsApp, sendWhatsAppImage, sendWhatsAppText } from "./channel.js";
export {
  connectNumber,
  disconnectNumber,
  getConnection,
  getConnectionByInstanceName,
  getLiveConnection,
  listConnections,
  markConnectionState,
  refreshConnectionQr,
  refreshRemoteStatus,
  resyncProviderWebhooks,
  switchNumber,
} from "./connections.js";
export {
  evolutionRecipient,
  instanceNameForTenant,
  isPreferredJid,
  jidFromStoredPayload,
  jidFromWebhookKey,
  mapWaStatus,
  phoneFromJid,
} from "./phone.js";
export { getProvider, resolveProviderKind } from "./providers/registry.js";
export type {
  ConnectNumberResult,
  MessageMedia,
  MessagePayload,
  MessageStatus,
  NormalizedIncomingEvent,
  NumberLookupResult,
  ProviderKind,
  QrPayload,
  SendImageInput,
  SendMessageInput,
  SendMessageResult,
  WhatsAppConnection,
} from "./types.js";

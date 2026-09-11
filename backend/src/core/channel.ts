import { getProvider } from "./providers/registry.js";
import type {
  NormalizedIncomingEvent,
  SendMessageInput,
  SendMessageResult,
} from "./types.js";

/** Send a WhatsApp text through the live provider. Inbox must not call providers directly. */
export async function sendWhatsAppText(input: SendMessageInput): Promise<SendMessageResult> {
  return getProvider(input.connection).sendMessage(input);
}

/** Normalize a provider webhook. Inbox persists conversations; this layer only parses. */
export function parseIncomingWhatsApp(raw: unknown): NormalizedIncomingEvent | null {
  return getProvider("evolution").onIncoming(raw);
}

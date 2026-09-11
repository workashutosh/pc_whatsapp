import { getProvider } from "./providers/registry.js";
import type {
  NormalizedIncomingEvent,
  SendImageInput,
  SendMessageInput,
  SendMessageResult,
} from "./types.js";

/** Send a WhatsApp text through the live provider. Inbox must not call providers directly. */
export async function sendWhatsAppText(input: SendMessageInput): Promise<SendMessageResult> {
  return getProvider(input.connection).sendMessage(input);
}

/** Send a WhatsApp image through the live provider. Inbox must not call providers directly. */
export async function sendWhatsAppImage(input: SendImageInput): Promise<SendMessageResult> {
  return getProvider(input.connection).sendImage(input);
}

const FULL_IMAGE_CHARS = 12_000;

/** Normalize a provider webhook. Inbox persists conversations; this layer only parses. */
export async function parseIncomingWhatsApp(raw: unknown): Promise<NormalizedIncomingEvent | null> {
  const event = getProvider("evolution").onIncoming(raw);
  if (!event || event.kind !== "message" || event.media?.kind !== "image") return event;
  if ((event.media.dataUrl?.length ?? 0) >= FULL_IMAGE_CHARS) return event;
  const provider = getProvider("evolution");
  if (!provider.resolveIncomingMedia) return event;
  const media = await provider.resolveIncomingMedia(event);
  if (media?.dataUrl && (media.dataUrl.length ?? 0) > (event.media.dataUrl?.length ?? 0)) {
    return { ...event, media };
  }
  return event;
}

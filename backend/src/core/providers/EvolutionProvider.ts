import { config } from "../../config.js";
import { dataUrlFromBase64, normalizeImageInput } from "../media.js";
import { evolutionRecipient, jidFromWebhookKey, mapWaStatus, phoneFromJid } from "../phone.js";
import type {
  ConnectNumberResult,
  MessageMedia,
  NormalizedIncomingEvent,
  NormalizedIncomingMessage,
  QrPayload,
  SendImageInput,
  SendMessageInput,
  SendMessageResult,
  WhatsAppConnection,
  WhatsAppProvider,
} from "../types.js";

export class EvolutionApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

export class EvolutionProvider implements WhatsAppProvider {
  readonly kind = "evolution" as const;

  constructor(
    private readonly baseUrl = config.evolutionApiUrl,
    private readonly apiKey = config.evolutionApiKey,
    private readonly webhookUrl = config.webhookUrl,
  ) {}

  async connectNumber(_tenantId: string, instanceName: string): Promise<ConnectNumberResult> {
    const created = await this.request<Record<string, unknown>>("POST", "/instance/create", {
      instanceName,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
      webhook: {
        enabled: true,
        url: this.webhookUrl,
        byEvents: false,
        base64: true,
        events: [
          "QRCODE_UPDATED",
          "CONNECTION_UPDATE",
          "MESSAGES_UPSERT",
          "MESSAGES_UPDATE",
        ],
      },
    });

    await this.setWebhook(instanceName).catch((error) => {
      console.warn("Webhook set after create failed (create payload may already have it)", error);
    });

    const qr = extractQr(created) ?? (await this.fetchQr(instanceName));
    return {
      connection: {
        id: "",
        tenant_id: _tenantId,
        provider: "evolution",
        instance_name: instanceName,
        phone_number: null,
        waba_id: null,
        phone_number_id: null,
        access_token: null,
        status: "pending",
        connected_at: null,
        created_at: new Date().toISOString(),
      },
      qr,
    };
  }

  async switchNumber(
    tenantId: string,
    oldConnection: WhatsAppConnection,
    instanceName: string,
  ): Promise<ConnectNumberResult> {
    await this.disconnectNumber(oldConnection);
    return this.connectNumber(tenantId, instanceName);
  }

  async disconnectNumber(connection: WhatsAppConnection): Promise<void> {
    const name = connection.instance_name;
    if (!name) return;
    await this.request("DELETE", `/instance/logout/${encodeURIComponent(name)}`).catch(() => undefined);
    await this.request("DELETE", `/instance/delete/${encodeURIComponent(name)}`).catch(() => undefined);
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const instance = requireInstance(input.connection);
    const number = evolutionRecipient(input.to);
    let raw: unknown;
    try {
      raw = await this.request("POST", `/message/sendText/${encodeURIComponent(instance)}`, {
        number,
        text: input.text,
      });
    } catch (error) {
      if (!(error instanceof EvolutionApiError) || error.status !== 400) {
        throw error;
      }
      raw = await this.request("POST", `/message/sendText/${encodeURIComponent(instance)}`, {
        number,
        textMessage: { text: input.text },
      });
    }

    const waMessageId =
      (raw as { key?: { id?: string } })?.key?.id ??
      (raw as { messageId?: string })?.messageId ??
      null;
    return { waMessageId, raw };
  }

  async sendImage(input: SendImageInput): Promise<SendMessageResult> {
    const instance = requireInstance(input.connection);
    const number = evolutionRecipient(input.to);
    const image = normalizeImageInput(input.image);
    const caption = input.caption?.trim() || undefined;
    const payload = {
      number,
      mediatype: "image",
      media: image.raw,
      mimetype: image.mimetype,
      fileName: image.filename,
      caption,
    };
    let raw: unknown;
    try {
      raw = await this.request("POST", `/message/sendMedia/${encodeURIComponent(instance)}`, payload);
    } catch (error) {
      if (!(error instanceof EvolutionApiError) || error.status !== 400) {
        throw error;
      }
      raw = await this.request("POST", `/message/sendMedia/${encodeURIComponent(instance)}`, {
        number,
        mediatype: "image",
        mimetype: image.mimetype,
        fileName: image.filename,
        caption,
        media: image.raw,
        mediaMessage: {
          mediatype: "image",
          media: image.raw,
          mimetype: image.mimetype,
          fileName: image.filename,
          caption,
        },
      });
    }
    const waMessageId =
      (raw as { key?: { id?: string } })?.key?.id ??
      (raw as { messageId?: string })?.messageId ??
      null;
    return { waMessageId, raw };
  }

  async resolveIncomingMedia(event: NormalizedIncomingMessage): Promise<MessageMedia | null> {
    const instance = event.instanceName;
    const data = asRecord(asRecord(event.raw)?.data) ?? asRecord(event.raw);
    if (!data) return event.media ?? null;
    try {
      const fetched = await this.request<Record<string, unknown>>(
        "POST",
        `/chat/getBase64FromMediaMessage/${encodeURIComponent(instance)}`,
        { message: data, convertToMp4: false },
      );
      const base64 = String(fetched.base64 ?? fetched.base64Data ?? "");
      const mimetype = String(fetched.mimetype ?? event.media?.mimetype ?? "image/jpeg");
      const dataUrl = dataUrlFromBase64(base64, mimetype);
      if (!dataUrl) return event.media ?? null;
      return {
        kind: "image",
        mimetype,
        caption: event.media?.caption ?? null,
        filename: event.media?.filename ?? null,
        dataUrl,
      };
    } catch {
      return event.media ?? null;
    }
  }

  async getQr(connection: WhatsAppConnection): Promise<QrPayload | null> {
    const instance = requireInstance(connection);
    return this.fetchQr(instance);
  }

  async getRemoteStatus(connection: WhatsAppConnection): Promise<{
    state: string;
    phoneNumber: string | null;
  }> {
    const instance = requireInstance(connection);
    const data = await this.request<Record<string, unknown>>(
      "GET",
      `/instance/connectionState/${encodeURIComponent(instance)}`,
    );
    const inner = (data.instance ?? data) as Record<string, unknown>;
    const state = String(inner.state ?? inner.status ?? "close");
    const wuid = String(inner.ownerJid ?? inner.wuid ?? inner.owner ?? "");
    return {
      state,
      phoneNumber: phoneFromJid(wuid),
    };
  }

  onIncoming(raw: unknown): NormalizedIncomingEvent | null {
    if (!raw || typeof raw !== "object") return null;
    const body = raw as Record<string, unknown>;
    const event = String(body.event ?? "").toUpperCase().replace(/\./g, "_");
    const instanceName = String(body.instance ?? "");
    if (!instanceName) return null;

    if (event === "QRCODE_UPDATED") {
      const data = asRecord(body.data) ?? body;
      return {
        kind: "qr",
        instanceName,
        qr: extractQr(data) ?? extractQr(body) ?? {},
        raw,
      };
    }

    if (event === "CONNECTION_UPDATE") {
      const data = asRecord(body.data) ?? {};
      const instance = asRecord(data.instance) ?? data;
      const state = String(instance.state ?? instance.status ?? data.state ?? "close");
      const phone =
        phoneFromJid(String(instance.wuid ?? instance.ownerJid ?? data.wuid ?? body.sender ?? "")) ??
        null;
      return {
        kind: "connection",
        instanceName,
        state,
        phoneNumber: phone,
        raw,
      };
    }

    if (event === "MESSAGES_UPDATE") {
      const data = asRecord(body.data) ?? {};
      const key = asRecord(data.key) ?? {};
      const waMessageId = String(key.id ?? data.id ?? "");
      if (!waMessageId) return null;
      return {
        kind: "status",
        instanceName,
        waMessageId,
        status: mapWaStatus(data.status),
        raw,
      };
    }

    if (event !== "MESSAGES_UPSERT") return null;

    const data = asRecord(body.data) ?? {};
    const key = asRecord(data.key) ?? {};
    const message = asRecord(data.message) ?? {};
    const customerJid = jidFromWebhookKey(key);
    const customerPhone = phoneFromJid(customerJid);
    const waMessageId = String(key.id ?? "");
    if (!customerPhone || !customerJid || !waMessageId) return null;

    const timestampRaw = Number(data.messageTimestamp ?? Date.now() / 1000);
    const timestamp = new Date(timestampRaw > 1e12 ? timestampRaw : timestampRaw * 1000);
    const unwrapped = unwrapWhatsAppMessage(message);
    const media = extractImageMedia(data, unwrapped);

    return {
      kind: "message",
      instanceName,
      waMessageId,
      fromMe: Boolean(key.fromMe),
      customerPhone,
      customerJid,
      text: extractText(unwrapped),
      type: media ? "imageMessage" : String(data.messageType ?? "conversation"),
      pushName: data.pushName ? String(data.pushName) : null,
      timestamp,
      status: mapWaStatus(data.status ?? "sent"),
      media,
      raw,
    };
  }

  private async setWebhook(instanceName: string): Promise<void> {
    const payload = {
      webhook: {
        enabled: true,
        url: this.webhookUrl,
        byEvents: false,
        base64: true,
        events: [
          "QRCODE_UPDATED",
          "CONNECTION_UPDATE",
          "MESSAGES_UPSERT",
          "MESSAGES_UPDATE",
        ],
      },
    };
    try {
      await this.request("POST", `/webhook/set/${encodeURIComponent(instanceName)}`, payload);
    } catch {
      await this.request("POST", `/webhook/set/${encodeURIComponent(instanceName)}`, {
        url: this.webhookUrl,
        webhook_by_events: false,
        webhook_base64: true,
        events: payload.webhook.events,
      });
    }
  }

  private async fetchQr(instanceName: string): Promise<QrPayload | null> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const data = await this.request<Record<string, unknown>>(
        "GET",
        `/instance/connect/${encodeURIComponent(instanceName)}`,
      );
      const qr = extractQr(data);
      if (qr?.base64 || qr?.pairingCode) return qr;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    return null;
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        apikey: this.apiKey,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      throw Object.assign(
        new Error(
          `Evolution API is not reachable at ${this.baseUrl}. Start it with: docker compose up -d postgres redis evolution-api (${reason})`,
        ),
        { status: 503 },
      );
    });
    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!response.ok) {
      const message = formatEvolutionError(parsed) || `${method} ${path} failed (${response.status})`;
      throw new EvolutionApiError(message, response.status, parsed);
    }
    return parsed as T;
  }
}

function requireInstance(connection: WhatsAppConnection): string {
  if (!connection.instance_name) {
    throw new Error("Evolution connection is missing instance_name");
  }
  return connection.instance_name;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function unwrapWhatsAppMessage(message: Record<string, unknown>): Record<string, unknown> {
  const wrappers = ["viewOnceMessage", "viewOnceMessageV2", "ephemeralMessage", "documentWithCaptionMessage"];
  for (const name of wrappers) {
    const wrapped = asRecord(message[name]);
    const inner = asRecord(wrapped?.message);
    if (inner) return { ...message, ...inner };
  }
  return message;
}

function extractImageMedia(
  data: Record<string, unknown>,
  message: Record<string, unknown>,
): MessageMedia | null {
  const image = asRecord(message.imageMessage);
  const type = String(data.messageType ?? "");
  if (!image && type !== "imageMessage") return null;
  const mimetype = String(image?.mimetype ?? "image/jpeg");
  const caption = typeof image?.caption === "string" ? image.caption : null;
  const filename = typeof image?.fileName === "string" ? image.fileName : null;
  const candidates = [data.base64, message.base64, image?.base64, data.messageBase64];
  let dataUrl: string | null = null;
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 80) {
      dataUrl = dataUrlFromBase64(candidate, mimetype);
      break;
    }
  }
  if (!dataUrl && typeof image?.jpegThumbnail === "string") {
    dataUrl = dataUrlFromBase64(image.jpegThumbnail, "image/jpeg");
  }
  return {
    kind: "image",
    mimetype,
    caption,
    filename,
    dataUrl,
  };
}

function extractQr(source: unknown): QrPayload | null {
  const root = asRecord(source);
  if (!root) return null;
  const qrcode = asRecord(root.qrcode) ?? asRecord(root.qr) ?? root;
  const base64 = qrcode.base64 ? String(qrcode.base64) : root.base64 ? String(root.base64) : null;
  const pairingCode = qrcode.pairingCode ? String(qrcode.pairingCode) : null;
  const code = qrcode.code ? String(qrcode.code) : null;
  if (!base64 && !pairingCode && !code) return null;
  return { base64, pairingCode, code };
}

function extractText(message: Record<string, unknown>): string | null {
  if (typeof message.conversation === "string") return message.conversation;
  const extended = asRecord(message.extendedTextMessage);
  if (typeof extended?.text === "string") return extended.text;
  const image = asRecord(message.imageMessage);
  if (typeof image?.caption === "string") return image.caption;
  const video = asRecord(message.videoMessage);
  if (typeof video?.caption === "string") return video.caption;
  const buttons = asRecord(message.buttonsResponseMessage);
  if (typeof buttons?.selectedDisplayText === "string") return buttons.selectedDisplayText;
  const template = asRecord(message.templateButtonReplyMessage);
  if (typeof template?.selectedDisplayText === "string") return template.selectedDisplayText;
  if (message.audioMessage) return "[audio]";
  if (message.stickerMessage) return "[sticker]";
  if (message.documentMessage) return "[document]";
  if (message.imageMessage) return "[image]";
  if (message.videoMessage) return "[video]";
  if (message.contactMessage) return "[contact]";
  if (message.locationMessage) return "[location]";
  return null;
}

function formatEvolutionError(body: unknown): string {
  const record = asRecord(body);
  if (!record) return "";
  const nested = asRecord(record.response);
  const parts = [record.message, nested?.message, record.error, nested?.error];
  const rendered = parts
    .flatMap((part) => summarizeEvolutionMessage(part))
    .filter(Boolean);
  return rendered.join("; ");
}

function summarizeEvolutionMessage(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => summarizeEvolutionMessage(item));
  const record = asRecord(value);
  if (!record) return [];
  if (record.exists === false) {
    const jid = String(record.jid ?? record.number ?? "unknown");
    return [
      jid.includes("@lid")
        ? `WhatsApp LID ${jid} was rejected by Evolution. Replies must use the @lid chat id.`
        : `WhatsApp says ${jid} is not a reachable number (exists: false).`,
    ];
  }
  if (typeof record.message === "string") return [record.message];
  try {
    return [JSON.stringify(record)];
  } catch {
    return [];
  }
}

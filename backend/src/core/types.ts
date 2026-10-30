export type ProviderKind = "evolution" | "cloud_api" | "demo";
export type ConnectionStatus = "pending" | "connected" | "disconnected" | "banned";
export type MessageDirection = "in" | "out";
export type MessageStatus = "sent" | "delivered" | "read" | "failed" | "pending";

export interface WhatsAppConnection {
  id: string;
  tenant_id: string;
  provider: ProviderKind;
  instance_name: string | null;
  phone_number: string | null;
  waba_id: string | null;
  phone_number_id: string | null;
  access_token: string | null;
  status: ConnectionStatus;
  connected_at: string | null;
  created_at: string;
}

export interface MessagePayload {
  text: string | null;
  type: string;
  pushName?: string | null;
  media?: MessageMedia | null;
  raw?: unknown;
}

export interface MessageMedia {
  kind: "image";
  mimetype: string;
  caption?: string | null;
  filename?: string | null;
  dataUrl?: string | null;
}

export interface SendImageInput {
  connection: WhatsAppConnection;
  to: string;
  caption?: string;
  image: {
    base64: string;
    mimetype: string;
    filename?: string;
  };
}

export interface ConnectNumberResult {
  connection: WhatsAppConnection;
  qr?: QrPayload | null;
}

export interface QrPayload {
  base64?: string | null;
  pairingCode?: string | null;
  code?: string | null;
}

export interface SendMessageInput {
  connection: WhatsAppConnection;
  to: string;
  text: string;
}

export interface NumberLookupResult {
  exists: boolean;
  /** Chat id WhatsApp uses for this number, e.g. 919800011122@s.whatsapp.net. */
  jid: string | null;
  phone: string;
  /** Name WhatsApp reports for the number, when it has one. */
  name: string | null;
}

export interface SendMessageResult {
  waMessageId: string | null;
  raw: unknown;
}

export interface NormalizedIncomingMessage {
  kind: "message";
  instanceName: string;
  waMessageId: string;
  fromMe: boolean;
  customerPhone: string;
  customerJid: string;
  text: string | null;
  type: string;
  pushName: string | null;
  timestamp: Date;
  status: MessageStatus;
  media?: MessageMedia | null;
  raw: unknown;
}

export interface NormalizedConnectionUpdate {
  kind: "connection";
  instanceName: string;
  state: string;
  phoneNumber: string | null;
  raw: unknown;
}

export interface NormalizedQrUpdate {
  kind: "qr";
  instanceName: string;
  qr: QrPayload;
  raw: unknown;
}

export interface NormalizedStatusUpdate {
  kind: "status";
  instanceName: string;
  waMessageId: string;
  status: MessageStatus;
  raw: unknown;
}

export type NormalizedIncomingEvent =
  | NormalizedIncomingMessage
  | NormalizedConnectionUpdate
  | NormalizedQrUpdate
  | NormalizedStatusUpdate;

export interface WhatsAppProvider {
  readonly kind: ProviderKind;
  connectNumber(tenantId: string, instanceName: string): Promise<ConnectNumberResult>;
  switchNumber(tenantId: string, oldConnection: WhatsAppConnection, instanceName: string): Promise<ConnectNumberResult>;
  disconnectNumber(connection: WhatsAppConnection): Promise<void>;
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
  sendImage(input: SendImageInput): Promise<SendMessageResult>;
  resolveIncomingMedia?(event: NormalizedIncomingMessage): Promise<MessageMedia | null>;
  lookupNumber(connection: WhatsAppConnection, phone: string): Promise<NumberLookupResult>;
  /** Re-register the inbound webhook (URL + secret) for an existing instance. */
  syncWebhook?(connection: WhatsAppConnection): Promise<void>;
  getQr(connection: WhatsAppConnection): Promise<QrPayload | null>;
  getRemoteStatus(connection: WhatsAppConnection): Promise<{
    state: string;
    phoneNumber: string | null;
  }>;
  onIncoming(raw: unknown): NormalizedIncomingEvent | null;
}

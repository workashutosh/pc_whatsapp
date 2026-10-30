import type {
  ConnectNumberResult,
  NormalizedIncomingEvent,
  NumberLookupResult,
  QrPayload,
  SendImageInput,
  SendMessageInput,
  SendMessageResult,
  WhatsAppConnection,
  WhatsAppProvider,
} from "../types.js";

export class CloudAPIProvider implements WhatsAppProvider {
  readonly kind = "cloud_api" as const;

  async connectNumber(): Promise<ConnectNumberResult> {
    this.unsupported();
  }

  async switchNumber(): Promise<ConnectNumberResult> {
    this.unsupported();
  }

  async disconnectNumber(): Promise<void> {
    this.unsupported();
  }

  async lookupNumber(_connection: WhatsAppConnection, _phone: string): Promise<NumberLookupResult> {
    this.unsupported();
  }

  async sendMessage(_input: SendMessageInput): Promise<SendMessageResult> {
    this.unsupported();
  }

  async sendImage(_input: SendImageInput): Promise<SendMessageResult> {
    this.unsupported();
  }

  async getQr(_connection: WhatsAppConnection): Promise<QrPayload | null> {
    this.unsupported();
  }

  async getRemoteStatus(_connection: WhatsAppConnection): Promise<{
    state: string;
    phoneNumber: string | null;
  }> {
    this.unsupported();
  }

  onIncoming(_raw: unknown): NormalizedIncomingEvent | null {
    this.unsupported();
  }

  private unsupported(): never {
    throw new Error(
      "CloudAPIProvider is not implemented yet. Keep this tenant on Evolution until Meta Tech Provider access is ready, then implement the same WhatsAppProvider methods against Cloud API.",
    );
  }
}

import type {
  ConnectNumberResult,
  NormalizedIncomingEvent,
  QrPayload,
  SendImageInput,
  SendMessageInput,
  SendMessageResult,
  WhatsAppConnection,
  WhatsAppProvider,
} from "../types.js";

export class DemoProvider implements WhatsAppProvider {
  readonly kind = "demo" as const;

  async connectNumber(tenantId: string, instanceName: string): Promise<ConnectNumberResult> {
    return {
      connection: {
        id: "",
        tenant_id: tenantId,
        provider: "demo",
        instance_name: instanceName,
        phone_number: "15550001000",
        waba_id: null,
        phone_number_id: null,
        access_token: null,
        status: "connected",
        connected_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
      qr: demoQr(),
    };
  }

  async switchNumber(
    tenantId: string,
    _oldConnection: WhatsAppConnection,
    instanceName: string,
  ): Promise<ConnectNumberResult> {
    return this.connectNumber(tenantId, instanceName);
  }

  async disconnectNumber(_connection: WhatsAppConnection): Promise<void> {
    return;
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    return {
      waMessageId: `demo-${Date.now()}`,
      raw: { demo: true, to: input.to, text: input.text },
    };
  }

  async sendImage(input: SendImageInput): Promise<SendMessageResult> {
    return {
      waMessageId: `demo-img-${Date.now()}`,
      raw: { demo: true, to: input.to, image: true, caption: input.caption ?? null },
    };
  }

  async getQr(_connection: WhatsAppConnection): Promise<QrPayload | null> {
    return demoQr();
  }

  async getRemoteStatus(_connection: WhatsAppConnection): Promise<{
    state: string;
    phoneNumber: string | null;
  }> {
    return { state: "open", phoneNumber: "15550001000" };
  }

  onIncoming(_raw: unknown): NormalizedIncomingEvent | null {
    return null;
  }
}

function demoQr(): QrPayload {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="280" viewBox="0 0 280 280">
    <rect width="280" height="280" fill="#fff"/>
    <rect x="24" y="24" width="72" height="72" fill="#111"/>
    <rect x="184" y="24" width="72" height="72" fill="#111"/>
    <rect x="24" y="184" width="72" height="72" fill="#111"/>
    <rect x="48" y="48" width="24" height="24" fill="#fff"/>
    <rect x="208" y="48" width="24" height="24" fill="#fff"/>
    <rect x="48" y="208" width="24" height="24" fill="#fff"/>
    <rect x="120" y="120" width="40" height="40" fill="#25d366"/>
    <text x="140" y="268" text-anchor="middle" font-family="sans-serif" font-size="14">Demo mode</text>
  </svg>`;
  return {
    base64: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
  };
}

import { useState } from "react";
import { api } from "../api";
import type { Connection, QrPayload, SessionAgent } from "../types";

/** WhatsApp number login / QR — core channel UI. */
export function SetupPanel({
  agent,
  connections,
  qr,
  error,
  onError,
  onQr,
  onRefresh,
}: {
  agent: SessionAgent;
  connections: Connection[];
  qr: QrPayload | null;
  error: string;
  onError: (value: string) => void;
  onQr: (value: QrPayload | null) => void;
  onRefresh: () => Promise<void>;
}) {
  const [inboundPhone, setInboundPhone] = useState("919800011122");
  const [inboundText, setInboundText] = useState("Hi, I need help with my order");
  const live = connections.find((item) => item.status === "connected" || item.status === "pending");

  async function connect() {
    onError("");
    try {
      const result = live ? await api.switchNumber() : await api.connect();
      onQr(result.qr);
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Connect failed");
    }
  }

  async function refreshQr() {
    if (!live) return;
    const result = await api.qr(live.id);
    onQr(result.qr);
    await onRefresh();
  }

  return (
    <section className="setup">
      <div className="setup-head">
        <h2>WhatsApp number</h2>
        <div className="meta">{agent.tenantName} · one number per tenant</div>
      </div>
      <div className="details-body">
        {error ? <div className="error">{error}</div> : null}
        <div className="card">
          <strong>{live?.status === "connected" ? "Connected" : "Link a number"}</strong>
          <div className="meta">
            Scan this QR in WhatsApp or WhatsApp Business: Settings → Linked devices → Link a device.
            The code refreshes; wait until the status says connected.
          </div>
          <div className="actions">
            <button className="primary" onClick={connect}>
              {live ? "Switch number" : "Connect number"}
            </button>
            {live ? <button className="ghost" onClick={refreshQr}>Refresh QR</button> : null}
            {live ? (
              <button className="danger" onClick={() => api.disconnect(live.id).then(onRefresh)}>
                Disconnect
              </button>
            ) : null}
          </div>
        </div>
        {qr?.base64 ? <img className="qr" src={qr.base64} alt="WhatsApp QR code" /> : null}
        {qr?.pairingCode ? <div className="card">Pairing code: {qr.pairingCode}</div> : null}
        {live?.provider === "demo" ? (
          <div className="card">
            <strong>Simulate inbound</strong>
            <div className="meta">Pretend a customer messaged this tenant number.</div>
            <input value={inboundPhone} onChange={(e) => setInboundPhone(e.target.value)} placeholder="Customer phone" />
            <textarea value={inboundText} onChange={(e) => setInboundText(e.target.value)} placeholder="Message" />
            <button
              className="ghost"
              onClick={async () => {
                onError("");
                try {
                  await api.simulate({ phone: inboundPhone, text: inboundText, name: "Priya" });
                  await onRefresh();
                } catch (err) {
                  onError(err instanceof Error ? err.message : "Simulate failed");
                }
              }}
            >
              Send inbound message
            </button>
          </div>
        ) : null}
        {connections.map((connection) => (
          <div className="card" key={connection.id}>
            <strong>{connection.phone_number || connection.instance_name}</strong>
            <span className={`badge ${connection.status === "connected" ? "ok" : connection.status === "banned" ? "bad" : "warn"}`}>
              {connection.status}
            </span>
            <div className="meta">{connection.provider} · {new Date(connection.created_at).toLocaleString()}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

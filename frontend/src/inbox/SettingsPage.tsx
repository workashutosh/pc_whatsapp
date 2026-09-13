import { FormEvent, useEffect, useState } from "react";
import { SetupPanel } from "../channel/SetupPanel";
import { api, setSession } from "../api";
import type { Connection, IpAllowlist, QrPayload, SessionAgent } from "../types";

export function SettingsPage({
  agent,
  connections,
  qr,
  error,
  onError,
  onQr,
  onRefresh,
  onAgent,
}: {
  agent: SessionAgent;
  connections: Connection[];
  qr: QrPayload | null;
  error: string;
  onError: (value: string) => void;
  onQr: (value: QrPayload | null) => void;
  onRefresh: () => Promise<void>;
  onAgent: (agent: SessionAgent) => void;
}) {
  const [seePhone, setSeePhone] = useState(agent.agentsCanSeePhone);
  const [seeHistory, setSeeHistory] = useState(agent.agentsCanSeeHistory !== false);
  const [allowlist, setAllowlist] = useState<IpAllowlist | null>(null);
  const [newIp, setNewIp] = useState("");
  const [savingIps, setSavingIps] = useState(false);

  useEffect(() => {
    api.ipAllowlist()
      .then(setAllowlist)
      .catch((err) => onError(err instanceof Error ? err.message : "Could not load IP settings"));
  }, [onError]);

  async function saveVisibility() {
    onError("");
    try {
      const { tenant } = await api.updateTenant({
        agentsCanSeePhone: seePhone,
        agentsCanSeeHistory: seeHistory,
      });
      const next = {
        ...agent,
        agentsCanSeePhone: tenant.agentsCanSeePhone,
        agentsCanSeeHistory: tenant.agentsCanSeeHistory,
        seePhone: agent.role === "agent" ? tenant.agentsCanSeePhone : true,
      };
      setSession(next);
      onAgent(next);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save settings");
    }
  }

  async function toggleAllowAll(allowAllIps: boolean) {
    onError("");
    setSavingIps(true);
    try {
      setAllowlist(await api.setIpAllowlist(allowAllIps));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not update IP access");
    } finally {
      setSavingIps(false);
    }
  }

  async function addIp(event: FormEvent) {
    event.preventDefault();
    onError("");
    setSavingIps(true);
    try {
      const next = await api.addAllowedIp(newIp.trim() || undefined);
      setAllowlist(next);
      setNewIp("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not add IP");
    } finally {
      setSavingIps(false);
    }
  }

  async function removeIp(id: string) {
    onError("");
    setSavingIps(true);
    try {
      setAllowlist(await api.removeAllowedIp(id));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not remove IP");
    } finally {
      setSavingIps(false);
    }
  }

  return (
    <section className="page settings-page">
      <div className="page-head">
        <div>
          <h2>Settings</h2>
          <div className="meta">Tenant policies and WhatsApp line</div>
        </div>
      </div>
      {error ? <div className="error settings-error">{error}</div> : null}
      <div className="card">
        <strong>Contact numbers</strong>
        <label className="check">
          <input type="checkbox" checked={seePhone} onChange={(e) => setSeePhone(e.target.checked)} />
          Agents can see full customer numbers
        </label>
        <label className="check">
          <input type="checkbox" checked={seeHistory} onChange={(e) => setSeeHistory(e.target.checked)} />
          New assigned agents can see previous messages
        </label>
        <div className="meta">
          Managers and super admins always see numbers and full history. Uncheck the second option to hide
          earlier messages when you assign a chat, unless you allow it on that assignment.
        </div>
        <div className="actions">
          <button className="primary" type="button" onClick={() => void saveVisibility()}>Save</button>
        </div>
      </div>
      <div className="card">
        <strong>Allowed login IPs</strong>
        <label className="check">
          <input
            type="checkbox"
            checked={allowlist?.allowAllIps ?? true}
            disabled={!allowlist || savingIps}
            onChange={(e) => void toggleAllowAll(e.target.checked)}
          />
          Allow all IPs
        </label>
        <div className="meta">
          When unchecked, only the IPs below can sign in. Your current IP is{" "}
          <code>{allowlist?.currentIp || "…"}</code>.
        </div>
        {allowlist && !allowlist.allowAllIps ? (
          <>
            <ul className="ip-list">
              {allowlist.ips.length === 0 ? (
                <li className="meta">No IPs yet. Your current IP will be added when you turn this on.</li>
              ) : (
                allowlist.ips.map((item) => (
                  <li key={item.id} className="ip-row">
                    <code>{item.ip}</code>
                    {item.ip === allowlist.currentIp ? <span className="badge ok">This device</span> : null}
                    <button
                      className="ghost"
                      type="button"
                      disabled={savingIps}
                      onClick={() => void removeIp(item.id)}
                    >
                      Remove
                    </button>
                  </li>
                ))
              )}
            </ul>
            <form className="ip-add" onSubmit={addIp}>
              <input
                value={newIp}
                onChange={(e) => setNewIp(e.target.value)}
                placeholder={allowlist.currentIp || "203.0.113.10"}
              />
              <button className="primary" type="submit" disabled={savingIps}>
                Add IP
              </button>
            </form>
          </>
        ) : null}
      </div>
      <SetupPanel
        agent={agent}
        connections={connections}
        qr={qr}
        error=""
        onError={onError}
        onQr={onQr}
        onRefresh={onRefresh}
      />
    </section>
  );
}

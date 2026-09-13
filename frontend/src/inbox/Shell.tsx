import { useEffect, useState } from "react";
import { api } from "../api";
import type { Connection, QrPayload, SessionAgent } from "../types";
import { canManage } from "../types";
import { InboxPage } from "./InboxPage";
import { PeoplePage } from "./PeoplePage";
import { SettingsPage } from "./SettingsPage";

type Page = "inbox" | "people" | "settings";

export function Shell({ agent, onLogout, onAgent }: {
  agent: SessionAgent;
  onLogout: () => void;
  onAgent: (agent: SessionAgent) => void;
}) {
  const [page, setPage] = useState<Page>("inbox");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [qr, setQr] = useState<QrPayload | null>(null);
  const [error, setError] = useState("");

  async function refreshConnections() {
    const { connections: next } = await api.connections();
    setConnections(next);
  }

  useEffect(() => {
    refreshConnections().catch((err) => setError(err.message));
  }, []);

  const layout = page === "inbox" ? "app inbox-layout" : "app page-layout";

  return (
    <div className={layout}>
      <aside className="rail">
        <div className="brand">IN</div>
        <button className={`rail-btn ${page === "inbox" ? "active" : ""}`} onClick={() => setPage("inbox")}>
          Inbox
        </button>
        {canManage(agent.role) ? (
          <button className={`rail-btn ${page === "people" ? "active" : ""}`} onClick={() => setPage("people")}>
            People
          </button>
        ) : null}
        {agent.role === "super_admin" ? (
          <button className={`rail-btn ${page === "settings" ? "active" : ""}`} onClick={() => setPage("settings")}>
            Settings
          </button>
        ) : null}
        <div className="rail-user">
          <strong>{agent.name}</strong>
          <span>{agent.role.replace("_", " ")}</span>
        </div>
        <button className="ghost" onClick={onLogout}>Sign out</button>
      </aside>

      {page === "inbox" ? (
        <InboxPage
          agent={agent}
          connections={connections}
          onConnections={setConnections}
          error={error}
          onError={setError}
        />
      ) : null}
      {page === "people" ? <PeoplePage agent={agent} onError={setError} /> : null}
      {page === "settings" ? (
        <SettingsPage
          agent={agent}
          connections={connections}
          qr={qr}
          error={error}
          onError={setError}
          onQr={setQr}
          onRefresh={refreshConnections}
          onAgent={onAgent}
        />
      ) : null}
    </div>
  );
}

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { SetupPanel } from "./channel/SetupPanel";
import { Login } from "./inbox/Login";
import { api, loadSession, setSession } from "./api";
import type {
  Agent,
  Connection,
  Conversation,
  Message,
  Note,
  QrPayload,
  SessionAgent,
} from "./types";

type Tab = "inbox" | "setup";
type Filter = "all" | "mine" | "unassigned";

export function App() {
  const [agent, setAgent] = useState<SessionAgent | null>(loadSession());
  if (!agent) return <Login onLogin={setAgent} />;
  return <Shell agent={agent} onLogout={() => { setSession(null); setAgent(null); }} />;
}

function Shell({ agent, onLogout }: { agent: SessionAgent; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("inbox");
  const [filter, setFilter] = useState<Filter>("all");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [qr, setQr] = useState<QrPayload | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const selected = (conversations ?? []).find((item) => item.id === selectedId) ?? null;
  const live = (connections ?? []).find((item) => item.status === "connected" || item.status === "pending") ?? null;

  async function refreshInbox() {
    const [{ conversations: next }, { connections: nextConnections }, { agents: nextAgents }] =
      await Promise.all([api.conversations(filter), api.connections(), api.agents()]);
    setConversations(next ?? []);
    setConnections(nextConnections ?? []);
    setAgents(nextAgents ?? []);
  }

  async function openConversation(id: string) {
    setSelectedId(id);
    setError("");
    const [{ messages: nextMessages }, { notes: nextNotes }] = await Promise.all([
      api.messages(id),
      api.notes(id),
    ]);
    setMessages(nextMessages ?? []);
    setNotes(nextNotes ?? []);
    try {
      await api.lock(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not lock conversation");
    }
  }

  useEffect(() => {
    refreshInbox().catch((err) => setError(err.message));
  }, [filter]);

  useEffect(() => {
    const socket = io(api.url, {
      auth: { tenantId: agent.tenantId, agentId: agent.id },
      maxHttpBufferSize: 15 * 1024 * 1024,
    });
    socket.on("conversation:updated", (conversation: Conversation) => {
      setConversations((current) => upsert(current, conversation));
    });
    socket.on("message:new", (message: Message) => {
      setMessages((current) =>
        current.some((item) => item.id === message.id) ? current : [...current, message],
      );
    });
    socket.on("message:updated", (message: Message) => {
      setMessages((current) => current.map((item) => (item.id === message.id ? message : item)));
    });
    socket.on("note:new", (note: Note) => {
      setNotes((current) => (current.some((item) => item.id === note.id) ? current : [...current, note]));
    });
    socket.on("connection:updated", (payload: { connection: Connection; qr?: QrPayload | null }) => {
      setConnections((current) => {
        const remaining = current.filter((item) => item.id !== payload.connection.id);
        return [payload.connection, ...remaining].sort((a, b) => b.created_at.localeCompare(a.created_at));
      });
      if (payload.qr) setQr(payload.qr);
    });
    socket.on("qr:updated", (payload: { qr: QrPayload | null }) => setQr(payload.qr));
    return () => {
      socket.disconnect();
    };
  }, [agent]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages, notes, selectedId]);

  useEffect(() => {
    return () => {
      if (selectedId) api.unlock(selectedId).catch(() => undefined);
    };
  }, [selectedId]);

  const timeline = useMemo(() => {
    const items = [
      ...messages.map((message) => ({ kind: "message" as const, at: message.created_at, message })),
      ...notes.map((note) => ({ kind: "note" as const, at: note.created_at, note })),
    ];
    return items.sort((a, b) => a.at.localeCompare(b.at));
  }, [messages, notes]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!selectedId || sending) return;
    const text = draft;
    const image = pendingImage;
    if (!text.trim() && !image) return;
    setDraft("");
    setPendingImage(null);
    setSending(true);
    setError("");
    try {
      const result = await api.send(
        selectedId,
        text,
        image
          ? { base64: image.dataUrl, mimetype: image.mimetype, filename: image.filename }
          : undefined,
      );
      setMessages((current) =>
        current.some((item) => item.id === result.message.id) ? current : [...current, result.message],
      );
      setConversations((current) => upsert(current, result.conversation));
    } catch (err) {
      setDraft(text);
      setPendingImage(image);
      setError(err instanceof Error ? err.message : "Send failed");
      const { messages: next } = await api.messages(selectedId).catch(() => ({ messages: [] }));
      if (next.length) setMessages(next);
    } finally {
      setSending(false);
    }
  }

  function attachImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
      setError("Only JPEG, PNG, WebP, and GIF images are supported");
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setError("Image is too large (max 6 MB)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) {
        setError("Could not read that image");
        return;
      }
      setPendingImage({ dataUrl, mimetype: file.type, filename: file.name });
      setError("");
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="app">
      <aside className="rail">
        <div className="brand">WA</div>
        <button className={`rail-btn ${tab === "inbox" ? "active" : ""}`} onClick={() => setTab("inbox")} title="Inbox">
          ⌂
        </button>
        <button className={`rail-btn ${tab === "setup" ? "active" : ""}`} onClick={() => setTab("setup")} title="Number">
          ⌁
        </button>
        <div className="agent-pill">
          <span className="dot" />
        </div>
        <button className="ghost" onClick={onLogout}>Out</button>
      </aside>

      {tab === "inbox" ? (
        <section className="inbox">
          <div className="inbox-head">
            <h2>{agent.tenantName}</h2>
            <div className="meta">{agent.name} · {live?.phone_number ?? live?.status ?? "no number"}</div>
            <div className="filters">
              {(["all", "mine", "unassigned"] as Filter[]).map((item) => (
                <button key={item} className={`chip ${filter === item ? "active" : ""}`} onClick={() => setFilter(item)}>
                  {item}
                </button>
              ))}
            </div>
          </div>
          <div className="list">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                className={`row ${conversation.id === selectedId ? "active" : ""}`}
                onClick={() => openConversation(conversation.id)}
              >
                <strong>{conversation.customer_name || conversation.customer_phone}</strong>
                <div className="preview">{conversation.last_message_text || "No messages yet"}</div>
                <span>
                  {conversation.assigned_agent_name ?? "Unassigned"}
                  {conversation.locked_by_agent_name ? ` · locked by ${conversation.locked_by_agent_name}` : ""}
                </span>
              </button>
            ))}
            {conversations.length === 0 ? <div className="empty">No conversations yet.</div> : null}
          </div>
        </section>
      ) : (
        <SetupPanel
          agent={agent}
          connections={connections}
          qr={qr}
          error={error}
          onError={setError}
          onQr={setQr}
          onRefresh={refreshInbox}
        />
      )}

      {tab === "inbox" && selected ? (
        <section className="chat">
          <div className="chat-head">
            <div>
              <h2>{selected.customer_name || selected.customer_phone}</h2>
              <div className="meta">{selected.customer_phone}</div>
            </div>
            <span className={`badge ${selected.status === "open" ? "ok" : "warn"}`}>{selected.status}</span>
          </div>
          <div className="thread" ref={threadRef}>
            {timeline.map((item) =>
              item.kind === "note" ? (
                <div className="bubble note" key={item.note.id}>
                  Internal note · {item.note.agent_name ?? "agent"}
                  <div>{item.note.note}</div>
                  <span className="time">{formatTime(item.note.created_at)}</span>
                </div>
              ) : (
                <div
                  className={`bubble ${item.message.direction}${item.message.status === "failed" ? " failed" : ""}`}
                  key={item.message.id}
                >
                  {item.message.payload.media?.kind === "image" && item.message.payload.media.dataUrl ? (
                    <img
                      className="media"
                      src={item.message.payload.media.dataUrl}
                      alt={item.message.payload.text || "Photo"}
                    />
                  ) : null}
                  {messageCaption(item.message)}
                  <span className="time">
                    {formatTime(item.message.created_at)} · {item.message.status}
                  </span>
                </div>
              ),
            )}
          </div>
          <form className="composer" onSubmit={send}>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              hidden
              onChange={attachImage}
            />
            <button
              className="ghost attach"
              type="button"
              title="Attach image"
              onClick={() => fileRef.current?.click()}
              disabled={sending}
            >
              📎
            </button>
            <div className="composer-main">
              {pendingImage ? (
                <div className="composer-preview">
                  <img src={pendingImage.dataUrl} alt={pendingImage.filename} />
                  <button className="ghost" type="button" onClick={() => setPendingImage(null)}>
                    Remove
                  </button>
                </div>
              ) : null}
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={pendingImage ? "Add a caption (optional)" : "Reply to the customer on WhatsApp"}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
            </div>
            <button className="primary" type="submit" disabled={sending || (!draft.trim() && !pendingImage)}>
              {sending ? "Sending…" : "Send"}
            </button>
          </form>
        </section>
      ) : tab === "inbox" ? (
        <div className="empty">Select a conversation or connect a WhatsApp number first.</div>
      ) : (
        <div className="empty">
          <div>
            <h2>Number setup</h2>
            <p>Scan the QR from WhatsApp → Linked devices on a spare test number.</p>
          </div>
        </div>
      )}

      <aside className="details">
        <div className="details-head">
          <h2>{agent.name}</h2>
          <div className="meta">{agent.email}</div>
        </div>
        <div className="details-body">
          {error ? <div className="error">{error}</div> : null}
          <div className="card">
            <strong>Connection</strong>
            <span className={`badge ${live?.status === "connected" ? "ok" : "warn"}`}>
              {live?.provider ?? "evolution"} · {live?.status ?? "none"}
            </span>
            <div className="meta">{live?.phone_number ?? "No live number"}</div>
          </div>
          {selected ? (
            <>
              <div className="card">
                <strong>Assignment</strong>
                <select
                  value={selected.assigned_agent_id ?? ""}
                  onChange={async (event) => {
                    const value = event.target.value || null;
                    const { conversation } = await api.assign(selected.id, value);
                    setConversations((current) => upsert(current, conversation));
                  }}
                >
                  <option value="">Unassigned</option>
                  {agents.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
                <div className="actions">
                  <button className="ghost" onClick={() => api.claim(selected.id).then(({ conversation }) => {
                    setConversations((current) => upsert(current, conversation));
                  })}>Claim</button>
                  <button className="ghost" onClick={() => api.setStatus(selected.id, selected.status === "closed" ? "open" : "closed").then(({ conversation }) => {
                    setConversations((current) => upsert(current, conversation));
                  })}>
                    {selected.status === "closed" ? "Reopen" : "Close"}
                  </button>
                </div>
              </div>
              <div className="card">
                <strong>Internal note</strong>
                <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Visible only to agents" />
                <button
                  className="ghost"
                  onClick={async () => {
                    if (!noteDraft.trim()) return;
                    await api.addNote(selected.id, noteDraft);
                    setNoteDraft("");
                    const { notes: next } = await api.notes(selected.id);
                    setNotes(next);
                  }}
                >
                  Add note
                </button>
              </div>
            </>
          ) : (
            <div className="card">Open a conversation to assign, lock, and add notes.</div>
          )}
        </div>
      </aside>
    </div>
  );
}

function upsert(list: Conversation[], conversation: Conversation): Conversation[] {
  const next = list.filter((item) => item.id !== conversation.id);
  return [conversation, ...next].sort((a, b) =>
    (b.last_message_at ?? b.id).localeCompare(a.last_message_at ?? a.id),
  );
}

type PendingImage = {
  dataUrl: string;
  mimetype: string;
  filename: string;
};

function messageCaption(message: Message): string {
  const text = message.payload.text?.trim();
  const isImage = message.payload.media?.kind === "image" || message.payload.type === "imageMessage";
  if (isImage) {
    if (text && text !== "[image]") return text;
    return message.payload.media?.dataUrl ? "" : "Photo";
  }
  return message.payload.text || `[${message.payload.type}]`;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

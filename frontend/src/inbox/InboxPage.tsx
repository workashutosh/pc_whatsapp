import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { api } from "../api";
import { apiUrl, authHeaders } from "../lib/http";
import type { Agent, ChatFilters, Connection, Conversation, Message, Note, SessionAgent } from "../types";
import { canManage } from "../types";

export function InboxPage({
  agent,
  connections,
  onConnections,
  error,
  onError,
}: {
  agent: SessionAgent;
  connections: Connection[];
  onConnections: (connections: Connection[]) => void;
  error: string;
  onError: (value: string) => void;
}) {
  const manager = canManage(agent.role);
  const [filters, setFilters] = useState<ChatFilters>({
    q: "",
    status: "all",
    assignedAgentId: "all",
  });
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [draft, setDraft] = useState("");
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [canSeeHistory, setCanSeeHistory] = useState(agent.agentsCanSeeHistory !== false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const selected = conversations.find((item) => item.id === selectedId) ?? null;
  const live = connections.find((item) => item.status === "connected" || item.status === "pending") ?? null;
  const historyHidden = Boolean(
    selected && (selected.assignee_can_see_history === 0 || selected.assignee_can_see_history === false),
  );

  async function refreshInbox() {
    const [{ conversations: next }, { connections: nextConnections }, { agents: nextAgents }] =
      await Promise.all([api.conversations(filters), api.connections(), api.agents({ status: "active" })]);
    setConversations(next ?? []);
    onConnections(nextConnections ?? []);
    setAgents(nextAgents ?? []);
  }

  async function openConversation(id: string) {
    setSelectedId(id);
    onError("");
    const [{ messages: nextMessages }, { notes: nextNotes }] = await Promise.all([
      api.messages(id),
      api.notes(id),
    ]);
    setMessages(nextMessages ?? []);
    setNotes(nextNotes ?? []);
    const conversation = conversations.find((item) => item.id === id);
    const assignedToOther = Boolean(
      conversation?.assigned_agent_id && conversation.assigned_agent_id !== agent.id,
    );
    if (assignedToOther) return;
    try {
      await api.lock(id);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not lock conversation");
    }
  }

  useEffect(() => {
    refreshInbox().catch((err) => onError(err.message));
  }, [filters.q, filters.status, filters.assignedAgentId]);

  useEffect(() => {
    if (!selected) {
      setCanSeeHistory(agent.agentsCanSeeHistory !== false);
      return;
    }
    if (selected.assignee_can_see_history === 0 || selected.assignee_can_see_history === false) {
      setCanSeeHistory(false);
    } else if (selected.assigned_agent_id) {
      setCanSeeHistory(true);
    } else {
      setCanSeeHistory(agent.agentsCanSeeHistory !== false);
    }
  }, [selected, agent.agentsCanSeeHistory]);

  useEffect(() => {
    const socket = io(api.url, {
      auth: { token: agent.token },
    });
    socket.on("conversation:updated", (conversation: Conversation) => {
      setConversations((current) => {
        if (agent.role === "agent" && conversation.assigned_agent_id !== agent.id) {
          return current.filter((item) => item.id !== conversation.id);
        }
        return upsert(current, conversation);
      });
      if (agent.role === "agent" && conversation.assigned_agent_id !== agent.id && selectedIdRef.current === conversation.id) {
        setSelectedId(null);
        setMessages([]);
        setNotes([]);
      }
    });
    socket.on("message:new", (message: Message) => {
      if (message.conversation_id !== selectedIdRef.current) return;
      setMessages((current) =>
        current.some((item) => item.id === message.id) ? current : [...current, message],
      );
    });
    socket.on("message:updated", (message: Message) => {
      if (message.conversation_id !== selectedIdRef.current) return;
      setMessages((current) => current.map((item) => (item.id === message.id ? message : item)));
    });
    socket.on("note:new", (note: Note) => {
      if (note.conversation_id !== selectedIdRef.current) return;
      setNotes((current) => (current.some((item) => item.id === note.id) ? current : [...current, note]));
    });
    return () => {
      socket.disconnect();
    };
  }, [agent]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages, notes, selectedId]);

  useEffect(() => {
    const conversationId = selectedId;
    return () => {
      if (!conversationId) return;
      void fetch(`${apiUrl()}/api/conversations/${conversationId}/unlock`, {
        method: "POST",
        headers: authHeaders(),
      }).catch(() => undefined);
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
    if (!selectedId || sending || selected?.status === "closed") return;
    const text = draft;
    const image = pendingImage;
    if (!text.trim() && !image) return;
    setDraft("");
    setPendingImage(null);
    setSending(true);
    onError("");
    try {
      const result = await api.send(
        selectedId,
        text,
        image ? { base64: image.dataUrl, mimetype: image.mimetype, filename: image.filename } : undefined,
      );
      setMessages((current) =>
        current.some((item) => item.id === result.message.id) ? current : [...current, result.message],
      );
      setConversations((current) => upsert(current, result.conversation));
    } catch (err) {
      setDraft(text);
      setPendingImage(image);
      onError(err instanceof Error ? err.message : "Send failed");
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
      onError("Only JPEG, PNG, WebP, and GIF images are supported");
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      onError("Image is too large (max 6 MB)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) {
        onError("Could not read that image");
        return;
      }
      setPendingImage({ dataUrl, mimetype: file.type, filename: file.name });
      onError("");
    };
    reader.readAsDataURL(file);
  }

  return (
    <>
      <section className="inbox">
        <div className="inbox-head">
          <div className="inbox-title">
            <h2>Inbox</h2>
            {manager ? (
              <button
                className="ghost"
                type="button"
                onClick={() => setNewChatOpen((open) => !open)}
                disabled={live?.status !== "connected"}
                title={live?.status === "connected" ? "Message a new number" : "Connect a WhatsApp number first"}
              >
                {newChatOpen ? "Cancel" : "+ New chat"}
              </button>
            ) : null}
          </div>
          <div className="meta">{live?.phone_number ?? live?.status ?? "No number"}</div>
          <div className="toolbar">
            <input
              value={filters.q}
              onChange={(e) => setFilters((current) => ({ ...current, q: e.target.value }))}
              placeholder="Search"
            />
            <select
              value={filters.status}
              onChange={(e) => setFilters((current) => ({ ...current, status: e.target.value as ChatFilters["status"] }))}
            >
              <option value="all">All status</option>
              <option value="open">Open</option>
              <option value="closed">Stopped</option>
            </select>
            {manager ? (
              <select
                value={filters.assignedAgentId}
                onChange={(e) => setFilters((current) => ({ ...current, assignedAgentId: e.target.value }))}
              >
                <option value="all">All assignees</option>
                <option value="unassigned">Unassigned</option>
                <option value="me">Assigned to me</option>
                {agents.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            ) : null}
          </div>
        </div>
        {newChatOpen ? (
          <NewChatForm
            onError={onError}
            onStarted={(conversation) => {
              setNewChatOpen(false);
              setConversations((current) => upsert(current, conversation));
              void openConversation(conversation.id);
            }}
          />
        ) : null}
        <div className="list">
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              className={`row ${conversation.id === selectedId ? "active" : ""}`}
              onClick={() => openConversation(conversation.id)}
            >
              <strong>{conversation.customer_name || conversation.customer_phone}</strong>
              <div className="preview">{conversation.last_message_text || "No messages"}</div>
              <span>
                {conversation.status}
                {manager ? ` · ${conversation.assigned_agent_name ?? "Unassigned"}` : ""}
              </span>
            </button>
          ))}
          {conversations.length === 0 ? <div className="empty-inline">No conversations.</div> : null}
        </div>
      </section>

      {selected ? (
        <section className="chat">
          <div className="chat-head">
            <div>
              <h2>{selected.customer_name || selected.customer_phone}</h2>
              <div className="meta">{agent.seePhone ? selected.customer_phone : selected.customer_phone}</div>
            </div>
            <span className={`badge ${selected.status === "open" ? "ok" : "warn"}`}>{selected.status}</span>
          </div>
          <div className="thread" ref={threadRef}>
            {historyHidden ? (
              <div className="history-hidden">Earlier messages are hidden for this assignment.</div>
            ) : null}
            {timeline.map((item) =>
              item.kind === "note" ? (
                <div className="bubble note" key={item.note.id}>
                  Note · {item.note.agent_name ?? "agent"}
                  <div>{item.note.note}</div>
                  <span className="time">{formatTime(item.note.created_at)}</span>
                </div>
              ) : (
                <div
                  className={`bubble ${item.message.direction}${item.message.status === "failed" ? " failed" : ""}`}
                  key={item.message.id}
                >
                  {item.message.payload.media?.kind === "image" && item.message.payload.media.dataUrl ? (
                    <img className="media" src={item.message.payload.media.dataUrl} alt={item.message.payload.text || "Photo"} />
                  ) : null}
                  {messageCaption(item.message)}
                  <span className="time">
                    {formatTime(item.message.created_at)} · {item.message.status}
                  </span>
                </div>
              ),
            )}
          </div>
          {selected.status === "closed" ? (
            <div className="composer stopped">Conversation stopped. A manager must reopen it to send.</div>
          ) : (
            <form className="composer" onSubmit={send}>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                hidden
                onChange={attachImage}
              />
              <button className="ghost attach" type="button" onClick={() => fileRef.current?.click()} disabled={sending}>
                +
              </button>
              <div className="composer-main">
                {pendingImage ? (
                  <div className="composer-preview">
                    <img src={pendingImage.dataUrl} alt={pendingImage.filename} />
                    <button className="ghost" type="button" onClick={() => setPendingImage(null)}>Remove</button>
                  </div>
                ) : null}
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={pendingImage ? "Caption (optional)" : "Message"}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                />
              </div>
              <button className="primary" type="submit" disabled={sending || (!draft.trim() && !pendingImage)}>
                {sending ? "Sending" : "Send"}
              </button>
            </form>
          )}
        </section>
      ) : (
        <div className="empty">Select a conversation.</div>
      )}

      <aside className="details">
        <div className="details-head">
          <h2>{agent.name}</h2>
          <div className="meta">{roleText(agent.role)}</div>
        </div>
        <div className="details-body">
          {error ? <div className="error">{error}</div> : null}
          <div className="card">
            <strong>Line</strong>
            <span className={`badge ${live?.status === "connected" ? "ok" : "warn"}`}>{live?.status ?? "none"}</span>
            <div className="meta">{live?.phone_number ?? "Not connected"}</div>
          </div>
          {selected ? (
            <>
              {manager ? (
                <div className="card">
                  <strong>Assignment</strong>
                  <select
                    value={selected.assigned_agent_id ?? ""}
                    onChange={async (event) => {
                      const value = event.target.value || null;
                      const { conversation } = await api.assign(selected.id, value, {
                        canSeeHistory,
                      });
                      setConversations((current) => upsert(current, conversation));
                    }}
                  >
                    <option value="">Unassigned</option>
                    {agents.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={canSeeHistory}
                      onChange={async (event) => {
                        const next = event.target.checked;
                        setCanSeeHistory(next);
                        if (!selected.assigned_agent_id) return;
                        const { conversation } = await api.assign(selected.id, selected.assigned_agent_id, {
                          canSeeHistory: next,
                        });
                        setConversations((current) => upsert(current, conversation));
                      }}
                    />
                    Can see previous messages
                  </label>
                  <div className="actions">
                    <button
                      className="ghost"
                      onClick={() =>
                        api.setStatus(selected.id, selected.status === "closed" ? "open" : "closed").then(({ conversation }) => {
                          setConversations((current) => upsert(current, conversation));
                        })
                      }
                    >
                      {selected.status === "closed" ? "Reopen" : "Stop"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="card">
                  <strong>Assignment</strong>
                  <div className="meta">{selected.assigned_agent_name ?? "You"}</div>
                  {historyHidden ? (
                    <div className="meta">Earlier messages are hidden for this assignment.</div>
                  ) : null}
                </div>
              )}
              <div className="card">
                <strong>Internal note</strong>
                <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Team only" />
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
            <div className="card">Open a conversation for assignment and notes.</div>
          )}
        </div>
      </aside>
    </>
  );
}

function NewChatForm({
  onStarted,
  onError,
}: {
  onStarted: (conversation: Conversation) => void;
  onError: (value: string) => void;
}) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [starting, setStarting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (starting) return;
    setStarting(true);
    onError("");
    try {
      const { conversation } = await api.startConversation({
        phone,
        text,
        name: name.trim() || undefined,
      });
      onStarted(conversation);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not start the chat");
    } finally {
      setStarting(false);
    }
  }

  return (
    <form className="new-chat" onSubmit={submit}>
      <input
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="Number with country code, e.g. 919800011122"
        inputMode="tel"
        autoFocus
      />
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" />
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="First message" rows={3} />
      <button className="primary" type="submit" disabled={starting || !phone.trim() || !text.trim()}>
        {starting ? "Sending..." : "Send"}
      </button>
    </form>
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

function roleText(role: SessionAgent["role"]): string {
  if (role === "super_admin") return "Super admin";
  if (role === "manager") return "Manager";
  return "Agent";
}

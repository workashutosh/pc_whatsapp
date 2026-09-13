-- Inbox layer: tenants, agents, conversations, notes.
-- Core channel: whatsapp_connections (and message wa ids live on inbox messages).

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY DEFAULT (uuid()),
  name TEXT NOT NULL,
  assignment_mode TEXT NOT NULL DEFAULT 'manual',
  agents_can_see_phone INTEGER NOT NULL DEFAULT 0,
  allow_all_ips INTEGER NOT NULL DEFAULT 1,
  agents_can_see_history INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (now_iso())
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY DEFAULT (uuid()),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'agent',
  password_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  disabled_at TEXT,
  created_at TEXT DEFAULT (now_iso())
);

CREATE TABLE IF NOT EXISTS tenant_allowed_ips (
  id TEXT PRIMARY KEY DEFAULT (uuid()),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  ip TEXT NOT NULL,
  created_at TEXT DEFAULT (now_iso()),
  UNIQUE (tenant_id, ip)
);

CREATE TABLE IF NOT EXISTS whatsapp_connections (
  id TEXT PRIMARY KEY DEFAULT (uuid()),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  provider TEXT NOT NULL,
  instance_name TEXT,
  phone_number TEXT,
  waba_id TEXT,
  phone_number_id TEXT,
  access_token TEXT,
  status TEXT DEFAULT 'pending',
  connected_at TEXT,
  created_at TEXT DEFAULT (now_iso())
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY DEFAULT (uuid()),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  connection_id TEXT REFERENCES whatsapp_connections(id),
  customer_phone TEXT NOT NULL,
  customer_jid TEXT,
  customer_name TEXT,
  assigned_agent_id TEXT REFERENCES agents(id),
  assigned_at TEXT,
  assignee_can_see_history INTEGER,
  locked_by_agent_id TEXT REFERENCES agents(id),
  locked_at TEXT,
  status TEXT DEFAULT 'open',
  last_message_at TEXT,
  created_at TEXT DEFAULT (now_iso())
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY DEFAULT (uuid()),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  conversation_id TEXT REFERENCES conversations(id),
  connection_id TEXT REFERENCES whatsapp_connections(id),
  direction TEXT NOT NULL,
  wa_message_id TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT DEFAULT 'sent',
  sent_by_agent_id TEXT REFERENCES agents(id),
  created_at TEXT DEFAULT (now_iso())
);

CREATE TABLE IF NOT EXISTS internal_notes (
  id TEXT PRIMARY KEY DEFAULT (uuid()),
  conversation_id TEXT REFERENCES conversations(id),
  agent_id TEXT REFERENCES agents(id),
  note TEXT NOT NULL,
  created_at TEXT DEFAULT (now_iso())
);

CREATE UNIQUE INDEX IF NOT EXISTS one_live_connection_per_tenant
  ON whatsapp_connections (tenant_id)
  WHERE status IN ('pending', 'connected');

CREATE UNIQUE INDEX IF NOT EXISTS conversations_connection_phone_idx
  ON conversations (connection_id, customer_phone);

CREATE UNIQUE INDEX IF NOT EXISTS messages_tenant_wa_id_idx
  ON messages (tenant_id, wa_message_id)
  WHERE wa_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS conversations_tenant_last_msg_idx
  ON conversations (tenant_id, last_message_at);

CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
  ON messages (conversation_id, created_at);

CREATE INDEX IF NOT EXISTS agents_tenant_idx ON agents (tenant_id);
CREATE INDEX IF NOT EXISTS connections_tenant_idx ON whatsapp_connections (tenant_id);

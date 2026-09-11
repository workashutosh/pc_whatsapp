# WhatsApp Multi-Tenant Messaging Platform

Self-hosted shared inbox: **one WhatsApp number per tenant**, many agents on that inbox, and a swappable provider (`demo` locally, `Evolution` when you have it, Meta Cloud API later).

No Docker is required to run the CRM.

## Start locally

```bash
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

The CRM inbox is at http://localhost:5173 (demo agents: `alice@acme.test` / `bob@acme.test`).

To **scan a real WhatsApp QR**, Evolution API must be running:

```bash
docker compose up -d postgres redis evolution-api

cd backend && npm run dev
cd frontend && npm run dev
```

Then: lightning tab → **Connect number** → WhatsApp / WhatsApp Business → Settings → Linked devices → scan the QR.

`DEMO_MODE=true` in `backend/.env` turns the fake QR back on.

## Architecture

Agents use the CRM. The backend owns `tenants`, `agents`, `whatsapp_connections`, `conversations`, `messages`, and `internal_notes`. Every inbox query is tenant-scoped.

Switching a number marks the old connection `disconnected` and inserts a new row. History is never deleted.

# WhatsApp Multi-Tenant Messaging Platform

Self-hosted shared inbox: **one WhatsApp number per tenant**, many agents on that inbox, and a swappable provider (`demo` locally, `Evolution` when you have it, Meta Cloud API later).

No Docker is required. Everything runs natively with Node 22.

## Start locally

```bash
./start.sh
```

This starts Evolution API (if installed), the backend and the frontend, with logs in `.logs/`. The CRM inbox is at http://localhost:5173 (demo agents: `alice@acme.test` / `bob@acme.test` / `riya@acme.test`).

Or run the inbox alone, in demo mode:

```bash
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

## Real WhatsApp (Evolution API, no Docker)

To **scan a real WhatsApp QR**, Evolution API must be running. It needs PostgreSQL (Redis is not needed):

```bash
brew install postgresql@14 && brew services start postgresql@14
./infra/evolution/setup.sh   # one time: downloads Evolution 2.2.3 into .evolution/, builds it, creates its database
./start.sh                   # starts Evolution on http://localhost:18080 along with the inbox
```

`setup.sh` reads `EVOLUTION_API_KEY` from `backend/.env`, so the backend and Evolution always share the same key. Re-run it any time to repair the install.

Then: Settings → **Connect number** → on your phone, WhatsApp / WhatsApp Business → Settings → Linked devices → scan the QR.

`DEMO_MODE=true` in `backend/.env` turns the fake QR back on.

## Architecture

Agents use the CRM. The backend owns `tenants`, `agents`, `whatsapp_connections`, `conversations`, `messages`, and `internal_notes`. Every inbox query is tenant-scoped.

Switching a number marks the old connection `disconnected` and inserts a new row. History is never deleted.

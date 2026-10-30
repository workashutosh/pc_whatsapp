import { query } from "../db.js";
import { emitToTenant } from "../realtime/bus.js";
import { instanceNameForTenant } from "./phone.js";
import { getProvider, resolveProviderKind } from "./providers/registry.js";
import type { ConnectNumberResult, ProviderKind, WhatsAppConnection } from "./types.js";

export async function listConnections(tenantId: string): Promise<WhatsAppConnection[]> {
  const { rows } = await query<WhatsAppConnection>(
    `SELECT * FROM whatsapp_connections
     WHERE tenant_id = $1
     ORDER BY created_at DESC`,
    [tenantId],
  );
  return rows;
}

export async function getConnection(tenantId: string, connectionId: string): Promise<WhatsAppConnection | null> {
  const { rows } = await query<WhatsAppConnection>(
    "SELECT * FROM whatsapp_connections WHERE id = $1 AND tenant_id = $2",
    [connectionId, tenantId],
  );
  return rows[0] ?? null;
}

export async function getLiveConnection(tenantId: string): Promise<WhatsAppConnection | null> {
  const { rows } = await query<WhatsAppConnection>(
    `SELECT * FROM whatsapp_connections
     WHERE tenant_id = $1 AND status IN ('pending', 'connected')
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId],
  );
  return rows[0] ?? null;
}

export async function getConnectionByInstanceName(
  instanceName: string,
): Promise<WhatsAppConnection | null> {
  const { rows } = await query<WhatsAppConnection>(
    "SELECT * FROM whatsapp_connections WHERE instance_name = $1",
    [instanceName],
  );
  return rows[0] ?? null;
}

export async function connectNumber(
  tenantId: string,
  requestedProvider: ProviderKind = "evolution",
): Promise<ConnectNumberResult> {
  const existing = await getLiveConnection(tenantId);
  if (existing) {
    throw Object.assign(new Error("Tenant already has a live WhatsApp connection. Use switch number instead."), {
      status: 409,
    });
  }

  const instanceName = instanceNameForTenant(tenantId);
  const { providerKind, result } = await connectWithFallback(requestedProvider, tenantId, instanceName);
  const status = result.connection.status || "pending";
  const phoneNumber = result.connection.phone_number ?? null;
  const connectedAt = status === "connected" ? new Date().toISOString() : null;

  const { rows } = await query<WhatsAppConnection>(
    `INSERT INTO whatsapp_connections (
       tenant_id, provider, instance_name, status, phone_number, connected_at
     ) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [tenantId, providerKind, instanceName, status, phoneNumber, connectedAt],
  );

  const connection = rows[0];
  emitToTenant(tenantId, "connection:updated", { connection, qr: result.qr ?? null });
  return { connection, qr: result.qr ?? null };
}

export async function switchNumber(
  tenantId: string,
  requestedProvider: ProviderKind = "evolution",
): Promise<ConnectNumberResult> {
  const live = await getLiveConnection(tenantId);
  const instanceName = instanceNameForTenant(tenantId);

  if (live) {
    await getProvider(live).disconnectNumber(live).catch((error) => {
      console.warn("Failed to disconnect old provider instance", error);
    });
    await query(
      `UPDATE whatsapp_connections
       SET status = 'disconnected'
       WHERE id = $1 AND tenant_id = $2`,
      [live.id, tenantId],
    );
  }

  const { providerKind, result } = await connectWithFallback(requestedProvider, tenantId, instanceName);
  const status = result.connection.status || "pending";
  const phoneNumber = result.connection.phone_number ?? null;
  const connectedAt = status === "connected" ? new Date().toISOString() : null;
  const inserted = await query<WhatsAppConnection>(
    `INSERT INTO whatsapp_connections (
       tenant_id, provider, instance_name, status, phone_number, connected_at
     ) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [tenantId, providerKind, instanceName, status, phoneNumber, connectedAt],
  );
  const connection = inserted.rows[0];
  emitToTenant(tenantId, "connection:updated", { connection, qr: result.qr ?? null });
  return { connection, qr: result.qr ?? null };
}

export async function disconnectNumber(tenantId: string, connectionId: string): Promise<WhatsAppConnection> {
  const connection = await getConnection(tenantId, connectionId);
  if (!connection) {
    throw Object.assign(new Error("Connection not found"), { status: 404 });
  }
  await getProvider(connection).disconnectNumber(connection).catch((error) => {
    console.warn("Provider disconnect failed", error);
  });
  const { rows } = await query<WhatsAppConnection>(
    `UPDATE whatsapp_connections
     SET status = 'disconnected'
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [connectionId, tenantId],
  );
  emitToTenant(tenantId, "connection:updated", { connection: rows[0], qr: null });
  return rows[0];
}

export async function markConnectionState(input: {
  instanceName: string;
  state: string;
  phoneNumber: string | null;
}): Promise<WhatsAppConnection | null> {
  const connection = await getConnectionByInstanceName(input.instanceName);
  if (!connection) return null;

  const open = ["open", "connected"].includes(input.state.toLowerCase());
  const closed = ["close", "closed", "refused"].includes(input.state.toLowerCase());
  const banned = input.state.toLowerCase() === "banned";

  let status = connection.status;
  if (open) status = "connected";
  else if (banned) status = "banned";
  else if (closed && connection.status === "connected") status = "disconnected";

  const { rows } = await query<WhatsAppConnection>(
    `UPDATE whatsapp_connections
     SET status = $3,
         phone_number = COALESCE($4, phone_number),
         connected_at = CASE WHEN $3 = 'connected' THEN COALESCE(connected_at, now()) ELSE connected_at END
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [connection.id, connection.tenant_id, status, input.phoneNumber],
  );
  emitToTenant(connection.tenant_id, "connection:updated", { connection: rows[0], qr: null });
  return rows[0];
}

export async function refreshConnectionQr(tenantId: string, connectionId: string) {
  const connection = await getConnection(tenantId, connectionId);
  if (!connection) {
    throw Object.assign(new Error("Connection not found"), { status: 404 });
  }
  const qr = await getProvider(connection).getQr(connection);
  emitToTenant(tenantId, "qr:updated", { connectionId, qr });
  return { connection, qr };
}

export async function refreshRemoteStatus(tenantId: string, connectionId: string) {
  const connection = await getConnection(tenantId, connectionId);
  if (!connection) {
    throw Object.assign(new Error("Connection not found"), { status: 404 });
  }
  const remote = await getProvider(connection).getRemoteStatus(connection);
  const updated = await markConnectionState({
    instanceName: connection.instance_name ?? "",
    state: remote.state,
    phoneNumber: remote.phoneNumber,
  });
  return { connection: updated ?? connection, remote };
}

/** Push the current webhook URL/secret to every live instance, so config changes apply without re-scanning a QR. */
export async function resyncProviderWebhooks(): Promise<void> {
  const { rows } = await query<WhatsAppConnection>(
    "SELECT * FROM whatsapp_connections WHERE status IN ('pending', 'connected')",
  );
  for (const connection of rows) {
    const provider = getProvider(connection);
    if (!provider.syncWebhook) continue;
    await provider.syncWebhook(connection).catch((error) => {
      console.warn(`Webhook resync failed for ${connection.instance_name}`, error instanceof Error ? error.message : error);
    });
  }
}

async function connectWithFallback(
  requestedProvider: ProviderKind,
  tenantId: string,
  instanceName: string,
): Promise<{ providerKind: ProviderKind; result: ConnectNumberResult }> {
  const providerKind = resolveProviderKind(requestedProvider);
  try {
    return {
      providerKind,
      result: await getProvider(providerKind).connectNumber(tenantId, instanceName),
    };
  } catch (error) {
    const status = Number((error as { status?: number }).status ?? 0);
    if (providerKind === "evolution" && status === 503) {
      console.warn("Evolution API is not running; using demo QR instead");
      return {
        providerKind: "demo",
        result: await getProvider("demo").connectNumber(tenantId, instanceName),
      };
    }
    throw error;
  }
}

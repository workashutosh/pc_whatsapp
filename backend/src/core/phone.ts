export function digitsOnly(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

export function phoneFromJid(jid: string | null | undefined): string | null {
  if (!jid) return null;
  if (jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid.includes("@newsletter")) {
    return null;
  }
  const user = jid.split("@")[0] ?? "";
  const digits = digitsOnly(user);
  return digits || null;
}

export function isPhoneJid(jid: string | null | undefined): boolean {
  const value = jid ?? "";
  return value.includes("@s.whatsapp.net") || value.includes("@c.us");
}

export function isLidJid(jid: string | null | undefined): boolean {
  return (jid ?? "").includes("@lid");
}

/** Prefer a real phone JID when WhatsApp also sent a LID. */
export function preferSendableJid(...candidates: Array<string | null | undefined>): string | null {
  const cleaned = candidates
    .map((value) => String(value ?? "").trim())
    .filter((value) => value.includes("@") && !value.endsWith("@g.us") && !value.includes("@newsletter"));
  return cleaned.find((value) => isPhoneJid(value)) ?? cleaned[0] ?? null;
}

/**
 * Evolution's sendText `number` field. Digits are treated as @s.whatsapp.net,
 * which fails for LID chats — those must keep the @lid suffix.
 */
export function evolutionRecipient(jidOrPhone: string): string {
  const value = jidOrPhone.trim();
  if (!value) return value;
  if (value.includes("@")) return value.replace(/:\d+(?=@)/, "");
  return value.replace(/\D/g, "");
}

export function jidFromWebhookKey(key: Record<string, unknown> | null | undefined): string | null {
  if (!key) return null;
  return preferSendableJid(
    String(key.remoteJidAlt ?? ""),
    String(key.senderPn ?? ""),
    String(key.participantPn ?? ""),
    String(key.remoteJid ?? ""),
    String(key.participant ?? ""),
    String(key.senderLid ?? ""),
  );
}

export function jidFromStoredPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const raw = root.raw && typeof root.raw === "object" ? (root.raw as Record<string, unknown>) : root;
  const data = raw.data && typeof raw.data === "object" ? (raw.data as Record<string, unknown>) : raw;
  const key = data.key && typeof data.key === "object" ? (data.key as Record<string, unknown>) : null;
  return jidFromWebhookKey(key);
}

export function isPreferredJid(next: string, current: string | null | undefined): boolean {
  if (!current) return true;
  if (isPhoneJid(next) && isLidJid(current)) return true;
  return false;
}

export function instanceNameForTenant(tenantId: string): string {
  return `tenant-${tenantId.replace(/-/g, "").slice(0, 16)}-${Date.now().toString(36)}`;
}

export function mapWaStatus(status: unknown): "sent" | "delivered" | "read" | "failed" | "pending" {
  const value = String(status ?? "").toLowerCase();
  if (value.includes("read") || value === "read") return "read";
  if (value.includes("deliver") || value === "delivery_ack" || value === "server_ack") return "delivered";
  if (value.includes("fail") || value.includes("error")) return "failed";
  if (value.includes("pend")) return "pending";
  return "sent";
}

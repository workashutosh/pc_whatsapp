import { isIP } from "node:net";
import type { IncomingHttpHeaders } from "node:http";
import { query } from "../db.js";

export type AllowedIp = {
  id: string;
  ip: string;
  created_at: string;
};

export function normalizeIp(value: string): string {
  let ip = value.trim().replace(/^\[|\]$/g, "");
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  if (ip === "::1") return "127.0.0.1";
  return ip;
}

export function isValidIp(value: string): boolean {
  return isIP(normalizeIp(value)) !== 0;
}

export function clientIp(req: { headers: IncomingHttpHeaders; socket: { remoteAddress?: string } }): string {
  const socketIp = normalizeIp(req.socket.remoteAddress ?? "");
  const forwarded = firstForwardedIp(req.headers["x-forwarded-for"]);
  if (forwarded && isLoopback(socketIp)) return forwarded;
  return socketIp || forwarded;
}

export async function listAllowedIps(tenantId: string): Promise<AllowedIp[]> {
  const { rows } = await query<AllowedIp>(
    `SELECT id, ip, created_at FROM tenant_allowed_ips WHERE tenant_id = $1 ORDER BY created_at`,
    [tenantId],
  );
  return rows;
}

export async function tenantAllowsAllIps(tenantId: string): Promise<boolean> {
  const { rows } = await query<{ allow_all_ips: number | boolean }>(
    "SELECT allow_all_ips FROM tenants WHERE id = $1",
    [tenantId],
  );
  return rows[0] == null ? true : Boolean(rows[0].allow_all_ips);
}

export async function isIpAllowed(tenantId: string, ip: string): Promise<boolean> {
  if (await tenantAllowsAllIps(tenantId)) return true;
  const allowed = await listAllowedIps(tenantId);
  if (allowed.length === 0) return true;
  const current = normalizeIp(ip);
  return allowed.some((row) => normalizeIp(row.ip) === current);
}

export async function assertIpAllowed(tenantId: string, ip: string, action = "sign in"): Promise<void> {
  if (await isIpAllowed(tenantId, ip)) return;
  throw Object.assign(new Error(`This IP is not allowed to ${action}`), { status: 403 });
}

export async function setAllowAllIps(tenantId: string, allowAll: boolean, currentIp: string): Promise<void> {
  if (!allowAll) {
    const existing = await listAllowedIps(tenantId);
    if (!existing.some((row) => normalizeIp(row.ip) === normalizeIp(currentIp))) {
      await addAllowedIp(tenantId, currentIp);
    }
  }
  const { rows } = await query(
    "UPDATE tenants SET allow_all_ips = $2 WHERE id = $1 RETURNING id",
    [tenantId, allowAll ? 1 : 0],
  );
  if (!rows[0]) {
    throw Object.assign(new Error("Tenant not found"), { status: 404 });
  }
}

export async function addAllowedIp(tenantId: string, rawIp: string): Promise<AllowedIp> {
  const ip = normalizeIp(rawIp);
  if (!isValidIp(ip)) {
    throw Object.assign(new Error("Enter a valid IPv4 or IPv6 address"), { status: 400 });
  }
  try {
    const { rows } = await query<AllowedIp>(
      `INSERT INTO tenant_allowed_ips (tenant_id, ip) VALUES ($1, $2) RETURNING id, ip, created_at`,
      [tenantId, ip],
    );
    return rows[0];
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE")) {
      throw Object.assign(new Error("That IP is already allowed"), { status: 409 });
    }
    throw error;
  }
}

export async function removeAllowedIp(tenantId: string, id: string, currentIp: string): Promise<void> {
  const { rows } = await query<AllowedIp>(
    "SELECT id, ip, created_at FROM tenant_allowed_ips WHERE id = $1 AND tenant_id = $2",
    [id, tenantId],
  );
  const target = rows[0];
  if (!target) {
    throw Object.assign(new Error("Allowed IP not found"), { status: 404 });
  }
  if (!(await tenantAllowsAllIps(tenantId)) && normalizeIp(target.ip) === normalizeIp(currentIp)) {
    throw Object.assign(new Error("You cannot remove the IP you are using while access is restricted"), {
      status: 409,
    });
  }
  await query("DELETE FROM tenant_allowed_ips WHERE id = $1 AND tenant_id = $2", [id, tenantId]);
}

function firstForwardedIp(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return "";
  return normalizeIp(raw.split(",")[0] ?? "");
}

function isLoopback(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "";
}

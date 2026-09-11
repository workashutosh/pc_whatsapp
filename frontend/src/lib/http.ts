import type { SessionAgent } from "../types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

let session: SessionAgent | null = null;

export function apiUrl(): string {
  return API_URL;
}

export function setSession(next: SessionAgent | null): void {
  session = next;
  if (next) localStorage.setItem("inbox.session", JSON.stringify(next));
  else localStorage.removeItem("inbox.session");
}

export function loadSession(): SessionAgent | null {
  if (session) return session;
  const raw = localStorage.getItem("inbox.session");
  if (!raw) return null;
  session = JSON.parse(raw) as SessionAgent;
  return session;
}

function headers(): HeadersInit {
  const current = loadSession();
  return {
    "Content-Type": "application/json",
    ...(current
      ? { "X-Tenant-Id": current.tenantId, "X-Agent-Id": current.id }
      : {}),
  };
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...headers(), ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return body as T;
}

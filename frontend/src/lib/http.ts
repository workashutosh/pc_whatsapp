import type { SessionAgent } from "../types";

const configuredApiUrl = import.meta.env.VITE_API_URL;
const API_URL = configuredApiUrl ?? (import.meta.env.DEV ? "" : "http://127.0.0.1:3001");

let session: SessionAgent | null = null;

export function apiUrl(): string {
  if (API_URL) return API_URL;
  if (typeof window !== "undefined") return window.location.origin;
  return "http://127.0.0.1:3001";
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
  let parsed: SessionAgent;
  try {
    parsed = JSON.parse(raw) as SessionAgent;
  } catch {
    localStorage.removeItem("inbox.session");
    return null;
  }
  // Sessions saved before token auth existed cannot be used; force a fresh sign-in.
  if (!parsed.role || !parsed.token) {
    localStorage.removeItem("inbox.session");
    return null;
  }
  session = parsed;
  return session;
}

export function authHeaders(): Record<string, string> {
  const current = loadSession();
  return {
    "Content-Type": "application/json",
    ...(current ? { Authorization: `Bearer ${current.token}` } : {}),
  };
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl()}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (response.status === 401 && loadSession()) {
    // Token expired or was revoked (password reset, role change, disabled): drop back to the login screen.
    setSession(null);
    window.location.reload();
  }
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : {};
  if (!response.ok) {
    throw new Error((body as { error?: string }).error ?? `Request failed (${response.status})`);
  }
  if (!contentType.includes("application/json")) {
    throw new Error(`Request failed (${response.status})`);
  }
  return body as T;
}

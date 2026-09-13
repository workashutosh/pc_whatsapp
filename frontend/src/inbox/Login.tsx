import { FormEvent, useRef, useState } from "react";
import { api, setSession } from "../api";
import type { SessionAgent } from "../types";

const DEMO_ACCOUNTS = [
  { label: "Alice · admin", email: "alice@acme.test", password: "AcmeAdmin!1" },
  { label: "Bob · manager", email: "bob@acme.test", password: "AcmeManager!1" },
  { label: "Riya · agent", email: "riya@acme.test", password: "AcmeAgent!1" },
] as const;

export function Login({ onLogin }: { onLogin: (agent: SessionAgent) => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState("");

  function fillDemo(email: string, password: string) {
    const form = formRef.current;
    if (!form) return;
    const emailInput = form.elements.namedItem("email") as HTMLInputElement | null;
    const passwordInput = form.elements.namedItem("password") as HTMLInputElement | null;
    if (emailInput) emailInput.value = email;
    if (passwordInput) passwordInput.value = password;
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "").trim();
    setError("");
    try {
      const { agent } = await api.login(email, password);
      setSession(agent);
      onLogin(agent);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  return (
    <div className="login">
      <form ref={formRef} className="login-card" onSubmit={submit} autoComplete="off">
        <div className="brand">IN</div>
        <h1>Inbox</h1>
        <p>Sign in with your work account.</p>
        <label>
          Email
          <input
            name="email"
            type="email"
            defaultValue="alice@acme.test"
            autoComplete="off"
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            defaultValue="AcmeAdmin!1"
            autoComplete="off"
          />
        </label>
        <button className="primary" type="submit">Sign in</button>
        {error ? <div className="error">{error}</div> : null}
        <div className="hint demo-accounts">
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              className="ghost"
              onClick={() => fillDemo(account.email, account.password)}
            >
              {account.label}
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}

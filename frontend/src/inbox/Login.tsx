import { FormEvent, useState } from "react";
import { api, setSession } from "../api";
import type { SessionAgent } from "../types";

export function Login({ onLogin }: { onLogin: (agent: SessionAgent) => void }) {
  const [email, setEmail] = useState("alice@acme.test");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const { agent } = await api.login(email);
      setSession(agent);
      onLogin(agent);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  return (
    <div className="login">
      <div className="login-card">
        <div className="brand">WA</div>
        <h1>Shared inbox</h1>
        <p>Sign in as an agent to work the tenant WhatsApp number.</p>
        <form onSubmit={submit}>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="agent email" />
          <button className="primary" type="submit">Continue</button>
          {error ? <div className="error">{error}</div> : null}
          <div className="hint">Demo agents: alice@acme.test · bob@acme.test</div>
        </form>
      </div>
    </div>
  );
}

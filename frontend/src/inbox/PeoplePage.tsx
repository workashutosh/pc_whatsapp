import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";
import type { Agent, AgentRole, AgentStatus, SessionAgent } from "../types";
import { roleLabel } from "../types";

export function PeoplePage({ agent, onError }: { agent: SessionAgent; onError: (value: string) => void }) {
  const [people, setPeople] = useState<Agent[]>([]);
  const [q, setQ] = useState("");
  const [role, setRole] = useState<AgentRole | "all">("all");
  const [status, setStatus] = useState<AgentStatus | "all">("all");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [createRole, setCreateRole] = useState<AgentRole>("agent");

  async function refresh() {
    const { agents } = await api.agents({ q, role, status });
    setPeople(agents);
  }

  useEffect(() => {
    refresh().catch((err) => onError(err.message));
  }, [q, role, status]);

  async function create(event: FormEvent) {
    event.preventDefault();
    onError("");
    try {
      await api.createAgent({ name, email, password, role: createRole });
      setName("");
      setEmail("");
      setPassword("");
      await refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not create account");
    }
  }

  async function toggle(person: Agent) {
    onError("");
    try {
      await api.updateAgent(person.id, { status: person.status === "active" ? "disabled" : "active" });
      await refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not update account");
    }
  }

  const roleOptions: AgentRole[] = agent.role === "super_admin" ? ["agent", "manager", "super_admin"] : ["agent"];

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h2>People</h2>
          <div className="meta">Accounts that can work this inbox</div>
        </div>
        <div className="toolbar">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" />
          <select value={role} onChange={(e) => setRole(e.target.value as AgentRole | "all")}>
            <option value="all">All roles</option>
            <option value="super_admin">Super admin</option>
            <option value="manager">Manager</option>
            <option value="agent">Agent</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as AgentStatus | "all")}>
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>
      </div>

      <form className="create-row" onSubmit={create}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
        <select value={createRole} onChange={(e) => setCreateRole(e.target.value as AgentRole)}>
          {roleOptions.map((item) => (
            <option key={item} value={item}>{roleLabel(item)}</option>
          ))}
        </select>
        <button className="primary" type="submit">Add</button>
      </form>

      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {people.map((person) => (
            <tr key={person.id}>
              <td>{person.name}</td>
              <td>{person.email}</td>
              <td>{roleLabel(person.role)}</td>
              <td>{person.status}</td>
              <td>
                {person.id === agent.id ? (
                  <span className="meta">You</span>
                ) : (
                  <button className="ghost" onClick={() => toggle(person)}>
                    {person.status === "active" ? "Disable" : "Enable"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

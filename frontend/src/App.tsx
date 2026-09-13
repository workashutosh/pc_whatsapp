import { useState } from "react";
import { Login } from "./inbox/Login";
import { Shell } from "./inbox/Shell";
import { loadSession, setSession } from "./api";
import type { SessionAgent } from "./types";

export function App() {
  const [agent, setAgent] = useState<SessionAgent | null>(loadSession());
  if (!agent) return <Login onLogin={setAgent} />;
  return (
    <Shell
      agent={agent}
      onAgent={setAgent}
      onLogout={() => {
        setSession(null);
        setAgent(null);
      }}
    />
  );
}

import "dotenv/config";
import { join } from "node:path";

const production = process.env.NODE_ENV === "production";

/** Dev defaults are fine locally; in production every secret must be set explicitly. */
function secret(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value) return value;
  if (production) {
    throw new Error(`Missing required env var ${name}`);
  }
  return devFallback;
}

export const config = {
  production,
  port: Number(process.env.PORT ?? 3001),
  sqlitePath: process.env.SQLITE_PATH ?? join(process.cwd(), "data", "platform.sqlite"),
  demoMode: process.env.DEMO_MODE === "true",
  seedDemoAccounts: (process.env.SEED_DEMO_ACCOUNTS ?? (production ? "false" : "true")) === "true",
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 24 * 7),
  evolutionApiUrl: (process.env.EVOLUTION_API_URL ?? "http://localhost:18080").replace(
    /\/$/,
    "",
  ),
  evolutionApiKey: secret("EVOLUTION_API_KEY", "your-secret-key-here"),
  webhookUrl: process.env.WEBHOOK_URL ?? "http://localhost:3001/webhook/whatsapp",
  webhookSecret: secret("WEBHOOK_SECRET", "dev-webhook-secret"),
  assignmentMode: (process.env.ASSIGNMENT_MODE ?? "manual") as
    | "manual"
    | "round_robin",
  lockTtlSeconds: Number(process.env.LOCK_TTL_SECONDS ?? 120),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
};

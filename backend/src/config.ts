import "dotenv/config";
import { join } from "node:path";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  sqlitePath: process.env.SQLITE_PATH ?? join(process.cwd(), "data", "platform.sqlite"),
  demoMode: process.env.DEMO_MODE === "true",
  evolutionApiUrl: (process.env.EVOLUTION_API_URL ?? "http://localhost:8080").replace(
    /\/$/,
    "",
  ),
  evolutionApiKey: required("EVOLUTION_API_KEY", "your-secret-key-here"),
  webhookUrl: required(
    "WEBHOOK_URL",
    "http://localhost:3001/webhook/whatsapp",
  ),
  webhookSecret: process.env.WEBHOOK_SECRET ?? "dev-webhook-secret",
  assignmentMode: (process.env.ASSIGNMENT_MODE ?? "manual") as
    | "manual"
    | "round_robin",
  lockTtlSeconds: Number(process.env.LOCK_TTL_SECONDS ?? 120),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
};

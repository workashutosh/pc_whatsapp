import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { config } from "./config.js";
import { resyncProviderWebhooks } from "./core/index.js";
import { migrateAndSeed } from "./db.js";
import { authRouter } from "./http/authRoutes.js";
import { connectionRouter } from "./http/connectionRoutes.js";
import { conversationRouter } from "./http/conversationRoutes.js";
import { httpError } from "./http/middleware.js";
import { webhookRouter } from "./http/webhookRoutes.js";
import { canSeePhone } from "./inbox/policy.js";
import {
  clientIp,
  filterRealtimePayload,
  getSessionAgent,
  getTenant,
  isIpAllowed,
  purgeExpiredSessions,
} from "./inbox/index.js";
import { setIo, setPayloadFilter, tenantRoom } from "./realtime/bus.js";

/** HTTP glue: /webhook and /api/connections are the core channel; /api/auth and /api/conversations are inbox. */

async function main(): Promise<void> {
  await migrateAndSeed();
  await purgeExpiredSessions();
  setInterval(() => void purgeExpiredSessions().catch(console.error), 3600_000).unref();

  const app = express();
  const server = createServer(app);
  const corsOrigins = [
    config.corsOrigin,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ].filter((origin, index, all) => all.indexOf(origin) === index);
  const io = new Server(server, {
    cors: { origin: corsOrigins, credentials: true },
    maxHttpBufferSize: 15 * 1024 * 1024,
  });
  setIo(io);
  setPayloadFilter(filterRealtimePayload);

  io.on("connection", async (socket) => {
    try {
      const agent = await getSessionAgent(String(socket.handshake.auth.token ?? ""));
      if (!agent || agent.status !== "active") {
        socket.disconnect(true);
        return;
      }
      const tenantId = agent.tenant_id;
      const requestLike = {
        headers: socket.handshake.headers,
        socket: { remoteAddress: socket.handshake.address },
      };
      if (!(await isIpAllowed(tenantId, clientIp(requestLike)))) {
        socket.disconnect(true);
        return;
      }
      const tenant = await getTenant(tenantId);
      socket.data.auth = {
        tenantId,
        agentId: agent.id,
        role: agent.role,
        seePhone: canSeePhone(agent.role, Boolean(tenant?.agents_can_see_phone)),
      };
      socket.join(tenantRoom(tenantId));
    } catch (error) {
      console.error("Socket auth failed", error);
      socket.disconnect(true);
    }
  });

  app.use(cors({ origin: corsOrigins, credentials: true }));
  app.use(express.json({ limit: "12mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, demoMode: config.demoMode });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/connections", connectionRouter);
  app.use("/api/conversations", conversationRouter);
  app.use("/webhook", webhookRouter);
  app.use(httpError);

  server.listen(config.port, () => {
    console.log(`Backend listening on http://localhost:${config.port}`);
    console.log(config.demoMode ? "Demo provider enabled (no Evolution required)" : `Webhook URL: ${config.webhookUrl}`);
  });

  if (!config.demoMode) {
    // Instances linked before the webhook secret existed need the new auth header pushed to Evolution.
    void resyncProviderWebhooks().catch((error) => console.warn("Webhook resync failed", error));
  }
}

main().catch((error) => {
  console.error("Failed to start backend", error);
  process.exit(1);
});

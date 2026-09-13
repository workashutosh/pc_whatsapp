import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { config } from "./config.js";
import { migrateAndSeed } from "./db.js";
import { authRouter } from "./http/authRoutes.js";
import { connectionRouter } from "./http/connectionRoutes.js";
import { conversationRouter } from "./http/conversationRoutes.js";
import { httpError } from "./http/middleware.js";
import { webhookRouter } from "./http/webhookRoutes.js";
import { canSeePhone } from "./inbox/policy.js";
import { clientIp, getAgentInTenant, getTenant, isIpAllowed } from "./inbox/index.js";
import { setIo, tenantRoom } from "./realtime/bus.js";

/** HTTP glue: /webhook and /api/connections are the core channel; /api/auth and /api/conversations are inbox. */

async function main(): Promise<void> {
  await migrateAndSeed();

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

  io.on("connection", async (socket) => {
    const tenantId = String(socket.handshake.auth.tenantId ?? "");
    const agentId = String(socket.handshake.auth.agentId ?? "");
    if (!tenantId || !agentId) {
      socket.disconnect(true);
      return;
    }
    const agent = await getAgentInTenant(agentId, tenantId);
    if (!agent || agent.status !== "active") {
      socket.disconnect(true);
      return;
    }
    const tenant = await getTenant(tenantId);
    const requestLike = {
      headers: socket.handshake.headers,
      socket: { remoteAddress: socket.handshake.address },
    };
    if (!(await isIpAllowed(tenantId, clientIp(requestLike)))) {
      socket.disconnect(true);
      return;
    }
    socket.data.auth = {
      tenantId,
      agentId,
      role: agent.role,
      seePhone: canSeePhone(agent.role, Boolean(tenant?.agents_can_see_phone)),
    };
    socket.join(tenantRoom(tenantId));
  });

  app.use(cors({ origin: corsOrigins, credentials: true }));
  app.use(express.json({ limit: "12mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      demoMode: config.demoMode,
      sqlitePath: config.sqlitePath,
      evolutionApiUrl: config.evolutionApiUrl,
      webhookUrl: config.webhookUrl,
    });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/connections", connectionRouter);
  app.use("/api/conversations", conversationRouter);
  app.use("/webhook", webhookRouter);
  app.use(httpError);

  server.listen(config.port, () => {
    console.log(`Backend listening on http://localhost:${config.port}`);
    console.log(config.demoMode ? "Demo provider enabled (no Evolution/Docker required)" : `Webhook URL: ${config.webhookUrl}`);
  });
}

main().catch((error) => {
  console.error("Failed to start backend", error);
  process.exit(1);
});

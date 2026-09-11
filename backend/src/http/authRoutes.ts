import { Router } from "express";
import { getAgentByEmail, listAgents } from "../inbox/index.js";
import { asyncHandler, requireAgent, type AuthedRequest } from "./middleware.js";

export const authRouter = Router();

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const email = String(req.body?.email ?? "").trim();
    if (!email) {
      res.status(400).json({ error: "email is required" });
      return;
    }
    const agent = await getAgentByEmail(email);
    if (!agent) {
      res.status(401).json({ error: "Unknown agent email" });
      return;
    }
    res.json({
      agent: {
        id: agent.id,
        name: agent.name,
        email: agent.email,
        tenantId: agent.tenant_id,
        tenantName: agent.tenant_name,
      },
    });
  }),
);

authRouter.get(
  "/agents",
  requireAgent,
  asyncHandler(async (req, res) => {
    const { tenantId } = req as AuthedRequest;
    res.json({ agents: await listAgents(tenantId) });
  }),
);

import { Router } from "express";
import {
  addAllowedIp,
  assertIpAllowed,
  clientIp,
  createAgent,
  getAgentByEmail,
  getTenant,
  listAgents,
  listAllowedIps,
  removeAllowedIp,
  setAllowAllIps,
  tenantAllowsAllIps,
  updateAgent,
  updateTenantSettings,
} from "../inbox/index.js";
import { canSeePhone } from "../inbox/policy.js";
import { DEMO_PASSWORDS } from "../inbox/agents.js";
import { hashPassword, verifyPassword } from "../inbox/password.js";
import { query } from "../db.js";
import type { AgentRole, AgentStatus } from "../inbox/types.js";
import { asyncHandler, requireAction, requireAgent, type AuthedRequest } from "./middleware.js";

export const authRouter = Router();

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const email = String(req.body?.email ?? "").trim();
    const password = String(req.body?.password ?? "").trim();
    if (!email || !password) {
      res.status(400).json({ error: "email and password are required" });
      return;
    }
    const agent = await getAgentByEmail(email);
    const hashOk = agent ? await verifyPassword(password, agent.password_hash) : false;
    const demoOk = Boolean(agent && DEMO_PASSWORDS[agent.email.toLowerCase()] === password);
    if (!agent || (!hashOk && !demoOk)) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    if (demoOk && !hashOk) {
      await query("UPDATE agents SET password_hash = $2 WHERE id = $1", [
        agent.id,
        await hashPassword(password),
      ]);
    }
    if (agent.status !== "active") {
      res.status(403).json({ error: "This account is disabled" });
      return;
    }
    await assertIpAllowed(agent.tenant_id, clientIp(req), "sign in");
    const tenant = await getTenant(agent.tenant_id);
    res.json({
      agent: sessionAgent(
        agent,
        tenant?.name ?? "",
        Boolean(tenant?.agents_can_see_phone),
        tenant?.agents_can_see_history !== 0 && tenant?.agents_can_see_history !== false,
      ),
    });
  }),
);

authRouter.get(
  "/me",
  requireAgent,
  asyncHandler(async (req, res) => {
    const { agent, tenantId, agentsCanSeePhone } = req as AuthedRequest;
    const tenant = await getTenant(tenantId);
    res.json({
      agent: sessionAgent(
        agent,
        tenant?.name ?? "",
        agentsCanSeePhone,
        tenant?.agents_can_see_history !== 0 && tenant?.agents_can_see_history !== false,
      ),
      tenant: {
        id: tenant?.id,
        name: tenant?.name,
        agentsCanSeePhone,
        agentsCanSeeHistory: tenant?.agents_can_see_history !== 0 && tenant?.agents_can_see_history !== false,
      },
    });
  }),
);

authRouter.get(
  "/agents",
  requireAgent,
  asyncHandler(async (req, res) => {
    const { tenantId } = req as AuthedRequest;
    const q = req.query.q ? String(req.query.q) : undefined;
    const role = parseRole(req.query.role);
    const status = parseStatus(req.query.status);
    res.json({ agents: await listAgents(tenantId, { q, role, status }) });
  }),
);

authRouter.post(
  "/agents",
  requireAgent,
  requireAction("managePeople"),
  asyncHandler(async (req, res) => {
    const { tenantId, agent } = req as AuthedRequest;
    const created = await createAgent({
      actor: agent,
      tenantId,
      name: String(req.body?.name ?? ""),
      email: String(req.body?.email ?? ""),
      password: String(req.body?.password ?? ""),
      role: parseRequiredRole(req.body?.role),
    });
    res.status(201).json({ agent: created });
  }),
);

authRouter.patch(
  "/agents/:id",
  requireAgent,
  requireAction("managePeople"),
  asyncHandler(async (req, res) => {
    const { tenantId, agent } = req as AuthedRequest;
    const updated = await updateAgent({
      actor: agent,
      tenantId,
      agentId: req.params.id,
      name: req.body?.name != null ? String(req.body.name) : undefined,
      email: req.body?.email != null ? String(req.body.email) : undefined,
      password: req.body?.password ? String(req.body.password) : undefined,
      role: req.body?.role ? parseRequiredRole(req.body.role) : undefined,
      status: req.body?.status ? parseRequiredStatus(req.body.status) : undefined,
    });
    res.json({ agent: updated });
  }),
);

authRouter.patch(
  "/tenant",
  requireAgent,
  requireAction("tenantSettings"),
  asyncHandler(async (req, res) => {
    const { tenantId } = req as AuthedRequest;
    const tenant = await updateTenantSettings(tenantId, {
      agentsCanSeePhone: req.body?.agentsCanSeePhone != null ? Boolean(req.body.agentsCanSeePhone) : undefined,
      agentsCanSeeHistory: req.body?.agentsCanSeeHistory != null ? Boolean(req.body.agentsCanSeeHistory) : undefined,
    });
    res.json({
      tenant: {
        id: tenant.id,
        name: tenant.name,
        agentsCanSeePhone: Boolean(tenant.agents_can_see_phone),
        agentsCanSeeHistory: tenant.agents_can_see_history !== 0 && tenant.agents_can_see_history !== false,
      },
    });
  }),
);

authRouter.get(
  "/ip-allowlist",
  requireAgent,
  requireAction("tenantSettings"),
  asyncHandler(async (req, res) => {
    const { tenantId } = req as AuthedRequest;
    const currentIp = clientIp(req);
    res.json({
      allowAllIps: await tenantAllowsAllIps(tenantId),
      currentIp,
      ips: await listAllowedIps(tenantId),
    });
  }),
);

authRouter.patch(
  "/ip-allowlist",
  requireAgent,
  requireAction("tenantSettings"),
  asyncHandler(async (req, res) => {
    const { tenantId } = req as AuthedRequest;
    if (typeof req.body?.allowAllIps !== "boolean") {
      res.status(400).json({ error: "allowAllIps is required" });
      return;
    }
    const currentIp = clientIp(req);
    await setAllowAllIps(tenantId, req.body.allowAllIps, currentIp);
    res.json({
      allowAllIps: await tenantAllowsAllIps(tenantId),
      currentIp,
      ips: await listAllowedIps(tenantId),
    });
  }),
);

authRouter.post(
  "/ip-allowlist",
  requireAgent,
  requireAction("tenantSettings"),
  asyncHandler(async (req, res) => {
    const { tenantId } = req as AuthedRequest;
    const currentIp = clientIp(req);
    const ip = String(req.body?.ip ?? currentIp);
    const created = await addAllowedIp(tenantId, ip);
    res.status(201).json({
      ip: created,
      allowAllIps: await tenantAllowsAllIps(tenantId),
      currentIp,
      ips: await listAllowedIps(tenantId),
    });
  }),
);

authRouter.delete(
  "/ip-allowlist/:id",
  requireAgent,
  requireAction("tenantSettings"),
  asyncHandler(async (req, res) => {
    const { tenantId } = req as AuthedRequest;
    const currentIp = clientIp(req);
    await removeAllowedIp(tenantId, req.params.id, currentIp);
    res.json({
      allowAllIps: await tenantAllowsAllIps(tenantId),
      currentIp,
      ips: await listAllowedIps(tenantId),
    });
  }),
);

function sessionAgent(
  agent: { id: string; name: string; email: string; tenant_id: string; role: AgentRole; status: AgentStatus },
  tenantName: string,
  agentsCanSeePhone: boolean,
  agentsCanSeeHistory = true,
) {
  return {
    id: agent.id,
    name: agent.name,
    email: agent.email,
    tenantId: agent.tenant_id,
    tenantName,
    role: agent.role,
    status: agent.status,
    seePhone: canSeePhone(agent.role, agentsCanSeePhone),
    agentsCanSeePhone,
    agentsCanSeeHistory,
  };
}

function parseRole(value: unknown): AgentRole | "all" {
  if (value === "super_admin" || value === "manager" || value === "agent") return value;
  return "all";
}

function parseStatus(value: unknown): AgentStatus | "all" {
  if (value === "active" || value === "disabled") return value;
  return "all";
}

function parseRequiredRole(value: unknown): AgentRole {
  if (value === "super_admin" || value === "manager" || value === "agent") return value;
  throw Object.assign(new Error("role must be super_admin, manager, or agent"), { status: 400 });
}

function parseRequiredStatus(value: unknown): AgentStatus {
  if (value === "active" || value === "disabled") return value;
  throw Object.assign(new Error("status must be active or disabled"), { status: 400 });
}


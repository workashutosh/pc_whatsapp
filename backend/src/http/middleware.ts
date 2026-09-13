import type { NextFunction, Request, Response } from "express";
import { assertIpAllowed, clientIp, getAgentInTenant, getTenant } from "../inbox/index.js";
import { can, canSeePhone, type PolicyAction } from "../inbox/policy.js";
import type { Agent, AgentRole } from "../inbox/types.js";

export interface AuthedRequest extends Request {
  tenantId: string;
  agentId: string;
  role: AgentRole;
  agent: Agent;
  agentsCanSeePhone: boolean;
  seePhone: boolean;
}

export async function requireAgent(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = String(req.header("x-tenant-id") ?? "");
  const agentId = String(req.header("x-agent-id") ?? "");
  if (!tenantId || !agentId) {
    res.status(401).json({ error: "Missing X-Tenant-Id or X-Agent-Id" });
    return;
  }
  const agent = await getAgentInTenant(agentId, tenantId);
  if (!agent) {
    res.status(401).json({ error: "Unknown agent for this tenant" });
    return;
  }
  if (agent.status !== "active") {
    res.status(403).json({ error: "This account is disabled" });
    return;
  }
  const tenant = await getTenant(tenantId);
  try {
    await assertIpAllowed(tenantId, clientIp(req), "use the inbox");
  } catch (error) {
    const status = Number((error as { status?: number }).status ?? 403);
    res.status(status).json({ error: error instanceof Error ? error.message : "This IP is not allowed" });
    return;
  }
  const agentsCanSeePhone = Boolean(tenant?.agents_can_see_phone);
  const authed = req as AuthedRequest;
  authed.tenantId = tenantId;
  authed.agentId = agentId;
  authed.role = agent.role;
  authed.agent = agent;
  authed.agentsCanSeePhone = agentsCanSeePhone;
  authed.seePhone = canSeePhone(agent.role, agentsCanSeePhone);
  next();
}

export function requireRole(...roles: AgentRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = (req as AuthedRequest).role;
    if (!role || !roles.includes(role)) {
      res.status(403).json({ error: "You do not have permission for this action" });
      return;
    }
    next();
  };
}

export function requireAction(...actions: PolicyAction[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = (req as AuthedRequest).role;
    if (!actions.some((action) => can(role, action))) {
      res.status(403).json({ error: "You do not have permission for this action" });
      return;
    }
    next();
  };
}

export function asyncHandler(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

export function httpError(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const status = Number((error as { status?: number })?.status ?? 500);
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (status >= 500) {
    console.error(error);
  }
  res.status(status).json({ error: message });
}

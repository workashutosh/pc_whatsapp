import type { NextFunction, Request, Response } from "express";
import { assertIpAllowed, clientIp, getSessionAgent, getTenant } from "../inbox/index.js";
import { can, canSeePhone, type PolicyAction } from "../inbox/policy.js";
import type { Agent, AgentRole } from "../inbox/types.js";

export interface AuthedRequest extends Request {
  tenantId: string;
  agentId: string;
  role: AgentRole;
  agent: Agent;
  agentsCanSeePhone: boolean;
  seePhone: boolean;
  sessionToken: string;
}

export function bearerToken(header: string | undefined): string {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  return match?.[1]?.trim() ?? "";
}

export async function requireAgent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = bearerToken(req.header("authorization"));
    const agent = await getSessionAgent(token);
    if (!agent) {
      res.status(401).json({ error: "Please sign in again" });
      return;
    }
    if (agent.status !== "active") {
      res.status(403).json({ error: "This account is disabled" });
      return;
    }
    const tenantId = agent.tenant_id;
    await assertIpAllowed(tenantId, clientIp(req), "use the inbox");
    const tenant = await getTenant(tenantId);
    const agentsCanSeePhone = Boolean(tenant?.agents_can_see_phone);
    const authed = req as AuthedRequest;
    authed.tenantId = tenantId;
    authed.agentId = agent.id;
    authed.role = agent.role;
    authed.agent = agent;
    authed.agentsCanSeePhone = agentsCanSeePhone;
    authed.seePhone = canSeePhone(agent.role, agentsCanSeePhone);
    authed.sessionToken = token;
    next();
  } catch (error) {
    next(error);
  }
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
  const explicitStatus = (error as { status?: number })?.status;
  const status = Number(explicitStatus ?? 500);
  if (status >= 500) {
    console.error(error);
  }
  // Errors thrown with an explicit status carry a user-facing message; anything else (SQL, bugs) stays server-side.
  const message = explicitStatus != null && error instanceof Error ? error.message : "Unexpected server error";
  res.status(status).json({ error: message });
}

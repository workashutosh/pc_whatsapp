import type { NextFunction, Request, Response } from "express";
import { getAgentInTenant } from "../inbox/index.js";

export interface AuthedRequest extends Request {
  tenantId: string;
  agentId: string;
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
  (req as AuthedRequest).tenantId = tenantId;
  (req as AuthedRequest).agentId = agentId;
  next();
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

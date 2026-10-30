import { timingSafeEqual } from "node:crypto";
import { Router, type Request } from "express";
import { config } from "../config.js";
import { handleProviderWebhook } from "../inbox/index.js";
import { asyncHandler, bearerToken } from "./middleware.js";

export const webhookRouter = Router();

webhookRouter.post(
  "/whatsapp",
  asyncHandler(async (req, res) => {
    if (!hasValidSecret(req)) {
      res.status(401).json({ error: "invalid webhook secret" });
      return;
    }

    const payloads = flattenWebhook(req.body);
    for (const payload of payloads) {
      await handleProviderWebhook(payload);
    }
    res.json({ ok: true });
  }),
);

/** Evolution sends the secret as a header; the query param is the fallback for builds that drop custom headers. */
function hasValidSecret(req: Request): boolean {
  const candidates = [
    req.header("x-webhook-secret"),
    bearerToken(req.header("authorization")),
    typeof req.query.secret === "string" ? req.query.secret : undefined,
  ];
  const expected = Buffer.from(config.webhookSecret);
  return candidates.some((value) => {
    if (!value) return false;
    const given = Buffer.from(value);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

function flattenWebhook(body: unknown): unknown[] {
  if (!body || typeof body !== "object") return [];
  const record = body as Record<string, unknown>;
  if (Array.isArray(record.data)) {
    return record.data.map((item) => ({ ...record, data: item }));
  }
  return [body];
}

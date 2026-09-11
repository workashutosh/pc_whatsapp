import { Router } from "express";
import { config } from "../config.js";
import { handleProviderWebhook } from "../inbox/index.js";
import { asyncHandler } from "./middleware.js";

export const webhookRouter = Router();

webhookRouter.post(
  "/whatsapp",
  asyncHandler(async (req, res) => {
    const secret = req.header("x-webhook-secret") ?? req.header("authorization");
    if (config.webhookSecret && secret && !secret.includes(config.webhookSecret)) {
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

function flattenWebhook(body: unknown): unknown[] {
  if (!body || typeof body !== "object") return [];
  const record = body as Record<string, unknown>;
  if (Array.isArray(record.data)) {
    return record.data.map((item) => ({ ...record, data: item }));
  }
  return [body];
}

import { Router } from "express";
import {
  addInternalNote,
  assignConversation,
  claimConversation,
  getConversation,
  listConversations,
  listInternalNotes,
  listMessages,
  lockConversation,
  sendAgentReply,
  setConversationStatus,
  simulateInbound,
  unlockConversation,
} from "../inbox/index.js";
import { asyncHandler, requireAgent, type AuthedRequest } from "./middleware.js";

export const conversationRouter = Router();
conversationRouter.use(requireAgent);

conversationRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { tenantId, agentId } = req as AuthedRequest;
    const filter = parseFilter(req.query.filter);
    res.json({ conversations: await listConversations(tenantId, filter, agentId) });
  }),
);

conversationRouter.post(
  "/simulate",
  asyncHandler(async (req, res) => {
    const { tenantId } = req as AuthedRequest;
    const result = await simulateInbound({
      tenantId,
      phone: String(req.body?.phone ?? ""),
      text: String(req.body?.text ?? ""),
      name: req.body?.name ? String(req.body.name) : undefined,
    });
    res.status(201).json(result);
  }),
);

conversationRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { tenantId } = req as AuthedRequest;
    const conversation = await getConversation(tenantId, req.params.id);
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    res.json({ conversation });
  }),
);

conversationRouter.post(
  "/:id/claim",
  asyncHandler(async (req, res) => {
    const { tenantId, agentId } = req as AuthedRequest;
    res.json({ conversation: await claimConversation(tenantId, req.params.id, agentId) });
  }),
);

conversationRouter.post(
  "/:id/assign",
  asyncHandler(async (req, res) => {
    const { tenantId } = req as AuthedRequest;
    const agentId = req.body?.agentId ? String(req.body.agentId) : null;
    res.json({ conversation: await assignConversation(tenantId, req.params.id, agentId) });
  }),
);

conversationRouter.post(
  "/:id/lock",
  asyncHandler(async (req, res) => {
    const { tenantId, agentId } = req as AuthedRequest;
    res.json({ conversation: await lockConversation(tenantId, req.params.id, agentId) });
  }),
);

conversationRouter.post(
  "/:id/unlock",
  asyncHandler(async (req, res) => {
    const { tenantId, agentId } = req as AuthedRequest;
    res.json({ conversation: await unlockConversation(tenantId, req.params.id, agentId) });
  }),
);

conversationRouter.patch(
  "/:id/status",
  asyncHandler(async (req, res) => {
    const { tenantId } = req as AuthedRequest;
    const status = String(req.body?.status ?? "");
    if (!["open", "pending", "closed"].includes(status)) {
      res.status(400).json({ error: "status must be open, pending, or closed" });
      return;
    }
    res.json({
      conversation: await setConversationStatus(
        tenantId,
        req.params.id,
        status as "open" | "pending" | "closed",
      ),
    });
  }),
);

conversationRouter.get(
  "/:id/messages",
  asyncHandler(async (req, res) => {
    const { tenantId } = req as AuthedRequest;
    res.json({ messages: await listMessages(tenantId, req.params.id) });
  }),
);

conversationRouter.post(
  "/:id/messages",
  asyncHandler(async (req, res) => {
    const { tenantId, agentId } = req as AuthedRequest;
    const result = await sendAgentReply({
      tenantId,
      conversationId: req.params.id,
      agentId,
      text: String(req.body?.text ?? ""),
      image: parseImageBody(req.body?.image),
    });
    res.status(201).json(result);
  }),
);

conversationRouter.get(
  "/:id/notes",
  asyncHandler(async (req, res) => {
    const { tenantId } = req as AuthedRequest;
    res.json({ notes: await listInternalNotes(tenantId, req.params.id) });
  }),
);

conversationRouter.post(
  "/:id/notes",
  asyncHandler(async (req, res) => {
    const { tenantId, agentId } = req as AuthedRequest;
    const note = String(req.body?.note ?? "").trim();
    if (!note) {
      res.status(400).json({ error: "note is required" });
      return;
    }
    res.status(201).json({
      note: await addInternalNote({
        tenantId,
        conversationId: req.params.id,
        agentId,
        note,
      }),
    });
  }),
);

function parseFilter(value: unknown): "all" | "mine" | "unassigned" {
  if (value === "mine" || value === "unassigned") return value;
  return "all";
}

function parseImageBody(
  value: unknown,
): { base64: string; mimetype?: string; filename?: string } | null {
  if (!value || typeof value !== "object") return null;
  const image = value as Record<string, unknown>;
  const base64 = typeof image.base64 === "string" ? image.base64 : "";
  if (!base64.trim()) return null;
  return {
    base64,
    mimetype: typeof image.mimetype === "string" ? image.mimetype : undefined,
    filename: typeof image.filename === "string" ? image.filename : undefined,
  };
}

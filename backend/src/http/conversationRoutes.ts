import { Router } from "express";
import {
  addInternalNote,
  assignConversation,
  getConversationForActor,
  listConversations,
  listInternalNotes,
  listMessages,
  lockConversation,
  sendAgentReply,
  setConversationStatus,
  simulateInbound,
  startConversation,
  unlockConversation,
} from "../inbox/index.js";
import { redactConversation } from "../inbox/policy.js";
import type { ConversationStatus } from "../inbox/types.js";
import { asyncHandler, requireAction, requireAgent, type AuthedRequest } from "./middleware.js";

export const conversationRouter = Router();
conversationRouter.use(requireAgent);

conversationRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { tenantId, agentId, role, seePhone } = req as AuthedRequest;
    const conversations = await listConversations(
      tenantId,
      { id: agentId, role },
      {
        q: req.query.q ? String(req.query.q) : undefined,
        status: parseStatus(req.query.status),
        assignedAgentId: req.query.assignedAgentId ? String(req.query.assignedAgentId) : "all",
      },
    );
    res.json({
      conversations: conversations.map((item) => redactConversation(item, seePhone, { id: agentId, role })),
    });
  }),
);

conversationRouter.post(
  "/",
  requireAction("startConversation"),
  asyncHandler(async (req, res) => {
    const { tenantId, agentId, role, seePhone } = req as AuthedRequest;
    const result = await startConversation({
      tenantId,
      agentId,
      actorRole: role,
      phone: String(req.body?.phone ?? ""),
      name: req.body?.name ? String(req.body.name) : null,
      text: String(req.body?.text ?? ""),
      image: parseImageBody(req.body?.image),
    });
    res.status(201).json({
      message: result.message,
      conversation: redactConversation(result.conversation, seePhone, { id: agentId, role }),
    });
  }),
);

conversationRouter.post(
  "/simulate",
  requireAction("manageWhatsApp"),
  asyncHandler(async (req, res) => {
    const { tenantId, seePhone } = req as AuthedRequest;
    const result = await simulateInbound({
      tenantId,
      phone: String(req.body?.phone ?? ""),
      text: String(req.body?.text ?? ""),
      name: req.body?.name ? String(req.body.name) : undefined,
    });
    res.status(201).json({
      ...result,
      conversation: redactConversation(result.conversation, seePhone),
    });
  }),
);

conversationRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { tenantId, agentId, role, seePhone } = req as AuthedRequest;
    const conversation = await getConversationForActor(tenantId, req.params.id, { id: agentId, role });
    res.json({ conversation: redactConversation(conversation, seePhone, { id: agentId, role }) });
  }),
);

conversationRouter.post(
  "/:id/claim",
  asyncHandler(async (_req, res) => {
    res.status(403).json({ error: "Claiming is disabled. A manager must assign the chat." });
  }),
);

conversationRouter.post(
  "/:id/assign",
  requireAction("assign"),
  asyncHandler(async (req, res) => {
    const { tenantId, seePhone } = req as AuthedRequest;
    const agentId = req.body?.agentId ? String(req.body.agentId) : null;
    const canSeeHistory =
      req.body?.canSeeHistory === undefined ? undefined : Boolean(req.body.canSeeHistory);
    const conversation = await assignConversation(tenantId, req.params.id, agentId, { canSeeHistory });
    res.json({ conversation: redactConversation(conversation, seePhone) });
  }),
);

conversationRouter.post(
  "/:id/lock",
  asyncHandler(async (req, res) => {
    const { tenantId, agentId, role, seePhone } = req as AuthedRequest;
    await getConversationForActor(tenantId, req.params.id, { id: agentId, role });
    const conversation = await lockConversation(tenantId, req.params.id, agentId);
    res.json({ conversation: redactConversation(conversation, seePhone) });
  }),
);

conversationRouter.post(
  "/:id/unlock",
  asyncHandler(async (req, res) => {
    const { tenantId, agentId, role, seePhone } = req as AuthedRequest;
    await getConversationForActor(tenantId, req.params.id, { id: agentId, role });
    const conversation = await unlockConversation(tenantId, req.params.id, agentId);
    res.json({ conversation: redactConversation(conversation, seePhone) });
  }),
);

conversationRouter.patch(
  "/:id/status",
  requireAction("stopConversation"),
  asyncHandler(async (req, res) => {
    const { tenantId, seePhone } = req as AuthedRequest;
    const status = String(req.body?.status ?? "");
    if (!["open", "pending", "closed"].includes(status)) {
      res.status(400).json({ error: "status must be open, pending, or closed" });
      return;
    }
    res.json({
      conversation: redactConversation(
        await setConversationStatus(tenantId, req.params.id, status as ConversationStatus),
        seePhone,
      ),
    });
  }),
);

conversationRouter.get(
  "/:id/messages",
  asyncHandler(async (req, res) => {
    const { tenantId, agentId, role } = req as AuthedRequest;
    await getConversationForActor(tenantId, req.params.id, { id: agentId, role });
    res.json({ messages: await listMessages(tenantId, req.params.id, { id: agentId, role }) });
  }),
);

conversationRouter.post(
  "/:id/messages",
  asyncHandler(async (req, res) => {
    const { tenantId, agentId, role, seePhone } = req as AuthedRequest;
    const result = await sendAgentReply({
      tenantId,
      conversationId: req.params.id,
      agentId,
      actorRole: role,
      text: String(req.body?.text ?? ""),
      image: parseImageBody(req.body?.image),
    });
    res.status(201).json({
      message: result.message,
      conversation: redactConversation(result.conversation, seePhone),
    });
  }),
);

conversationRouter.get(
  "/:id/notes",
  asyncHandler(async (req, res) => {
    const { tenantId, agentId, role } = req as AuthedRequest;
    await getConversationForActor(tenantId, req.params.id, { id: agentId, role });
    res.json({ notes: await listInternalNotes(tenantId, req.params.id, { id: agentId, role }) });
  }),
);

conversationRouter.post(
  "/:id/notes",
  asyncHandler(async (req, res) => {
    const { tenantId, agentId, role } = req as AuthedRequest;
    await getConversationForActor(tenantId, req.params.id, { id: agentId, role });
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

function parseStatus(value: unknown): ConversationStatus | "all" {
  if (value === "open" || value === "pending" || value === "closed") return value;
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

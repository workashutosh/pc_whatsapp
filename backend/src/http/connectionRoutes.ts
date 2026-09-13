import { Router } from "express";
import {
  connectNumber,
  disconnectNumber,
  listConnections,
  refreshConnectionQr,
  refreshRemoteStatus,
  switchNumber,
} from "../core/index.js";
import { asyncHandler, requireAction, requireAgent, type AuthedRequest } from "./middleware.js";

export const connectionRouter = Router();
connectionRouter.use(requireAgent);

connectionRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { tenantId } = req as AuthedRequest;
    res.json({ connections: await listConnections(tenantId) });
  }),
);

connectionRouter.post(
  "/",
  requireAction("manageWhatsApp"),
  asyncHandler(async (req, res) => {
    const { tenantId } = req as AuthedRequest;
    const provider = req.body?.provider === "cloud_api" ? "cloud_api" : "evolution";
    const result = await connectNumber(tenantId, provider);
    res.status(201).json(result);
  }),
);

connectionRouter.post(
  "/switch",
  requireAction("manageWhatsApp"),
  asyncHandler(async (req, res) => {
    const { tenantId } = req as AuthedRequest;
    const provider = req.body?.provider === "cloud_api" ? "cloud_api" : "evolution";
    const result = await switchNumber(tenantId, provider);
    res.json(result);
  }),
);

connectionRouter.post(
  "/:id/disconnect",
  requireAction("manageWhatsApp"),
  asyncHandler(async (req, res) => {
    const { tenantId } = req as AuthedRequest;
    const connection = await disconnectNumber(tenantId, req.params.id);
    res.json({ connection });
  }),
);

connectionRouter.get(
  "/:id/qr",
  requireAction("manageWhatsApp"),
  asyncHandler(async (req, res) => {
    const { tenantId } = req as AuthedRequest;
    res.json(await refreshConnectionQr(tenantId, req.params.id));
  }),
);

connectionRouter.get(
  "/:id/status",
  asyncHandler(async (req, res) => {
    const { tenantId } = req as AuthedRequest;
    res.json(await refreshRemoteStatus(tenantId, req.params.id));
  }),
);

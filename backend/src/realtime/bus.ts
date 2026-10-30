import type { Server, Socket } from "socket.io";

/**
 * Generic tenant-scoped event bus. Core and inbox both emit through here, so it must not import either layer.
 * Per-viewer redaction is plugged in at startup via setPayloadFilter.
 */

export type PayloadFilter = (socket: Socket, event: string, payload: unknown) => unknown;

let io: Server | null = null;
let filter: PayloadFilter = (_socket, _event, payload) => payload;

export function setIo(server: Server): void {
  io = server;
}

export function setPayloadFilter(next: PayloadFilter): void {
  filter = next;
}

export function tenantRoom(tenantId: string): string {
  return `tenant:${tenantId}`;
}

export function emitToTenant(tenantId: string, event: string, payload: unknown): void {
  if (!io) return;
  const room = io.sockets.adapter.rooms.get(tenantRoom(tenantId));
  if (!room) return;
  for (const socketId of room) {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) continue;
    const next = filter(socket, event, payload);
    if (next === undefined) continue;
    socket.emit(event, next);
  }
}

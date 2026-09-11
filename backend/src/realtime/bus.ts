import type { Server } from "socket.io";

let io: Server | null = null;

export function setIo(server: Server): void {
  io = server;
}

export function getIo(): Server {
  if (!io) {
    throw new Error("Socket.io has not been initialized");
  }
  return io;
}

export function tenantRoom(tenantId: string): string {
  return `tenant:${tenantId}`;
}

export function emitToTenant(tenantId: string, event: string, payload: unknown): void {
  if (!io) return;
  io.to(tenantRoom(tenantId)).emit(event, payload);
}

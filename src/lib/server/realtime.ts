import type { Server as IOServer } from "socket.io";

declare global {
  // eslint-disable-next-line no-var
  var __io: IOServer | undefined;
}

export function setIO(io: IOServer) {
  globalThis.__io = io;
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  const io = globalThis.__io;
  if (!io) return;
  io.to(`user:${userId}`).emit(event, payload);
}

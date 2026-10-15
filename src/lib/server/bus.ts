import { EventEmitter } from "events";

export type BusPayload = Record<string, unknown> | undefined;

type BusEvent = { userId: string | null; type: string; payload: BusPayload };

const g = globalThis as unknown as { __msBus?: EventEmitter };
export const bus = g.__msBus ?? (g.__msBus = new EventEmitter());
bus.setMaxListeners(2000);

/** Отправка realtime-события пользователю (userId) или всем (null). */
export function emit(userId: string | null, type: string, payload?: BusPayload) {
  bus.emit("event", { userId, type, payload } satisfies BusEvent);
}

export function subscribe(userId: string, listener: (type: string, payload: BusPayload) => void) {
  const handler = (ev: BusEvent) => {
    if (ev.userId === null || ev.userId === userId) listener(ev.type, ev.payload);
  };
  bus.on("event", handler);
  return () => bus.off("event", handler);
}

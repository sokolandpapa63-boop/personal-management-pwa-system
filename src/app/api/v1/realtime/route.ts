import type { NextRequest } from "next/server";
import { getSession } from "@/lib/server/auth";
import { subscribe } from "@/lib/server/bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** SSE-поток realtime-событий пользователя (аналог wss://api/ws?token=). */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return new Response(JSON.stringify({ error: { code: "unauthorized" } }), { status: 401 });
  }
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (str: string) => {
        try {
          controller.enqueue(encoder.encode(str));
        } catch {
          /* поток закрыт */
        }
      };
      send(`retry: 3000\nevent: hello\ndata: {"ok":true}\n\n`);
      unsubscribe = subscribe(session.userId, (type, payload) => {
        send(`event: ${type}\ndata: ${JSON.stringify(payload ?? {})}\n\n`);
      });
      heartbeat = setInterval(() => send(`: ping\n\n`), 25000);
      const close = () => {
        heartbeat && clearInterval(heartbeat);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          /* уже закрыт */
        }
      };
      req.signal.addEventListener("abort", close);
    },
    cancel() {
      heartbeat && clearInterval(heartbeat);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
  headers: {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    "x-accel-buffering": "no",
  },
});

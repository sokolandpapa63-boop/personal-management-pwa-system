import type { NextRequest } from "next/server";
import { getSession } from "@/lib/server/auth";
import { subscribe } from "@/lib/server/bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Максимальное время жизни одного SSE-соединения.
 * Vercel убивает функцию по таймауту (в логах видно 300 с), а каждый
 * висящий стрим держит ресурсы и соединения. Поэтому через 25 секунд
 * мы шлём клиенту «reconnect» и закрываем поток — EventSource сам
 * переподключится (retry: 3000 из hello-события).
 */
const MAX_STREAM_MS = 25_000;
const HEARTBEAT_MS = 20_000;

/** SSE-поток realtime-событий пользователя (аналог wss://api/ws?token=). */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return new Response(JSON.stringify({ error: { code: "unauthorized" } }), { status: 401 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let lifetime: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (str: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(str));
        } catch {
          /* поток уже закрыт */
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (lifetime) clearTimeout(lifetime);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          /* уже закрыт */
        }
      };

      send(`retry: 3000\nevent: hello\ndata: {"ok":true}\n\n`);

      unsubscribe = subscribe(session.userId, (type, payload) => {
        send(`event: ${type}\ndata: ${JSON.stringify(payload ?? {})}\n\n`);
      });

      heartbeat = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS);

      // Клиент сам переподключится после закрытия (retry: 3000).
      lifetime = setTimeout(() => {
        send(`event: reconnect\ndata: {}\n\n`);
        close();
      }, MAX_STREAM_MS);

      req.signal.addEventListener("abort", close);
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (lifetime) clearTimeout(lifetime);
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
}
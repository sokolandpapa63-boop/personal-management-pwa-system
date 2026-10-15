"use client";

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useAuthStore, useUiStore } from "@/lib/client/stores";
import { refreshSession, api } from "@/lib/client/api";
import { startRealtime } from "@/lib/client/realtime";
import { Toasts } from "@/components/ui";

function RealtimeAndCron() {
  const status = useAuthStore((s) => s.status);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (status !== "authed") return;
    const stop = startRealtime(queryClient);
    return stop;
  }, [status, queryClient]);

  useEffect(() => {
    if (status !== "authed") return;
    const tick = () => api("/cron/tick", { method: "POST" }).catch(() => undefined);
    tick();
    const id = setInterval(tick, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [status]);

  return null;
}

function RadialWipe() {
  const wipe = useUiStore((s) => s.wipe);
  if (!wipe) return null;
  return <div key={wipe.key} className="wipe" style={{ "--x": `${wipe.x}px`, "--y": `${wipe.y}px` } as React.CSSProperties} />;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Fallback-поллинг при фокусе окна (если WS/SSE недоступен)
            refetchOnWindowFocus: true,
            retry: 1,
          },
        },
      }),
  );

  useEffect(() => {
    // Восстановление сессии по refresh-cookie
    refreshSession().finally(() => useAuthStore.getState().setBooted());
    // PWA service worker
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <RealtimeAndCron />
      {children}
      <RadialWipe />
      <Toasts />
    </QueryClientProvider>
  );
}

"use client";

import type { QueryClient } from "@tanstack/react-query";
import { useAuthStore, useOnlineStore, toast } from "./stores";

export function browserNotify(title: string, body?: string) {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png" });
    }
  } catch {
    /* уведомления недоступны */
  }
}

const INVALIDATIONS: [string, string[]][] = [
  ["task.", ["tasks", "planner", "dashboard"]],
  ["event.", ["events", "planner", "dashboard"]],
  ["record.", ["records", "stats", "dashboard"]],
  ["section.", ["sections", "dashboard"]],
  ["pomodoro.", ["pomodoro", "dashboard"]],
  ["report", ["reports"]],
  ["currency.", ["rates", "dashboard"]],
  ["studySession.", ["study", "dashboard"]],
];

/** Подписка на SSE-поток realtime-событий. Возвращает функцию остановки. */
export function startRealtime(queryClient: QueryClient): () => void {
  let es: EventSource | null = null;
  let stopped = false;

  const connect = () => {
    const token = useAuthStore.getState().accessToken;
    if (!token || stopped) return;
    es?.close();
    es = new EventSource(`/api/v1/realtime?token=${encodeURIComponent(token)}`);

    es.addEventListener("hello", () => useOnlineStore.getState().setOnline(true));

    const forward = (type: string) => (ev: MessageEvent) => {
      useOnlineStore.getState().setOnline(true);
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(ev.data || "{}");
      } catch {
        payload = {};
      }
      handleEvent(type, payload, queryClient);
    };

    const types = [
      "task.created", "task.updated", "task.deleted", "task.completed", "task.reminder",
      "event.created", "event.updated", "event.deleted", "event.reminder",
      "record.created", "record.updated", "record.deleted",
      "section.created", "section.updated", "section.deleted",
      "pomodoro.started", "pomodoro.finished",
      "report.ready", "currency.updated", "studySession.updated",
    ];
    for (const t of types) es.addEventListener(t, forward(t));

    es.onerror = () => {
      useOnlineStore.getState().setOnline(false);
    };
  };

  connect();
  // Переподключение при смене access-токена
  const unsub = useAuthStore.subscribe((state, prev) => {
    if (state.accessToken !== prev.accessToken) connect();
  });

  return () => {
    stopped = true;
    unsub();
    es?.close();
    useOnlineStore.getState().setOnline(false);
  };
}

function handleEvent(type: string, payload: Record<string, unknown>, queryClient: QueryClient) {
  const rule = INVALIDATIONS.find(([prefix]) => type.startsWith(prefix));
  if (rule) {
    for (const key of rule[1]) queryClient.invalidateQueries({ queryKey: [key] });
  }

  if (type === "report.ready") {
    toast.success("Отчёт сформирован", "Документ доступен в разделе «Отчёты»");
    browserNotify("Отчёт сформирован", "Документ доступен в разделе «Отчёты»");
  }
  if (type === "currency.updated") {
    toast.info("Курсы валют обновлены");
  }
  if (type === "pomodoro.finished" && payload.completed) {
    browserNotify("Pomodoro завершён", payload.type === "work" ? "Время перерыва" : "Возвращаемся к работе");
  }
  if (type === "studySession.updated" && payload.transition) {
    const text =
      payload.transition === "started"
        ? "Учебная сессия началась"
        : "Учебная сессия завершилась";
    toast.info(text);
    browserNotify(text);
  }
  if (type === "task.reminder") {
    const title = `Задача: ${String(payload.title ?? "")}`;
    toast.info(title, "Скоро срок выполнения");
    browserNotify(title, "Скоро срок выполнения");
  }
  if (type === "event.reminder") {
    const title = `Событие: ${String(payload.title ?? "")}`;
    toast.info(title, "Скоро начало");
    browserNotify(title, "Скоро начало");
  }
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, GripVertical, Settings2 } from "lucide-react";
import { PomodoroWidget } from "@/components/pomodoro";
import {
  CurrencyWidget, StatsWidget, StudySessionWidget, TasksTodayWidget, UpcomingEventsWidget,
} from "@/components/widgets";
import { ReportDialog } from "@/components/report-dialog";
import { ReportTriggerButton } from "@/components/widgets";
import { cn } from "@/components/ui";
import { useAuthStore } from "@/lib/client/stores";
import { TZ } from "@/lib/client/hooks";

const WIDGETS = [
  { id: "pomodoro", name: "Pomodoro", span: "lg:col-span-4 lg:row-span-2", el: <PomodoroWidget /> },
  { id: "tasks", name: "Задачи на сегодня", span: "lg:col-span-4", el: <TasksTodayWidget /> },
  { id: "events", name: "Ближайшие события", span: "lg:col-span-4", el: <UpcomingEventsWidget /> },
  { id: "session", name: "Учебная сессия", span: "lg:col-span-4", el: <StudySessionWidget /> },
  { id: "currency", name: "Курсы валют", span: "lg:col-span-4", el: <CurrencyWidget /> },
  { id: "stats", name: "Статистика разделов", span: "lg:col-span-8", el: <StatsWidget /> },
];

const LS_KEY = "ms-dashboard-v1";

type Prefs = { order: string[]; hidden: string[] };

function loadPrefs(): Prefs {
  if (typeof window === "undefined") return { order: WIDGETS.map((w) => w.id), hidden: [] };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Prefs;
      const order = [...p.order.filter((id) => WIDGETS.some((w) => w.id === id)), ...WIDGETS.filter((w) => !p.order.includes(w.id)).map((w) => w.id)];
      return { order, hidden: p.hidden ?? [] };
    }
  } catch { /* noop */ }
  return { order: WIDGETS.map((w) => w.id), hidden: [] };
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const [prefs, setPrefs] = useState<Prefs>({ order: WIDGETS.map((w) => w.id), hidden: [] });
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => setPrefs(loadPrefs()), []);
  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(prefs));
  }, [prefs]);

  const greeting = useMemo(() => {
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(new Date()));
    if (hour < 5) return "Доброй ночи";
    if (hour < 12) return "Доброе утро";
    if (hour < 18) return "Добрый день";
    return "Добрый вечер";
  }, []);

  const todayLabel = new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(new Date());

  const onDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    setPrefs((p) => {
      const order = [...p.order];
      const from = order.indexOf(dragId);
      const to = order.indexOf(targetId);
      order.splice(from, 1);
      order.splice(to, 0, dragId);
      return { ...p, order };
    });
  };

  const toggleHidden = (id: string) =>
    setPrefs((p) => ({ ...p, hidden: p.hidden.includes(id) ? p.hidden.filter((x) => x !== id) : [...p.hidden, id] }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-slate-50">
            {greeting}, <span className="bg-gradient-to-r from-cyan-300 to-indigo-300 bg-clip-text text-transparent">{user?.login}</span>
          </h1>
          <p className="mt-1 text-sm capitalize text-slate-500">{todayLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <ReportTriggerButton onClick={() => setReportOpen(true)} />
          <div className="relative">
            <button onClick={() => setConfigOpen((v) => !v)} className="btn btn-ghost btn-sm" title="Настроить виджеты">
              <Settings2 size={15} />
              <span className="hidden sm:inline">Виджеты</span>
            </button>
            {configOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setConfigOpen(false)} />
                <div className="glass-strong absolute right-0 z-40 mt-2 w-64 rounded-xl p-2">
                  <p className="px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Показывать виджеты</p>
                  {prefs.order.map((id) => {
                    const w = WIDGETS.find((x) => x.id === id)!;
                    const hidden = prefs.hidden.includes(id);
                    return (
                      <button key={id} onClick={() => toggleHidden(id)} className="nav-item w-full justify-between">
                        <span>{w.name}</span>
                        {hidden ? <EyeOff size={14} className="text-slate-600" /> : <Eye size={14} className="text-cyan-400" />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-flow-dense lg:grid-cols-12">
        {prefs.order.map((id, idx) => {
          const w = WIDGETS.find((x) => x.id === id)!;
          if (prefs.hidden.includes(id)) return null;
          return (
            <div
              key={id}
              style={{ order: idx }}
              draggable
              onDragStart={(e) => {
                setDragId(id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOverId(id);
              }}
              onDragLeave={() => setOverId((v) => (v === id ? null : v))}
              onDrop={(e) => {
                e.preventDefault();
                onDrop(id);
                setDragId(null);
                setOverId(null);
              }}
              className={cn(
                "widget glass group relative rounded-2xl p-5 md:col-span-1",
                w.span,
                dragId === id && "dragging",
                overId === id && dragId !== id && "drag-over",
              )}
            >
              <div className="absolute right-3 top-3 cursor-grab text-slate-700 opacity-0 transition group-hover:opacity-100">
                <GripVertical size={15} />
              </div>
              {w.el}
            </div>
          );
        })}
      </div>

      <ReportDialog open={reportOpen} onClose={() => setReportOpen(false)} />
    </div>
  );
}

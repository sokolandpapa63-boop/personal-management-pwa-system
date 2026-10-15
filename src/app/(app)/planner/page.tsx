"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { api } from "@/lib/client/api";
import { toast } from "@/lib/client/stores";
import {
  addDaysKey, dateKey, fmtTime, todayKey, useEvents, useSections, useTasks, type AppEvent, type Task,
} from "@/lib/client/hooks";
import { Button, cn, Dialog, Field, Input, Select } from "@/components/ui";
import { TaskDialog } from "@/components/task-dialog";

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

type DragItem = { kind: "task" | "event"; id: string; fromKey: string };

function EventDialog({ event, defaultDate, onClose }: { event: AppEvent | null; defaultDate?: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const sections = useSections().data ?? [];
  const [title, setTitle] = useState(event?.title ?? "");
  const [date, setDate] = useState(event ? dateKey(event.startAt) : defaultDate ?? todayKey());
  const [time, setTime] = useState(event && !event.allDay ? fmtTime(event.startAt) || "10:00" : "10:00");
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [color, setColor] = useState(event?.color ?? "#34d399");
  const [sectionId, setSectionId] = useState(event?.sectionId ?? "");
  const [loading, setLoading] = useState(false);

  async function save() {
    if (!title.trim()) return;
    setLoading(true);
    try {
      const startAt = `${date}T${allDay ? "09:00" : time || "10:00"}:00+03:00`;
      const body = { title: title.trim(), startAt, allDay, color, sectionId: sectionId || null };
      if (event) await api(`/events/${event.id}`, { method: "PATCH", body });
      else await api("/events", { method: "POST", body });
      await queryClient.invalidateQueries({ queryKey: ["events"] });
      toast.success(event ? "Событие обновлено" : "Событие создано");
      onClose();
    } finally {
      setLoading(false);
    }
  }

  const remove = async () => {
    if (!event) return;
    setLoading(true);
    await api(`/events/${event.id}`, { method: "DELETE" });
    await queryClient.invalidateQueries({ queryKey: ["events"] });
    toast.success("Событие удалено");
    onClose();
  };

  return (
    <Dialog open onClose={onClose} title={event ? "Событие" : "Новое событие"}>
      <div className="space-y-4">
        <Field label="Название *">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Дата">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Время (МСК)">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={allDay} />
          </Field>
        </div>
        <Field label="Раздел">
          <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            <option value="">— без раздела —</option>
            {sections.filter((s) => s.kind === "table").map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-slate-400">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="accent-cyan-400" />
            Весь день
          </label>
          <div className="flex gap-1.5">
            {["#34d399", "#22d3ee", "#a78bfa", "#f59e0b", "#fb7185"].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className="h-6 w-6 rounded-full transition-transform hover:scale-110"
                style={{ background: c, boxShadow: color === c ? `0 0 0 2px #0f172a, 0 0 0 3.5px ${c}` : undefined }}
              />
            ))}
          </div>
        </div>
        <div className="flex justify-between">
          {event ? <Button variant="danger" onClick={remove} loading={loading}>Удалить</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Отмена</Button>
            <Button onClick={save} loading={loading} disabled={!title.trim()}>{event ? "Сохранить" : "Создать"}</Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

export default function PlannerPage() {
  const queryClient = useQueryClient();
  const [cursor, setCursor] = useState(() => {
    const [y, m] = todayKey().split("-").map(Number);
    return { y, m };
  });
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [editEvent, setEditEvent] = useState<AppEvent | null>(null);
  const [newTask, setNewTask] = useState<string | null>(null);
  const [newEvent, setNewEvent] = useState<string | null>(null);

  const monthStart = `${cursor.y}-${String(cursor.m).padStart(2, "0")}-01`;
  const from = `${addDaysKey(monthStart, -7)}T00:00:00+03:00`;
  const to = `${addDaysKey(monthStart, 45)}T23:59:59+03:00`;

  const tasks = useTasks({ from, to }).data ?? [];
  const events = useEvents(from, to).data ?? [];
  const sections = useSections().data ?? [];

  const weeks = useMemo(() => {
    const [y, m] = [cursor.y, cursor.m];
    const first = new Date(Date.UTC(y, m - 1, 1));
    const offset = (first.getUTCDay() + 6) % 7;
    const startKey = addDaysKey(monthStart, -offset);
    const rows: string[][] = [];
    for (let w = 0; w < 6; w++) {
      const week: string[] = [];
      for (let d = 0; d < 7; d++) week.push(addDaysKey(startKey, w * 7 + d));
      rows.push(week);
    }
    return rows;
  }, [cursor, monthStart]);

  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.dueAt || t.status !== "active") continue;
      const k = dateKey(t.dueAt);
      map.set(k, [...(map.get(k) ?? []), t]);
    }
    return map;
  }, [tasks]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, AppEvent[]>();
    for (const e of events) {
      const k = dateKey(e.startAt);
      map.set(k, [...(map.get(k) ?? []), e]);
    }
    return map;
  }, [events]);

  const taskColor = (t: Task) => sections.find((s) => s.id === t.sectionId)?.color ?? "#818cf8";

  const onDrop = async (key: string, raw: string) => {
    setDragOverCell(null);
    try {
      const item = JSON.parse(raw) as DragItem;
      if (item.fromKey === key) return;
      if (item.kind === "task") {
        const task = tasks.find((t) => t.id === item.id);
        if (!task?.dueAt) return;
        const time = fmtTime(task.dueAt) || "10:00";
        await api(`/tasks/${task.id}`, { method: "PATCH", body: { dueAt: `${key}T${time}:00+03:00` } });
        await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      } else {
        const ev = events.find((e) => e.id === item.id);
        if (!ev) return;
        const diffDays = Math.round(
          (new Date(`${key}T00:00:00Z`).getTime() - new Date(`${item.fromKey}T00:00:00Z`).getTime()) / 86400000,
        );
        const shift = (iso: string) => new Date(new Date(iso).getTime() + diffDays * 86400000).toISOString();
        await api(`/events/${ev.id}`, {
          method: "PATCH",
          body: { startAt: shift(ev.startAt), endAt: ev.endAt ? shift(ev.endAt) : null },
        });
        await queryClient.invalidateQueries({ queryKey: ["events"] });
      }
      toast.success("Перенесено");
    } catch {
      /* не DnD payload */
    }
  };

  const nav = (delta: number) =>
    setCursor((c) => {
      const d = new Date(Date.UTC(c.y, c.m - 1 + delta, 1));
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-50">
            {MONTHS[cursor.m - 1]} <span className="text-slate-500">{cursor.y}</span>
          </h1>
          <p className="text-xs text-slate-500">перетаскивайте задачи и события между днями</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => nav(-1)}><ChevronLeft size={15} /></Button>
          <Button variant="outline" size="sm" onClick={() => {
            const [y, m] = todayKey().split("-").map(Number);
            setCursor({ y, m });
          }}>Сегодня</Button>
          <Button variant="outline" size="sm" onClick={() => nav(1)}><ChevronRight size={15} /></Button>
          <div className="w-2" />
          <Button variant="outline" size="sm" onClick={() => setNewEvent(todayKey())}><CalendarDays size={14} /> Событие</Button>
          <Button size="sm" onClick={() => setNewTask(todayKey())}><Plus size={14} /> Задача</Button>
        </div>
      </div>

      <div className="glass overflow-hidden rounded-2xl">
        <div className="grid grid-cols-7 border-b border-slate-800/70">
          {WEEKDAY_LABELS.map((d, i) => (
            <div key={d} className={cn("py-2.5 text-center text-[10px] font-bold uppercase tracking-widest", i >= 5 ? "text-rose-400/70" : "text-slate-500")}>
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {weeks.flat().map((key, i) => {
            const inMonth = Number(key.split("-")[1]) === cursor.m;
            const isToday = key === todayKey();
            const dayTasks = tasksByDay.get(key) ?? [];
            const dayEvents = eventsByDay.get(key) ?? [];
            return (
              <div
                key={key}
                className={cn(
                  "cal-cell group relative border-b border-r border-slate-800/50 p-1.5",
                  (i + 1) % 7 === 0 && "border-r-0",
                  !inMonth && "opacity-40",
                  dragOverCell === key && "drag-over",
                )}
                onDragOver={(e) => { e.preventDefault(); setDragOverCell(key); }}
                onDragLeave={() => setDragOverCell((v) => (v === key ? null : v))}
                onDrop={(e) => { e.preventDefault(); onDrop(key, e.dataTransfer.getData("text/plain")); }}
              >
                <div className="flex items-center justify-between">
                  <span className={cn(
                    "num flex h-6 w-6 items-center justify-center rounded-full text-xs",
                    isToday ? "bg-cyan-500 font-bold text-slate-950 shadow-[0_0_14px_rgba(34,211,238,0.6)]" : "text-slate-400",
                  )}>
                    {Number(key.split("-")[2])}
                  </span>
                  <span className="flex gap-0.5 opacity-0 transition group-hover:opacity-100">
                    <button
                      onClick={() => setNewTask(key)}
                      className="rounded bg-slate-800/80 p-1 text-slate-400 hover:text-cyan-300"
                      title="Задача на этот день"
                    >
                      <Plus size={11} />
                    </button>
                    <button
                      onClick={() => setNewEvent(key)}
                      className="rounded bg-slate-800/80 p-1 text-slate-400 hover:text-emerald-300"
                      title="Событие на этот день"
                    >
                      <CalendarDays size={11} />
                    </button>
                  </span>
                </div>
                <div className="mt-1 space-y-1">
                  {dayEvents.map((e) => (
                    <button
                      key={e.id}
                      draggable
                      onDragStart={(ev) => ev.dataTransfer.setData("text/plain", JSON.stringify({ kind: "event", id: e.id, fromKey: key } satisfies DragItem))}
                      onClick={() => setEditEvent(e)}
                      className="cal-chip block w-full truncate rounded-md px-1.5 py-0.5 text-left text-[11px] font-medium text-slate-950"
                      style={{ background: e.color ?? "#34d399" }}
                      title={e.title}
                    >
                      {!e.allDay && <span className="num mr-1 opacity-70">{fmtTime(e.startAt)}</span>}
                      {e.title}
                    </button>
                  ))}
                  {dayTasks.map((t) => (
                    <button
                      key={t.id}
                      draggable
                      onDragStart={(ev) => ev.dataTransfer.setData("text/plain", JSON.stringify({ kind: "task", id: t.id, fromKey: key } satisfies DragItem))}
                      onClick={() => setEditTask(t)}
                      className="cal-chip flex w-full items-center gap-1.5 truncate rounded-md bg-slate-800/70 px-1.5 py-0.5 text-left text-[11px] text-slate-200 ring-1 ring-slate-700/60 transition hover:ring-slate-500"
                      title={t.title}
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: taskColor(t) }} />
                      <span className="num shrink-0 text-slate-500">{fmtTime(t.dueAt)}</span>
                      <span className="truncate">{t.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {editTask && <TaskDialog task={editTask} onClose={() => setEditTask(null)} />}
      {newTask && <TaskDialog task={null} defaultDate={newTask} onClose={() => setNewTask(null)} />}
      {editEvent && <EventDialog event={editEvent} onClose={() => setEditEvent(null)} />}
      {newEvent && <EventDialog event={null} defaultDate={newEvent} onClose={() => setNewEvent(null)} />}
    </div>
  );
}

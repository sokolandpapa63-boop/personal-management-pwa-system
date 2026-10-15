"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { toast } from "@/lib/client/stores";
import { dateKey, fmtTime, todayKey, useSections, type Task } from "@/lib/client/hooks";
import { Button, cn, Dialog, Field, Input, Select, Textarea } from "@/components/ui";

const WEEKDAYS = [
  { d: 1, l: "Пн" }, { d: 2, l: "Вт" }, { d: 3, l: "Ср" }, { d: 4, l: "Чт" },
  { d: 5, l: "Пт" }, { d: 6, l: "Сб" }, { d: 7, l: "Вс" },
];

export function TaskDialog({ task, defaultDate, onClose }: { task: Task | null; defaultDate?: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const sections = useSections().data ?? [];
  const tableSections = sections.filter((s) => s.kind === "table");

  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [sectionId, setSectionId] = useState(task?.sectionId ?? "");
  const [priority, setPriority] = useState(task?.priority ?? 2);
  const [date, setDate] = useState(task?.dueAt ? dateKey(task.dueAt) : defaultDate ?? todayKey());
  const [time, setTime] = useState(task?.dueAt ? fmtTime(task.dueAt) || "10:00" : "10:00");
  const [tagsText, setTagsText] = useState((task?.tags ?? []).join(", "));
  const [freq, setFreq] = useState<string>(task?.recurrence?.freq ?? "none");
  const [interval, setInterval_] = useState(task?.recurrence?.interval ?? 1);
  const [weekdays, setWeekdays] = useState<number[]>(task?.recurrence?.weekdays ?? []);
  const [until, setUntil] = useState(task?.recurrence?.until ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!title.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const dueAt = date ? `${date}T${time || "10:00"}:00+03:00` : null;
      const recurrence =
        freq === "none"
          ? null
          : {
              freq,
              interval: Math.max(1, interval),
              weekdays: freq === "weekdays" || freq === "weekly" ? (weekdays.length ? weekdays : undefined) : undefined,
              until: until || null,
            };
      const tags = tagsText.split(",").map((s) => s.trim()).filter(Boolean);
      const body = {
        title: title.trim(),
        description: description.trim() || null,
        sectionId: sectionId || null,
        priority,
        dueAt,
        recurrence,
        tags: tags.length ? tags : null,
      };
      if (task) {
        await api(`/tasks/${task.id}`, { method: "PATCH", body });
        toast.success("Задача обновлена");
      } else {
        await api("/tasks", { method: "POST", body });
        toast.success("Задача создана");
      }
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["planner"] });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={task ? "Редактировать задачу" : "Новая задача"}>
      <div className="space-y-4">
        <Field label="Название *">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Что нужно сделать?" autoFocus />
        </Field>
        <Field label="Описание">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Детали (необязательно)" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Дата">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Время (МСК)">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Приоритет">
            <div className="flex gap-1">
              {[
                { v: 1, l: "Высокий", c: "rose" },
                { v: 2, l: "Средний", c: "amber" },
                { v: 3, l: "Низкий", c: "slate" },
              ].map((p) => (
                <button
                  key={p.v}
                  type="button"
                  onClick={() => setPriority(p.v)}
                  className={cn(
                    "flex-1 rounded-lg border px-2 py-2 text-xs font-medium transition",
                    priority === p.v
                      ? p.c === "rose"
                        ? "border-rose-400/60 bg-rose-500/15 text-rose-200"
                        : p.c === "amber"
                          ? "border-amber-400/60 bg-amber-500/15 text-amber-200"
                          : "border-slate-400/60 bg-slate-500/20 text-slate-200"
                      : "border-slate-700 text-slate-500 hover:border-slate-500",
                  )}
                >
                  {p.l}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Раздел (для статистики)">
            <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              <option value="">— без раздела —</option>
              {tableSections.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Теги (через запятую)">
          <Input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="работа, здоровье" />
        </Field>

        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
          <Field label="Повторение">
            <Select value={freq} onChange={(e) => setFreq(e.target.value)}>
              <option value="none">Не повторяется</option>
              <option value="daily">Ежедневно</option>
              <option value="weekly">Еженедельно</option>
              <option value="monthly">Ежемесячно</option>
              <option value="weekdays">По дням недели</option>
              <option value="custom">Каждые N дней</option>
            </Select>
          </Field>
          {freq !== "none" && (
            <div className="mt-3 space-y-3">
              {(freq === "custom" || freq === "daily" || freq === "weekly" || freq === "monthly") && (
                <Field label={freq === "custom" ? "Интервал (дней)" : "Интервал"}>
                  <Input type="number" min={1} max={365} value={interval} onChange={(e) => setInterval_(Number(e.target.value) || 1)} />
                </Field>
              )}
              {(freq === "weekdays" || freq === "weekly") && (
                <div className="flex gap-1 pt-1">
                  {WEEKDAYS.map((w) => (
                    <button
                      key={w.d}
                      type="button"
                      onClick={() => setWeekdays((arr) => (arr.includes(w.d) ? arr.filter((x) => x !== w.d) : [...arr, w.d].sort()))}
                      className={cn(
                        "h-8 w-8 rounded-lg border text-xs font-medium transition",
                        weekdays.includes(w.d)
                          ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-200"
                          : "border-slate-700 text-slate-500 hover:border-slate-500",
                      )}
                    >
                      {w.l}
                    </button>
                  ))}
                </div>
              )}
              <Field label="Повторять до (включительно)">
                <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
              </Field>
            </div>
          )}
        </div>

        {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button onClick={save} loading={loading} disabled={!title.trim()}>
            {task ? "Сохранить" : "Создать задачу"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ── Копирование задачи на выбранные даты ────────────────────────────────────
export function DuplicateDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayKey());
  const [dates, setDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const add = () => {
    if (date && !dates.includes(date)) setDates((d) => [...d, date].sort());
  };

  async function submit() {
    if (!dates.length) return;
    setLoading(true);
    try {
      const res = await api<{ created: number }>(`/tasks/${task.id}/duplicate`, { method: "POST", body: { dates } });
      toast.success(`Создано копий: ${res.created}`);
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["planner"] });
      onClose();
    } catch (e) {
      toast.error("Ошибка копирования", e instanceof Error ? e.message : undefined);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={`Копировать «${task.title}»`}>
      <div className="space-y-4">
        <Field label="Добавить дату">
          <div className="flex gap-2">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <Button variant="outline" onClick={add} type="button"><CalendarPlus size={14} /></Button>
          </div>
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {!dates.length && <p className="text-xs text-slate-500">Добавьте одну или несколько дат</p>}
          {dates.map((d) => (
            <span key={d} className="flex items-center gap-1 rounded-full border border-cyan-400/40 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-200">
              {d.split("-").reverse().join(".")}
              <button onClick={() => setDates((arr) => arr.filter((x) => x !== d))}><X size={11} /></button>
            </span>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button onClick={submit} loading={loading} disabled={!dates.length}>Вставить ({dates.length})</Button>
        </div>
      </div>
    </Dialog>
  );
}

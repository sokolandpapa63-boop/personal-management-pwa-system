"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Ban, Check, CheckSquare, Circle, Copy, Pencil, Plus, Repeat, Search, Trash2,
} from "lucide-react";
import { api } from "@/lib/client/api";
import { toast } from "@/lib/client/stores";
import {
  addDaysKey, dateKey, fmtDate, fmtTime, todayKey, useSections, useTasks, type Task,
} from "@/lib/client/hooks";
import { Badge, Button, cn, EmptyState, Input, ReasonDialog, Select } from "@/components/ui";
import { DuplicateDialog, TaskDialog } from "@/components/task-dialog";
import { ImportCsvWidget } from "@/components/import-csv";

type StatusFilter = "active" | "completed" | "cancelled" | "all";

export default function TasksPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>("active");
  const [sectionId, setSectionId] = useState("");
  const [priority, setPriority] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("due");

  const [editTask, setEditTask] = useState<Task | "new" | null>(null);
  const [dupTask, setDupTask] = useState<Task | null>(null);
  const [cancelTask, setCancelTask] = useState<Task | null>(null);
  const [deleteTask, setDeleteTask] = useState<Task | null>(null);

  const tasksQuery = useTasks(status === "all" ? {} : { status });
  const sections = useSections().data ?? [];

  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1") {
      setEditTask("new");
    }
  }, []);

  const sectionName = (id: string | null) => sections.find((s) => s.id === id)?.name;

  const groups = useMemo(() => {
    let rows = tasksQuery.data ?? [];
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((t) => t.title.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q));
    if (sectionId) rows = rows.filter((t) => t.sectionId === sectionId);
    if (priority) rows = rows.filter((t) => t.priority === Number(priority));
    rows = [...rows].sort((a, b) => {
      if (sort === "priority") return a.priority - b.priority || (a.dueAt ?? "") < (b.dueAt ?? "") ? -1 : 1;
      if (sort === "created") return a.createdAt > b.createdAt ? -1 : 1;
      return (a.dueAt ?? "9999") < (b.dueAt ?? "9999") ? -1 : 1;
    });

    if (status !== "active") return [{ label: "", rows }];

    const today = todayKey();
    const tomorrow = addDaysKey(today, 1);
    const weekEnd = addDaysKey(today, 7);
    const g: { label: string; rows: Task[]; accent?: string }[] = [
      { label: "Просроченные", rows: [], accent: "text-rose-400" },
      { label: "Сегодня", rows: [], accent: "text-cyan-300" },
      { label: "Завтра", rows: [], accent: "text-indigo-300" },
      { label: "Ближайшие 7 дней", rows: [] },
      { label: "Позже", rows: [] },
      { label: "Без даты", rows: [] },
    ];
    for (const t of rows) {
      if (!t.dueAt) g[5].rows.push(t);
      else {
        const k = dateKey(t.dueAt);
        if (k < today) g[0].rows.push(t);
        else if (k === today) g[1].rows.push(t);
        else if (k === tomorrow) g[2].rows.push(t);
        else if (k <= weekEnd) g[3].rows.push(t);
        else g[4].rows.push(t);
      }
    }
    return g.filter((x) => x.rows.length);
  }, [tasksQuery.data, search, sectionId, priority, sort, status]);

  const complete = useMutation({
    mutationFn: (id: string) => api(`/tasks/${id}/complete`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Статус задачи изменён");
    },
  });

  const reasonAction = useMutation({
    mutationFn: ({ id, reason, mode }: { id: string; reason: string; mode: "cancel" | "delete" }) =>
      mode === "cancel"
        ? api(`/tasks/${id}/cancel`, { method: "POST", body: { reason } })
        : api(`/tasks/${id}`, { method: "DELETE", body: { reason } }),
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.success(vars.mode === "cancel" ? "Задача отменена" : "Задача удалена");
    },
    onError: (e) => toast.error("Ошибка", e instanceof Error ? e.message : undefined),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-50">Таск-менеджер</h1>
          <p className="text-xs text-slate-500">задачи · повторения · причины отмен обязательны</p>
        </div>
        <Button onClick={() => setEditTask("new")}><Plus size={15} /> Новая задача</Button>
      </div>

      {/* Фильтры */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-slate-800 bg-slate-900/50 p-1">
          {(
            [
              ["active", "Активные"],
              ["completed", "Выполненные"],
              ["cancelled", "Отменённые"],
              ["all", "Все"],
            ] as [StatusFilter, string][]
          ).map(([v, l]) => (
            <button
              key={v}
              onClick={() => setStatus(v)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition",
                status === v ? "bg-cyan-500/20 text-cyan-200" : "text-slate-500 hover:text-slate-300",
              )}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="relative min-w-[160px] flex-1 sm:max-w-56">
          <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <Input className="py-2 pl-8 text-xs" placeholder="Поиск…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select className="w-auto py-2 text-xs" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
          <option value="">Все разделы</option>
          {sections.filter((s) => s.kind === "table").map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Select>
        <Select className="w-auto py-2 text-xs" value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">Любой приоритет</option>
          <option value="1">Высокий</option>
          <option value="2">Средний</option>
          <option value="3">Низкий</option>
        </Select>
        <Select className="w-auto py-2 text-xs" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="due">Сортировка: по сроку</option>
          <option value="priority">по приоритету</option>
          <option value="created">по дате создания</option>
        </Select>
      </div>

      {/* Список */}
      {groups.length === 0 && !tasksQuery.isLoading && (
        <EmptyState
          icon={<CheckSquare size={36} />}
          title="Задач нет"
          body="Создайте первую задачу — она синхронизируется между всеми устройствами"
          action={<Button onClick={() => setEditTask("new")} size="sm"><Plus size={14} /> Создать</Button>}
        />
      )}
      {groups.map((g) => (
        <div key={g.label || "all"} className="space-y-1.5">
          {g.label && <p className={cn("text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500", "accent" in g && g.accent)}>{g.label} · {g.rows.length}</p>}
          {g.rows.map((t) => (
            <div
              key={t.id}
              className={cn(
                "glass group flex items-center gap-3 rounded-xl px-3.5 py-2.5",
                t.status === "completed" && "opacity-55",
                t.status === "cancelled" && "opacity-45",
              )}
            >
              <button
                onClick={() => t.status !== "cancelled" && complete.mutate(t.id)}
                className="shrink-0 text-slate-600 transition hover:text-emerald-300"
                disabled={t.status === "cancelled"}
                title={t.status === "completed" ? "Вернуть в активные" : "Завершить"}
              >
                {t.status === "completed" ? <Check size={18} className="text-emerald-400" /> : <Circle size={18} />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("text-sm font-medium text-slate-100", (t.status === "completed" || t.status === "cancelled") && "line-through decoration-slate-500")}>
                    {t.title}
                  </span>
                  {t.recurrence && <Repeat size={12} className="text-indigo-400" />}
                  {t.priority === 1 && <Badge color="red">важно</Badge>}
                  {(t.tags ?? []).slice(0, 3).map((tag) => (
                    <Badge key={tag} color="slate">#{tag}</Badge>
                  ))}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                  {t.dueAt && (
                    <span className="num">
                      {fmtDate(t.dueAt)} · {fmtTime(t.dueAt)}
                    </span>
                  )}
                  {sectionName(t.sectionId) && <span>· {sectionName(t.sectionId)}</span>}
                  {t.cancelReason && <span className="text-amber-400/80">· причина: {t.cancelReason}</span>}
                </div>
              </div>
              <div className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                <button onClick={() => setEditTask(t)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-700/40 hover:text-cyan-300" title="Редактировать"><Pencil size={14} /></button>
                <button onClick={() => setDupTask(t)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-700/40 hover:text-indigo-300" title="Копировать на даты"><Copy size={14} /></button>
                {t.status === "active" && (
                  <button onClick={() => setCancelTask(t)} className="rounded-md p-1.5 text-slate-500 hover:bg-amber-500/20 hover:text-amber-300" title="Отменить с причиной"><Ban size={14} /></button>
                )}
                <button onClick={() => setDeleteTask(t)} className="rounded-md p-1.5 text-slate-500 hover:bg-rose-500/20 hover:text-rose-300" title="Удалить с причиной"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      ))}

      {editTask && <TaskDialog task={editTask === "new" ? null : editTask} onClose={() => setEditTask(null)} />}
      {dupTask && <DuplicateDialog task={dupTask} onClose={() => setDupTask(null)} />}
      <ReasonDialog
        open={!!cancelTask}
        onClose={() => setCancelTask(null)}
        title={`Отменить задачу «${cancelTask?.title}»?`}
        submitLabel="Отменить задачу"
        onSubmit={(reason) => cancelTask && reasonAction.mutate({ id: cancelTask.id, reason, mode: "cancel" })}
      />
      <ReasonDialog
        open={!!deleteTask}
        onClose={() => setDeleteTask(null)}
        title={`Удалить задачу «${deleteTask?.title}»?`}
        submitLabel="Удалить навсегда"
        danger
        onSubmit={(reason) => deleteTask && reasonAction.mutate({ id: deleteTask.id, reason, mode: "delete" })}
      />

      {/* Массовый импорт */}
       <div className="glass mt-6 rounded-2xl p-5">
         <div className="mb-4">
           <h3 className="font-display text-lg font-semibold text-slate-50">Массовый импорт из CSV</h3>
          <p className="text-xs text-slate-500">Загрузите файл — задачи и события создадутся автоматически</p>
        </div>
        <ImportCsvWidget />
      </div>
    </div>
  );
}

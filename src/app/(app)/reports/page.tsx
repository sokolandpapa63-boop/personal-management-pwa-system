"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FileText, Plus, Trash2 } from "lucide-react";
import { api, apiUrl } from "@/lib/client/api";
import { toast } from "@/lib/client/stores";
import { fmtDateFull, fmtDateTime, useReports } from "@/lib/client/hooks";
import { Badge, Button, cn, Dialog, EmptyState, Spinner } from "@/components/ui";
import { ReportDialog } from "@/components/report-dialog";

const TYPE_META: Record<string, { label: string; color: string }> = {
  daily: { label: "Ежедневный", color: "cyan" },
  weekly: { label: "Еженедельный", color: "violet" },
  monthly: { label: "Ежемесячный", color: "amber" },
  manual: { label: "Вручную", color: "green" },
};

const FILTERS: [string, string][] = [
  ["all", "Все"],
  ["daily", "Ежедневные"],
  ["weekly", "Еженедельные"],
  ["monthly", "Ежемесячные"],
  ["manual", "Ручные"],
];

export default function ReportsPage() {
  const queryClient = useQueryClient();
  const [type, setType] = useState("all");
  const [generateOpen, setGenerateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const reportsQuery = useReports(type);

  const remove = useMutation({
    mutationFn: (id: string) => api(`/reports/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      toast.success("Отчёт удалён");
      setDeleteId(null);
    },
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-50">Отчёты системы</h1>
          <p className="text-xs text-slate-500">автоматические (21:00 / вс 09:00 / 1-е 09:00) и ручные</p>
        </div>
        <Button onClick={() => setGenerateOpen(true)}><Plus size={15} /> Сформировать отчёт</Button>
      </div>

      <div className="flex rounded-xl border border-slate-800 bg-slate-900/50 p-1 sm:w-auto">
        {FILTERS.map(([v, l]) => (
          <button
            key={v}
            onClick={() => setType(v)}
            className={cn(
              "flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition sm:flex-none",
              type === v ? "bg-cyan-500/20 text-cyan-200" : "text-slate-500 hover:text-slate-300",
            )}
          >
            {l}
          </button>
        ))}
      </div>

      {reportsQuery.isLoading && <Spinner label="Загрузка отчётов…" />}
      {!reportsQuery.isLoading && !(reportsQuery.data ?? []).length && (
        <EmptyState
          icon={<FileText size={36} />}
          title="Отчётов пока нет"
          body="Сформируйте отчёт вручную или дождитесь автоматического по расписанию"
          action={<Button size="sm" onClick={() => setGenerateOpen(true)}>Сформировать</Button>}
        />
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(reportsQuery.data ?? []).map((r) => {
          const meta = TYPE_META[r.type] ?? TYPE_META.manual;
          return (
            <div key={r.id} className="glass widget rounded-2xl p-4">
              <div className="flex items-start justify-between gap-2">
                <Badge color={meta.color}>{meta.label}</Badge>
                <span className="num text-[11px] text-slate-600">{r.fileSize ? `${Math.max(1, Math.round(r.fileSize / 1024))} КБ` : ""}</span>
              </div>
              <p className="mt-3 text-sm font-semibold text-slate-100">
                {fmtDateFull(r.periodFrom)} — {fmtDateFull(r.periodTo)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                создан {fmtDateTime(r.createdAt)}
                {r.summary?.tasksCompleted !== undefined && ` · задач: ${r.summary.tasksCompleted}`}
                {r.summary?.pomodoroSessions !== undefined && ` · pomodoro: ${r.summary.pomodoroSessions}`}
              </p>
              <div className="mt-4 flex gap-2">
                <a
                  href={apiUrl(`/reports/${r.id}/file`)}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-outline btn-sm flex-1"
                >
                  <ExternalLink size={13} /> Открыть / PDF
                </a>
                <Button variant="ghost" size="icon" onClick={() => setDeleteId(r.id)} title="Удалить">
                  <Trash2 size={14} className="text-slate-500" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <ReportDialog open={generateOpen} onClose={() => setGenerateOpen(false)} />
      <Dialog open={!!deleteId} onClose={() => setDeleteId(null)} title="Удалить отчёт?">
        <p className="text-sm text-slate-400">Файл отчёта будет удалён без возможности восстановления.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleteId(null)}>Отмена</Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => deleteId && remove.mutate(deleteId)}>Удалить</Button>
        </div>
      </Dialog>
    </div>
  );
}

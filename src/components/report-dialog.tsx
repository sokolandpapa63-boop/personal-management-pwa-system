"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, apiUrl } from "@/lib/client/api";
import { toast } from "@/lib/client/stores";
import { addDaysKey, todayKey, useSections } from "@/lib/client/hooks";
import { Button, Dialog, Field, Input } from "@/components/ui";

export function ReportDialog({
  open,
  onClose,
  presetSections,
}: {
  open: boolean;
  onClose: () => void;
  presetSections?: string[];
}) {
  const queryClient = useQueryClient();
  const sections = useSections().data ?? [];
  const [from, setFrom] = useState(addDaysKey(todayKey(), -6));
  const [to, setTo] = useState(todayKey());
  const [selected, setSelected] = useState<string[]>(presetSections ?? []);
  const [loading, setLoading] = useState(false);

  const tables = sections.filter((s) => s.kind === "table" && !(presetSections ?? []).includes(s.id));

  const toggle = (id: string) =>
    setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));

  async function generate() {
    setLoading(true);
    try {
      const res = await api<{ report: { id: string } }>("/reports/generate", {
        method: "POST",
        body: {
          type: "manual",
          from: `${from}T00:00:00+03:00`,
          to: `${to}T23:59:59+03:00`,
          sections: [...(presetSections ?? []), ...selected],
        },
      });
      toast.success("Отчёт сформирован", "Открываю документ…");
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      window.open(apiUrl(`/reports/${res.report.id}/file`), "_blank");
      onClose();
    } catch (e) {
      toast.error("Не удалось сформировать отчёт", e instanceof Error ? e.message : undefined);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Сформировать отчёт">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Период с">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} max={to} />
          </Field>
          <Field label="по">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} min={from} />
          </Field>
        </div>
        {tables.length > 0 && (
          <Field label="Дополнительные разделы в отчёт">
            <div className="mt-1 flex flex-wrap gap-1.5">
              {tables.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggle(s.id)}
                  className={
                    selected.includes(s.id)
                      ? "rounded-full border border-cyan-400/50 bg-cyan-500/15 px-3 py-1 text-xs text-cyan-200"
                      : "rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-400 transition hover:border-slate-500"
                  }
                >
                  {s.name}
                </button>
              ))}
            </div>
          </Field>
        )}
        <p className="text-xs text-slate-500">
          В отчёт войдут: сводка задач и Pomodoro, спорт, образование, финансы и выбранные разделы.
          Документ откроется в новой вкладке — сохраните его как PDF через печать.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button onClick={generate} loading={loading}>Сформировать</Button>
        </div>
      </div>
    </Dialog>
  );
}

"use client";

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Save } from "lucide-react";
import { api } from "@/lib/client/api";
import { toast } from "@/lib/client/stores";
import { useSettings } from "@/lib/client/hooks";
import { Button, Input, cn } from "@/components/ui";

const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const DAYS_INDEX = ["1", "2", "3", "4", "5", "6", "0"]; // Пн=1 ... Вс=0

export function HyperfocusSettings() {
  const qc = useQueryClient();
  const { data: settings } = useSettings();

  const [plan, setPlan] = useState<Record<string, string[]>>({});
  const [activeDay, setActiveDay] = useState("1");
  const [hydrated, setHydrated] = useState(false);

  // Инициализируем локальный стейт ОДИН раз, когда пришли данные.
  // Повторные рефетчи useSettings() не затирают несохранённые правки.
  useEffect(() => {
    if (hydrated) return;
    if (settings?.hyperfocusPlan) {
      setPlan(settings.hyperfocusPlan);
      setHydrated(true);
    }
  }, [settings, hydrated]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api("/me/settings", { method: "PATCH", body: { hyperfocusPlan: plan } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success("План гиперфокуса сохранен");
    },
    onError: (e) =>
      toast.error(
        "Не удалось сохранить настройки",
        e instanceof Error ? e.message : undefined,
      ),
  });

  const currentTasks = plan[activeDay] || [];

  const addTask = () => {
    setPlan((p) => ({ ...p, [activeDay]: [...(p[activeDay] || []), ""] }));
  };

  const updateTask = (idx: number, val: string) => {
    const next = [...currentTasks];
    next[idx] = val;
    setPlan((p) => ({ ...p, [activeDay]: next }));
  };

  const removeTask = (idx: number) => {
    const next = currentTasks.filter((_, i) => i !== idx);
    setPlan((p) => ({ ...p, [activeDay]: next }));
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-1 overflow-x-auto pb-1">
        {DAYS.map((label, i) => {
          const dayIndex = DAYS_INDEX[i];
          return (
            <button
              key={label}
              onClick={() => setActiveDay(dayIndex)}
              className={cn(
                "flex-1 rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wide transition",
                activeDay === dayIndex
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                  : "bg-slate-900/50 text-slate-500 hover:bg-slate-800",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="glass rounded-xl p-4 space-y-3">
        {currentTasks.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-2">
            На этот день ничего не задано
          </p>
        ) : (
          currentTasks.map((task, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Input
                value={task}
                onChange={(e) => updateTask(idx, e.target.value)}
                placeholder="Например: Работа с БК"
                className="bg-black/30"
              />
              <button
                onClick={() => removeTask(idx)}
                className="p-2 text-slate-500 hover:text-rose-400 transition"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))
        )}

        <div className="flex justify-between items-center pt-2">
          <Button variant="ghost" size="sm" onClick={addTask}>
            <Plus size={14} className="mr-1" /> Добавить надпись
          </Button>

          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            <Save size={14} className="mr-1" />{" "}
            {saveMutation.isPending ? "Сохранение..." : "Сохранить"}
          </Button>
        </div>
      </div>
    </div>
  );
}
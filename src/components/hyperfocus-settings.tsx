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

/** Палитра приглушённых цветов в духе дизайн-системы проекта. */
const COLORS: { key: string; label: string; dot: string; ring: string }[] = [
  { key: "cyan",    label: "Cyan",    dot: "#22d3ee", ring: "ring-cyan-400/60" },
  { key: "indigo",  label: "Indigo",  dot: "#818cf8", ring: "ring-indigo-400/60" },
  { key: "emerald", label: "Emerald", dot: "#34d399", ring: "ring-emerald-400/60" },
  { key: "amber",   label: "Amber",   dot: "#f59e0b", ring: "ring-amber-400/60" },
  { key: "rose",    label: "Rose",    dot: "#fb7185", ring: "ring-rose-400/60" },
  { key: "violet",  label: "Violet",  dot: "#a78bfa", ring: "ring-violet-400/60" },
  { key: "slate",   label: "Slate",   dot: "#94a3b8", ring: "ring-slate-400/60" },
];

type Item = { text: string; color?: string };

/** Приводим сохранённый формат (строки или объекты) к единому виду. */
function normalize(raw: Record<string, unknown> | undefined): Record<string, Item[]> {
  const out: Record<string, Item[]> = {};
  if (!raw) return out;
  for (const [day, list] of Object.entries(raw)) {
    if (!/^[0-6]$/.test(day) || !Array.isArray(list)) continue;
    out[day] = list
      .map((x): Item | null => {
        if (typeof x === "string") return x.trim() ? { text: x } : null;
        if (x && typeof x === "object") {
          const o = x as Record<string, unknown>;
          const text = typeof o.text === "string" ? o.text : "";
          const color = typeof o.color === "string" ? o.color : undefined;
          return text.trim() ? { text, color } : null;
        }
        return null;
      })
      .filter((x): x is Item => x !== null);
  }
  return out;
}

export function HyperfocusSettings() {
  const qc = useQueryClient();
  const { data: settings } = useSettings();

  const [plan, setPlan] = useState<Record<string, Item[]>>({});
  const [activeDay, setActiveDay] = useState("1");
  const [hydrated, setHydrated] = useState(false);

  // Инициализация один раз — повторные рефетчи не затирают правки.
  useEffect(() => {
    if (hydrated) return;
    if (settings?.hyperfocusPlan) {
      setPlan(normalize(settings.hyperfocusPlan as unknown as Record<string, unknown>));
      setHydrated(true);
    }
  }, [settings, hydrated]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api("/me/settings", { method: "PATCH", body: { hyperfocusPlan: plan } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success("План гиперфокуса сохранён");
    },
    onError: (e) =>
      toast.error("Не удалось сохранить настройки", e instanceof Error ? e.message : undefined),
  });

  const currentTasks = plan[activeDay] || [];

  const addTask = () => {
    setPlan((p) => ({ ...p, [activeDay]: [...(p[activeDay] || []), { text: "" }] }));
  };

  const updateText = (idx: number, text: string) => {
    const next = [...currentTasks];
    next[idx] = { ...next[idx], text };
    setPlan((p) => ({ ...p, [activeDay]: next }));
  };

  const updateColor = (idx: number, color: string | undefined) => {
    const next = [...currentTasks];
    next[idx] = { ...next[idx], color };
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
            <div key={idx} className="rounded-lg border border-slate-800/60 bg-slate-950/40 p-2.5">
              <div className="flex items-center gap-2">
                <Input
                  value={task.text}
                  onChange={(e) => updateText(idx, e.target.value)}
                  placeholder="Например: Работа с БК"
                  className="bg-black/30"
                />
                <button
                  onClick={() => removeTask(idx)}
                  className="p-2 text-slate-500 hover:text-rose-400 transition"
                  title="Удалить"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-slate-600 mr-1">Цвет</span>
                <button
                  type="button"
                  onClick={() => updateColor(idx, undefined)}
                  className={cn(
                    "h-5 w-5 rounded-full border border-slate-700 text-[10px] leading-4 text-slate-500 transition",
                    !task.color && "ring-2 ring-cyan-400/60 border-cyan-400/40 text-cyan-300",
                  )}
                  title="Без цвета"
                >
                  ∅
                </button>
                {COLORS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => updateColor(idx, c.key)}
                    className={cn(
                      "h-5 w-5 rounded-full transition-transform hover:scale-110",
                      task.color === c.key && `ring-2 ${c.ring}`,
                    )}
                    style={{
                      background: c.dot,
                      boxShadow: task.color === c.key ? `0 0 10px ${c.dot}99` : undefined,
                    }}
                    title={c.label}
                  />
                ))}
              </div>
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
            <Save size={14} className="mr-1" />
            {saveMutation.isPending ? "Сохранение..." : "Сохранить"}
          </Button>
        </div>
      </div>
    </div>
  );
}
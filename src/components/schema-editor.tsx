"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { toast } from "@/lib/client/stores";
import type { Column, ColumnType, Section } from "@/lib/client/hooks";
import { Button, cn, Dialog, Input, Select } from "@/components/ui";

const TYPES: { value: ColumnType; label: string }[] = [
  { value: "text", label: "Текст" },
  { value: "textarea", label: "Многострочный текст" },
  { value: "number", label: "Число" },
  { value: "money", label: "Деньги" },
  { value: "date", label: "Дата" },
  { value: "datetime", label: "Дата и время" },
  { value: "select", label: "Выбор из списка" },
  { value: "multiselect", label: "Мультивыбор" },
  { value: "checkbox", label: "Флаг (да/нет)" },
  { value: "formula", label: "Формула" },
];

type Draft = Column & { optionsText?: string };

export function SchemaEditor({
  section,
  initialColumns,
  onClose,
}: {
  section: Section;
  initialColumns: Column[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [cols, setCols] = useState<Draft[]>(
    initialColumns.map((c) => ({ ...c, optionsText: (c.options ?? []).join(", ") })),
  );
  const [saving, setSaving] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const update = (idx: number, patch: Partial<Draft>) =>
    setCols((arr) => arr.map((c, i) => (i === idx ? { ...c, ...patch } : c)));

  const remove = (idx: number) => setCols((arr) => arr.filter((_, i) => i !== idx));

  const add = () =>
    setCols((arr) => [
      ...arr,
      {
        key: `field${arr.length + 1}_${Date.now().toString(36).slice(-4)}`,
        name: "Новая колонка",
        type: "text",
        required: false,
        showInReport: false,
        order: arr.length + 1,
      },
    ]);

  const onDrop = (idx: number) => {
    if (dragIdx === null || dragIdx === idx) return;
    setCols((arr) => {
      const next = [...arr];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(idx, 0, moved);
      return next;
    });
    setDragIdx(null);
    setOverIdx(null);
  };

  async function save() {
    setSaving(true);
    try {
      const payload = cols.map((c, i) => ({
        key: c.key,
        name: c.name,
        type: c.type,
        required: !!c.required,
        options: ["select", "multiselect"].includes(c.type)
          ? (c.optionsText ?? "").split(",").map((s) => s.trim()).filter(Boolean)
          : undefined,
        formula: c.type === "formula" ? c.formula ?? "" : undefined,
        currency: c.type === "money" ? c.currency ?? "deposit" : undefined,
        showInReport: !!c.showInReport,
        order: i + 1,
      }));
      await api(`/sections/${section.id}/schema`, { method: "PUT", body: { columns: payload } });
      await queryClient.invalidateQueries({ queryKey: ["schema", section.id] });
      toast.success("Схема таблицы сохранена");
      onClose();
    } catch (e) {
      toast.error("Ошибка сохранения схемы", e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={`Схема таблицы · ${section.name}`} wide>
      <p className="mb-4 text-xs text-slate-500">
        Перетаскивайте строки за ⋮⋮ для изменения порядка колонок. Флаг «В отчёт» включает колонку в PDF-отчёты.
      </p>
      <div className="space-y-2">
        {cols.map((col, idx) => (
          <div
            key={`${col.key}-${idx}`}
            draggable
            onDragStart={() => setDragIdx(idx)}
            onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
            onDragOver={(e) => { e.preventDefault(); setOverIdx(idx); }}
            onDrop={(e) => { e.preventDefault(); onDrop(idx); }}
            className={cn(
              "rounded-xl border border-slate-800 bg-slate-900/50 p-3 transition",
              dragIdx === idx && "opacity-40",
              overIdx === idx && dragIdx !== idx && "border-cyan-500/50",
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <GripVertical size={15} className="cursor-grab text-slate-600" />
              <Input className="w-40" value={col.name} onChange={(e) => update(idx, { name: e.target.value })} placeholder="Название" />
              <Input
                className="w-32 font-mono text-xs"
                value={col.key}
                onChange={(e) => update(idx, { key: e.target.value.replace(/[^a-zA-Z0-9_]/g, "") })}
                placeholder="key"
              />
              <Select className="w-44" value={col.type} onChange={(e) => update(idx, { type: e.target.value as ColumnType })}>
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </Select>
              <label className="flex items-center gap-1.5 text-xs text-slate-400">
                <input type="checkbox" checked={!!col.required} onChange={(e) => update(idx, { required: e.target.checked })} className="accent-cyan-400" />
                Обязательное
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-400">
                <input type="checkbox" checked={!!col.showInReport} onChange={(e) => update(idx, { showInReport: e.target.checked })} className="accent-cyan-400" />
                В отчёт
              </label>
              <div className="flex-1" />
              <button onClick={() => remove(idx)} className="rounded-md p-1.5 text-slate-500 transition hover:bg-rose-500/20 hover:text-rose-300">
                <Trash2 size={14} />
              </button>
            </div>
            {["select", "multiselect"].includes(col.type) && (
              <Input
                className="mt-2"
                value={col.optionsText ?? ""}
                onChange={(e) => update(idx, { optionsText: e.target.value })}
                placeholder="Варианты через запятую: Один, Два, Три"
              />
            )}
            {col.type === "formula" && (
              <Input
                className="mt-2 font-mono text-xs"
                value={col.formula ?? ""}
                onChange={(e) => update(idx, { formula: e.target.value })}
                placeholder="например: approaches * reps * weight или amount * rateToBase"
              />
            )}
            {col.type === "money" && (
              <Select className="mt-2 w-56" value={col.currency ?? "deposit"} onChange={(e) => update(idx, { currency: e.target.value })}>
                <option value="deposit">Валюта депозита раздела</option>
                <option value="">Просто число</option>
              </Select>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={add}><Plus size={14} /> Колонка</Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button onClick={save} loading={saving}>Сохранить схему</Button>
        </div>
      </div>
    </Dialog>
  );
}

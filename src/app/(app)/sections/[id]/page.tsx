"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Pencil, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { toast } from "@/lib/client/stores";
import { useSections, type Section } from "@/lib/client/hooks";
import { Button, Dialog, Field, Input, Select, Spinner, EmptyState } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { StudySessionWidget } from "@/components/widgets";
import { BudgetLayout } from "@/components/budget-layout";

const COLORS = ["#22d3ee", "#a78bfa", "#34d399", "#f59e0b", "#fb7185", "#60a5fa", "#e2e8f0"];
const ICONS = ["dumbbell", "graduation-cap", "wallet", "landmark", "briefcase", "sparkles", "file-text", "sliders-horizontal"];

function SectionSettingsDialog({ section, onClose }: { section: Section; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(section.name);
  const [icon, setIcon] = useState(section.icon ?? "");
  const [color, setColor] = useState(section.color ?? COLORS[0]);
  const [loading, setLoading] = useState(false);

  async function save() {
    setLoading(true);
    try {
      await api(`/sections/${section.id}`, { method: "PATCH", body: { name: name.trim() || section.name, icon: icon || null, color } });
      await queryClient.invalidateQueries({ queryKey: ["sections"] });
      toast.success("Раздел обновлён");
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="Настройки раздела">
      <div className="space-y-4">
        <Field label="Название">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Иконка">
          <Select value={icon} onChange={(e) => setIcon(e.target.value)}>
            <option value="">— без иконки —</option>
            {ICONS.map((i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </Select>
        </Field>
        <Field label="Цвет">
          <div className="flex gap-2 pt-1">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className="h-8 w-8 rounded-full transition-transform hover:scale-110"
                style={{ background: c, boxShadow: color === c ? `0 0 0 2px #0f172a, 0 0 0 4px ${c}` : undefined }}
              />
            ))}
          </div>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button onClick={save} loading={loading}>Сохранить</Button>
        </div>
      </div>
    </Dialog>
  );
}

export default function SectionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const sectionsQuery = useSections();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const sections = useMemo(() => sectionsQuery.data ?? [], [sectionsQuery.data]);
  const section = sections.find((s) => s.id === params.id);
  const children = sections.filter((s) => s.parentId === section?.id).sort((a, b) => a.order - b.order);

  if (sectionsQuery.isLoading) return <Spinner label="Загрузка раздела…" />;
  if (!section) {
    return <EmptyState title="Раздел не найден" body="Возможно, он был удалён" action={<Link href="/" className="btn btn-outline btn-sm">На дашборд</Link>} />;
  }

  const remove = async () => {
    setDeleting(true);
    try {
      await api(`/sections/${section.id}`, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: ["sections"] });
      toast.success("Раздел удалён");
      router.replace("/");
    } finally {
      setDeleting(false);
    }
  };

  // ── Бюджет: дашборд с вкладками ──────────────────────────────────────────
  if (section.slug === "budget") {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className="h-9 w-1.5 rounded-full"
            style={{
              background: section.color ?? "#34d399",
              boxShadow: `0 0 16px ${section.color ?? "#34d399"}66`,
            }}
          />
          <div className="flex-1">
            <h1 className="font-display text-xl font-semibold text-slate-50">{section.name}</h1>
            <p className="text-xs text-slate-500">финансовый обзор · бюджет · кредиты</p>
          </div>
        </div>
        <BudgetLayout section={section} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="h-9 w-1.5 rounded-full" style={{ background: section.color ?? "#22d3ee", boxShadow: `0 0 16px ${section.color ?? "#22d3ee"}66` }} />
        <div className="flex-1">
          <h1 className="font-display text-xl font-semibold text-slate-50">{section.name}</h1>
          <p className="text-xs text-slate-500">
            {section.kind === "table" ? "таблица данных" : "контейнер"}
            {section.depositCurrency ? ` · депозит ${section.depositCurrency}` : ""}
            {section.isSystem ? " · системный" : ""}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}><Pencil size={13} /> Настроить</Button>
        {!section.isSystem && (
          <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}><Trash2 size={13} /> Удалить</Button>
        )}
      </div>

      {section.slug === "education" && (
        <div className="glass rounded-2xl p-5 lg:max-w-md">
          <StudySessionWidget />
        </div>
      )}

      {section.kind === "container" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {children.map((child) => (
            <Link
              key={child.id}
              href={`/sections/${child.id}`}
              className="widget glass group rounded-2xl p-5"
            >
              <div className="flex items-center justify-between">
                <span className="h-8 w-1.5 rounded-full" style={{ background: child.color ?? "#22d3ee" }} />
                <ArrowRight size={16} className="text-slate-600 transition group-hover:translate-x-1 group-hover:text-cyan-300" />
              </div>
              <p className="mt-4 text-base font-semibold text-slate-100">{child.name}</p>
              <p className="mt-1 text-xs text-slate-500">
                {child.kind === "container" ? "контейнер" : "таблица"}
                {child.depositCurrency ? ` · ${child.depositCurrency}` : ""}
              </p>
            </Link>
          ))}
          {!children.length && (
            <EmptyState title="В контейнере пусто" body="Создайте подраздел через «Новый раздел» в боковом меню" />
          )}
        </div>
      ) : (
        <DataTable section={section} />
      )}

      {settingsOpen && <SectionSettingsDialog section={section} onClose={() => setSettingsOpen(false)} />}
      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title={`Удалить раздел «${section.name}»?`}>
        <p className="text-sm text-slate-400">Будут удалены все записи, схема и подразделы. Действие необратимо.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleteOpen(false)}>Отмена</Button>
          <Button variant="danger" loading={deleting} onClick={remove}>Удалить безвозвратно</Button>
        </div>
      </Dialog>
    </div>
  );
}
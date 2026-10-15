"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown, ArrowUp, Check, Download, FileText, Pencil, Plus, Search, Settings2, Trash2, Upload, X,
} from "lucide-react";
import { api, apiUrl } from "@/lib/client/api";
import { toast } from "@/lib/client/stores";
import {
  fmtDate, fmtMoney, todayKey, useRates, useSettings, type Column, type RecordRow, type Section,
} from "@/lib/client/hooks";
import { Badge, Button, cn, Dialog, Field, Input, Select, Textarea } from "@/components/ui";
import { SchemaEditor } from "./schema-editor";
import { ReportDialog } from "./report-dialog";

const PAGE_SIZE = 15;

function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Клиентская оценка формулы для живого превью. */
function evalFormulaClient(expr: string, vars: Record<string, number>): number | null {
  if (!expr || !/^[0-9a-zA-Z_+\-*/().\s]+$/.test(expr)) return null;
  try {
    const keys = Object.keys(vars).filter((k) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k));
    const fn = new Function(...keys, `"use strict"; return (${expr});`);
    const out = fn(...keys.map((k) => Number(vars[k]) || 0));
    return typeof out === "number" && Number.isFinite(out) ? Math.round(out * 100) / 100 : null;
  } catch {
    return null;
  }
}

// ── Диалог записи ───────────────────────────────────────────────────────────
function RecordDialog({
  section,
  columns,
  record,
  onClose,
}: {
  section: Section;
  columns: Column[];
  record: RecordRow | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const rates = useRates().data?.rates;
  const settings = useSettings().data;
  const base = settings?.baseCurrency ?? "USD";
  const deposit = section.depositCurrency ?? "USD";

  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const col of columns) {
      const existing = record?.data?.[col.key];
      if (existing !== undefined && existing !== null) initial[col.key] = existing;
      else if (col.type === "date") initial[col.key] = todayKey();
      else if (col.type === "checkbox") initial[col.key] = false;
      else initial[col.key] = "";
    }
    return initial;
  });
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      record
        ? api(`/records/${record.id}`, { method: "PATCH", body: { data } })
        : api(`/sections/${section.id}/records`, { method: "POST", body: { data } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["records", section.id] });
      queryClient.invalidateQueries({ queryKey: ["stats", section.id] });
      toast.success(record ? "Запись обновлена" : "Запись добавлена");
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Ошибка сохранения"),
  });

  const numericVars: Record<string, number> = {};
  for (const [k, v] of Object.entries(values)) {
    const n = parseNum(v);
    if (n !== null) numericVars[k] = n;
  }
  const rateToBase = rates ? (rates[base] ?? 1) / (rates[deposit] ?? 1) : null;

  const set = (key: string, v: unknown) => setValues((s) => ({ ...s, [key]: v }));

  return (
    <Dialog open onClose={onClose} title={record ? "Редактировать запись" : `Новая запись · ${section.name}`} wide>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {columns
          .filter((c) => c.type !== "formula")
          .map((col) => {
            const v = values[col.key];
            if (col.type === "textarea" || col.type === "text") {
              return (
                <Field key={col.key} label={col.name + (col.required ? " *" : "")}>
                  {col.type === "textarea" ? (
                    <Textarea value={String(v ?? "")} onChange={(e) => set(col.key, e.target.value)} />
                  ) : (
                    <Input value={String(v ?? "")} onChange={(e) => set(col.key, e.target.value)} />
                  )}
                </Field>
              );
            }
            if (col.type === "number" || col.type === "money") {
              const n = parseNum(v);
              const showEq = col.type === "money" && col.currency === "deposit" && n !== null && rateToBase !== null;
              return (
                <Field
                  key={col.key}
                  label={`${col.name}${col.required ? " *" : ""}${col.type === "money" ? ` (${deposit})` : ""}`}
                  hint={showEq ? `≈ ${fmtMoney(n! * rateToBase!, base)}` : undefined}
                >
                  <Input
                    inputMode="decimal"
                    value={String(v ?? "")}
                    onChange={(e) => set(col.key, e.target.value)}
                    placeholder="0"
                  />
                </Field>
              );
            }
            if (col.type === "date") {
              return (
                <Field key={col.key} label={col.name + (col.required ? " *" : "")}>
                  <Input type="date" value={String(v ?? "")} onChange={(e) => set(col.key, e.target.value)} />
                </Field>
              );
            }
            if (col.type === "datetime") {
              return (
                <Field key={col.key} label={col.name + (col.required ? " *" : "")}>
                  <Input type="datetime-local" value={String(v ?? "")} onChange={(e) => set(col.key, e.target.value)} />
                </Field>
              );
            }
            if (col.type === "select") {
              return (
                <Field key={col.key} label={col.name + (col.required ? " *" : "")}>
                  <Select value={String(v ?? "")} onChange={(e) => set(col.key, e.target.value)}>
                    <option value="">— выбрать —</option>
                    {(col.options ?? []).map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                    {String(v ?? "") && !(col.options ?? []).includes(String(v)) && (
                      <option value={String(v)}>{String(v)}</option>
                    )}
                  </Select>
                </Field>
              );
            }
            if (col.type === "multiselect") {
              const arr = Array.isArray(v) ? (v as string[]) : [];
              return (
                <Field key={col.key} label={col.name + (col.required ? " *" : "")}>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {(col.options ?? []).map((o) => (
                      <button
                        key={o}
                        type="button"
                        onClick={() => set(col.key, arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o])}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-xs transition",
                          arr.includes(o)
                            ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-200"
                            : "border-slate-700 text-slate-400 hover:border-slate-500",
                        )}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                </Field>
              );
            }
            if (col.type === "checkbox") {
              return (
                <Field key={col.key} label={col.name}>
                  <button
                    type="button"
                    onClick={() => set(col.key, !v)}
                    className={cn(
                      "flex h-9 items-center gap-2 rounded-lg border px-3 text-sm transition",
                      v ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300" : "border-slate-700 text-slate-400",
                    )}
                  >
                    {v ? <Check size={15} /> : <X size={15} />}
                    {v ? "Да" : "Нет"}
                  </button>
                </Field>
              );
            }
            return null;
          })}

        {columns
          .filter((c) => c.type === "formula")
          .map((col) => {
            const preview = col.formula
              ? evalFormulaClient(col.formula, { ...numericVars, rateToBase: rateToBase ?? 1 })
              : null;
            return (
              <Field key={col.key} label={`${col.name} (авто)`}>
                <div className="field flex items-center justify-between bg-slate-900/40 text-slate-400">
                  <span className="num">{preview !== null ? new Intl.NumberFormat("ru-RU").format(preview) : record?.data?.[col.key] != null ? String(record.data[col.key]) : "—"}</span>
                  <span className="text-[10px] uppercase tracking-wider text-slate-600">{col.formula}</span>
                </div>
              </Field>
            );
          })}
      </div>

      {error && <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>}

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Отмена</Button>
        <Button loading={mutation.isPending} onClick={() => mutation.mutate(values)}>
          {record ? "Сохранить" : "Добавить"}
        </Button>
      </div>
    </Dialog>
  );
}

// ── Основная таблица ────────────────────────────────────────────────────────
export function DataTable({ section }: { section: Section }) {
  const queryClient = useQueryClient();
  const settings = useSettings().data;
  const base = settings?.baseCurrency ?? "USD";
  const fileRef = useRef<HTMLInputElement>(null);

  const schemaQuery = useQuery({
    queryKey: ["schema", section.id],
    queryFn: () => api<{ columns: Column[] }>(`/sections/${section.id}/schema`).then((r) => r.columns),
  });
  const recordsQuery = useQuery({
    queryKey: ["records", section.id],
    queryFn: () => api<{ records: RecordRow[] }>(`/sections/${section.id}/records`).then((r) => r.records),
  });

  const columns = useMemo(
    () => [...(schemaQuery.data ?? [])].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)),
    [schemaQuery.data],
  );
  const records = useMemo(() => recordsQuery.data ?? [], [recordsQuery.data]);

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [dialog, setDialog] = useState<RecordRow | "new" | null>(null);
  const [deleteRow, setDeleteRow] = useState<RecordRow | null>(null);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const selectCols = columns.filter((c) => c.type === "select" && (c.options?.length ?? 0) > 0);

  const filtered = useMemo(() => {
    let rows = records;
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) =>
        Object.values(r.data).some((v) => String(v ?? "").toLowerCase().includes(q)),
      );
    }
    for (const [key, val] of Object.entries(filters)) {
      if (!val) continue;
      rows = rows.filter((r) => String(r.data[key] ?? "") === val);
    }
    if (sort) {
      rows = [...rows].sort((a, b) => {
        const av = a.data[sort.key];
        const bv = b.data[sort.key];
        const an = typeof av === "number" ? av : parseNum(av);
        const bn = typeof bv === "number" ? bv : parseNum(bv);
        if (an !== null && bn !== null) return (an - bn) * sort.dir;
        return String(av ?? "").localeCompare(String(bv ?? ""), "ru") * sort.dir;
      });
    }
    return rows;
  }, [records, search, sort, filters]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const totals = useMemo(() => {
    const out: Record<string, number> = {};
    for (const col of columns) {
      if (["number", "money", "formula"].includes(col.type)) {
        out[col.key] = filtered.reduce((s, r) => s + (parseNum(r.data[col.key]) ?? 0), 0);
      }
    }
    return out;
  }, [columns, filtered]);

  const deposit = section.depositCurrency ?? "USD";
  const hasDepositMoney = columns.some((c) => c.type === "money" && c.currency === "deposit");
  const baseTotal = filtered.reduce((s, r) => s + (r.amountBase !== null ? Number(r.amountBase) : 0), 0);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/records/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["records", section.id] });
      toast.success("Запись удалена");
      setDeleteRow(null);
    },
  });

  const importCsv = async (file: File) => {
    setImporting(true);
    try {
      const csv = await file.text();
      const res = await api<{ imported: number; errors: string[] }>(`/sections/${section.id}/records/import.csv`, {
        method: "POST",
        body: { csv },
      });
      queryClient.invalidateQueries({ queryKey: ["records", section.id] });
      if (res.errors.length) toast.error(`Импортировано ${res.imported}, ошибок: ${res.errors.length}`, res.errors[0]);
      else toast.success(`Импортировано записей: ${res.imported}`);
    } catch (e) {
      toast.error("Ошибка импорта", e instanceof Error ? e.message : undefined);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const renderCell = (col: Column, row: RecordRow) => {
    const v = row.data[col.key];
    if (v === null || v === undefined || v === "") return <span className="text-slate-700">—</span>;
    switch (col.type) {
      case "money":
        return (
          <span className="num font-medium text-slate-100">
            {fmtMoney(parseNum(v), col.currency === "deposit" ? deposit : col.currency)}
          </span>
        );
      case "number":
      case "formula":
        return <span className="num">{new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Number(v) || 0)}</span>;
      case "date":
        return <span className="num text-slate-300">{fmtDate(String(v))}</span>;
      case "checkbox":
        return v ? <Check size={15} className="text-emerald-400" /> : <X size={15} className="text-slate-600" />;
      case "multiselect":
        return (
          <span className="flex flex-wrap gap-1">
            {(Array.isArray(v) ? v : [v]).map((x) => (
              <Badge key={String(x)} color="cyan">{String(x)}</Badge>
            ))}
          </span>
        );
      case "select": {
        const color = String(v) === "Доход" ? "green" : String(v) === "Расход" ? "red" : String(v) === "Провалено" ? "red" : String(v) === "Сдано" || String(v) === "Выполнено" ? "green" : "violet";
        return <Badge color={color}>{String(v)}</Badge>;
      }
      case "textarea":
        return <span className="block max-w-[220px] truncate text-slate-400" title={String(v)}>{String(v)}</span>;
      default:
        return <span>{String(v)}</span>;
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <Input className="pl-8" placeholder="Поиск по записям…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
        </div>
        {selectCols.slice(0, 2).map((col) => (
          <Select
            key={col.key}
            className="w-auto py-2 text-xs"
            value={filters[col.key] ?? ""}
            onChange={(e) => { setFilters((f) => ({ ...f, [col.key]: e.target.value })); setPage(0); }}
          >
            <option value="">{col.name}: все</option>
            {[...new Set(records.map((r) => String(r.data[col.key] ?? "")).filter(Boolean))].map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </Select>
        ))}
        <div className="flex-1" />
        <Button size="sm" onClick={() => setDialog("new")}><Plus size={14} /> Запись</Button>
        <Button size="sm" variant="outline" onClick={() => setSchemaOpen(true)}><Settings2 size={14} /> Схема</Button>
        <Button size="sm" variant="outline" onClick={() => setReportOpen(true)}><FileText size={14} /> Отчёт</Button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
        <Button size="sm" variant="ghost" loading={importing} onClick={() => fileRef.current?.click()} title="Импорт CSV"><Upload size={14} /></Button>
        <a href={apiUrl(`/sections/${section.id}/records/export.csv`)} className="btn btn-ghost btn-sm" title="Экспорт CSV">
          <Download size={14} />
        </a>
      </div>

      {/* Deposit currency */}
      {hasDepositMoney && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-2">
            валюта депозита:
            <Select
              className="w-auto px-2 py-1 text-xs"
              value={deposit}
              onChange={async (e) => {
                await api(`/sections/${section.id}`, { method: "PATCH", body: { depositCurrency: e.target.value } });
                queryClient.invalidateQueries({ queryKey: ["sections"] });
              }}
            >
              {["USD", "USDT", "RUB", "EUR", "KZT"].map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </span>
          <span>
            итого в базовой ({base}): <b className="num text-emerald-300">{fmtMoney(baseTotal, base)}</b>
          </span>
        </div>
      )}

      {/* Table */}
      <div className="glass overflow-x-auto rounded-2xl">
        <table className="data-table w-full">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => setSort((s) => (s?.key === col.key ? { key: col.key, dir: s.dir === 1 ? -1 : 1 } : { key: col.key, dir: 1 }))}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.name}
                    {sort?.key === col.key && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                  </span>
                </th>
              ))}
              <th className="w-20" />
            </tr>
          </thead>
          <tbody>
            {!recordsQuery.isLoading && pageRows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="py-12 text-center text-slate-500">
                  Записей пока нет — добавьте первую
                </td>
              </tr>
            )}
            {pageRows.map((row) => (
              <tr key={row.id}>
                {columns.map((col) => (
                  <td key={col.key}>{renderCell(col, row)}</td>
                ))}
                <td>
                  <div className="flex justify-end gap-1">
                    <button onClick={() => setDialog(row)} className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-700/40 hover:text-cyan-300">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => setDeleteRow(row)} className="rounded-md p-1.5 text-slate-500 transition hover:bg-rose-500/20 hover:text-rose-300">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          {filtered.length > 0 && Object.keys(totals).length > 0 && (
            <tfoot>
              <tr className="border-t border-slate-700/60 bg-slate-900/50">
                {columns.map((col) => (
                  <td key={col.key} className="num font-semibold text-slate-200">
                    {totals[col.key] !== undefined
                      ? col.type === "money"
                        ? fmtMoney(totals[col.key], col.currency === "deposit" ? deposit : col.currency)
                        : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(totals[col.key])
                      : ""}
                  </td>
                ))}
                <td className="text-right text-[11px] uppercase tracking-wider text-slate-500">Σ</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{filtered.length} записей · страница {page + 1} из {pageCount}</span>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>←</Button>
            <Button size="sm" variant="outline" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>→</Button>
          </div>
        </div>
      )}

      {/* Dialogs */}
      {dialog && (
        <RecordDialog
          section={section}
          columns={columns}
          record={dialog === "new" ? null : dialog}
          onClose={() => setDialog(null)}
        />
      )}
      <Dialog open={!!deleteRow} onClose={() => setDeleteRow(null)} title="Удалить запись?">
        <p className="text-sm text-slate-400">Действие необратимо. Запись будет удалена без возможности восстановления.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleteRow(null)}>Отмена</Button>
          <Button variant="danger" loading={deleteMutation.isPending} onClick={() => deleteRow && deleteMutation.mutate(deleteRow.id)}>Удалить</Button>
        </div>
      </Dialog>
      {schemaOpen && <SchemaEditor section={section} initialColumns={columns} onClose={() => setSchemaOpen(false)} />}
      <ReportDialog open={reportOpen} onClose={() => setReportOpen(false)} presetSections={[section.id]} />
    </div>
  );
}

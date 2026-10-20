"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Eye, EyeOff, GripVertical, Maximize2, RefreshCw, TrendingDown, TrendingUp, Wallet,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useFinanceSummary, type CreditPayment } from "@/lib/client/hooks";
import { fmtDate, fmtMoney } from "@/lib/client/hooks";
import { cn, Spinner } from "@/components/ui";
import { ReportDialog } from "@/components/report-dialog";

type WidgetId = "pnl" | "plan" | "flow" | "upcoming";

const WIDGETS: { id: WidgetId; name: string; span: string }[] = [
  { id: "pnl", name: "PnL за месяц", span: "lg:col-span-6" },
  { id: "flow", name: "Доходы и расходы", span: "lg:col-span-6" },
  { id: "plan", name: "План бюджета", span: "lg:col-span-7" },
  { id: "upcoming", name: "Ближайшие погашения", span: "lg:col-span-5" },
];

const DEFAULT_SIZES: Record<WidgetId, string> = {
  pnl: "lg:col-span-6",
  flow: "lg:col-span-6",
  plan: "lg:col-span-7",
  upcoming: "lg:col-span-5",
};

const SIZE_OPTIONS: { label: string; cls: string }[] = [
  { label: "1/4 ширины", cls: "lg:col-span-3" },
  { label: "1/3 ширины", cls: "lg:col-span-4" },
  { label: "1/2 ширины", cls: "lg:col-span-6" },
  { label: "2/3 ширины", cls: "lg:col-span-8" },
  { label: "На всю ширину", cls: "lg:col-span-12 md:col-span-2" },
];

const LS_KEY = "budget-dashboard-v1";

type Prefs = { order: WidgetId[]; hidden: WidgetId[]; sizes: Record<string, string> };

function loadPrefs(): Prefs {
  if (typeof window === "undefined") {
    return { order: WIDGETS.map((w) => w.id), hidden: [], sizes: DEFAULT_SIZES };
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Prefs;
      const order = [
        ...p.order.filter((id) => WIDGETS.some((w) => w.id === id)),
        ...WIDGETS.filter((w) => !p.order.includes(w.id)).map((w) => w.id),
      ];
      return { order, hidden: p.hidden ?? [], sizes: { ...DEFAULT_SIZES, ...(p.sizes ?? {}) } };
    }
  } catch {
    /* noop */
  }
  return { order: WIDGETS.map((w) => w.id), hidden: [], sizes: DEFAULT_SIZES };
}

export function BudgetDashboard({ section }: { section: { id: string } }) {
  const queryClient = useQueryClient();
  const summaryQuery = useFinanceSummary();
  const [prefs, setPrefs] = useState<Prefs>({ order: WIDGETS.map((w) => w.id), hidden: [], sizes: DEFAULT_SIZES });
  const [dragId, setDragId] = useState<WidgetId | null>(null);
  const [overId, setOverId] = useState<WidgetId | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [sizeMenu, setSizeMenu] = useState<WidgetId | null>(null);

  useEffect(() => setPrefs(loadPrefs()), []);
  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(prefs));
  }, [prefs]);

  const onDrop = (targetId: WidgetId) => {
    if (!dragId || dragId === targetId) return;
    setPrefs((p) => {
      const order = [...p.order];
      const from = order.indexOf(dragId);
      const to = order.indexOf(targetId);
      order.splice(from, 1);
      order.splice(to, 0, dragId);
      return { ...p, order };
    });
  };

  const toggleHidden = (id: WidgetId) =>
    setPrefs((p) => ({
      ...p,
      hidden: p.hidden.includes(id) ? p.hidden.filter((x) => x !== id) : [...p.hidden, id],
    }));

  const setSize = (id: WidgetId, sizeClass: string) =>
    setPrefs((p) => ({ ...p, sizes: { ...p.sizes, [id]: sizeClass } }));

  const summary = summaryQuery.data;

  // ── Виджеты ──────────────────────────────────────────────────────────────
  const widgets: Record<WidgetId, React.ReactNode> = useMemo(() => {
    const base = summary?.baseCurrency ?? "USD";
    const pnl = summary?.pnl ?? { income: 0, expense: 0, net: 0 };
    const plan = summary?.plan ?? [];
    const upcoming = summary?.upcomingPayments ?? [];
    const maxPlan = Math.max(...plan.map((p) => p.amount), 1);

    return {
      pnl: (
        <div className="flex h-full flex-col">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">PnL за месяц</p>
            <span className="text-[10px] uppercase tracking-wider text-slate-600">{base}</span>
          </div>
          <div className="grid flex-1 grid-cols-2 gap-3">
            <div className="flex flex-col justify-center rounded-xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 to-transparent p-4">
              <p className="text-[10px] uppercase tracking-wider text-emerald-300/80">Прибыль</p>
              <p className="num mt-1 text-2xl font-semibold text-emerald-200">
                +{fmtMoney(pnl.income, base)}
              </p>
            </div>
            <div className="flex flex-col justify-center rounded-xl border border-rose-500/25 bg-gradient-to-br from-rose-500/10 to-transparent p-4">
              <p className="text-[10px] uppercase tracking-wider text-rose-300/80">Убыток</p>
              <p className="num mt-1 text-2xl font-semibold text-rose-200">
                −{fmtMoney(pnl.expense, base)}
              </p>
            </div>
            <div className="col-span-2 rounded-xl border border-slate-700/60 bg-slate-900/60 p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Итог за месяц</p>
              <p className={cn("num mt-0.5 text-xl font-semibold", pnl.net >= 0 ? "text-emerald-300" : "text-rose-300")}>
                {pnl.net >= 0 ? "+" : "−"}
                {fmtMoney(Math.abs(pnl.net), base)}
              </p>
            </div>
          </div>
        </div>
      ),
      flow: (
        <div className="flex h-full flex-col">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Доходы и расходы · {base}</p>
          <div className="flex flex-1 flex-col justify-center gap-3">
            <div>
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-emerald-300">
                  <TrendingUp size={13} /> Доходы
                </span>
                <span className="num text-sm font-semibold text-emerald-200">+{fmtMoney(pnl.income, base)}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-emerald-400/80 transition-all duration-500"
                  style={{
                    width: `${
                      pnl.income + pnl.expense > 0 ? (pnl.income / (pnl.income + pnl.expense)) * 100 : 0
                    }%`,
                  }}
                />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-rose-300">
                  <TrendingDown size={13} /> Расходы
                </span>
                <span className="num text-sm font-semibold text-rose-200">−{fmtMoney(pnl.expense, base)}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-rose-400/80 transition-all duration-500"
                  style={{
                    width: `${
                      pnl.income + pnl.expense > 0 ? (pnl.expense / (pnl.income + pnl.expense)) * 100 : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      ),
      plan: (
        <div className="flex h-full flex-col">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">План бюджета на месяц</p>
          {plan.length === 0 ? (
            <p className="flex flex-1 items-center justify-center text-sm text-slate-500">
              Расходов за месяц нет
            </p>
          ) : (
            <div className="flex-1 space-y-2">
              {plan.slice(0, 6).map((p) => (
                <div key={p.category} className="flex items-center gap-2">
                  <span className="w-28 truncate text-xs text-slate-400">{p.category}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-400/80 to-indigo-400/80"
                      style={{ width: `${(p.amount / maxPlan) * 100}%` }}
                    />
                  </div>
                  <span className="num w-20 text-right text-xs text-slate-200">{fmtMoney(p.amount, base)}</span>
                </div>
              ))}
              {plan.length > 6 && (
                <p className="pt-1 text-[11px] text-slate-600">ещё {plan.length - 6} категорий…</p>
              )}
            </div>
          )}
        </div>
      ),
      upcoming: (
        <div className="flex h-full flex-col">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Ближайшие погашения</p>
            <span className="text-[10px] uppercase tracking-wider text-slate-600">до 5</span>
          </div>
          {upcoming.length === 0 ? (
            <p className="flex flex-1 items-center justify-center text-center text-sm text-slate-500">
              Нет предстоящих погашений
            </p>
          ) : (
            <div className="flex-1 space-y-2">
              {upcoming.map((p: CreditPayment) => {
                const overdue = new Date(p.dueAt) < new Date();
                return (
                  <div
                    key={p.id}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg border p-2",
                      overdue
                        ? "border-rose-500/30 bg-rose-500/5"
                        : "border-slate-700/60 bg-slate-900/60",
                    )}
                  >
                    {p.logoUrl ? (
                      <img src={p.logoUrl} alt={p.bank} className="h-7 w-7 rounded object-contain" />
                    ) : (
                      <span className="flex h-7 w-7 items-center justify-center rounded bg-slate-700 text-[10px] font-bold text-slate-200">
                        {p.bank.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-slate-200">{p.bank}</p>
                      <p className="text-[10px] text-slate-500">{fmtDate(p.dueAt)}</p>
                    </div>
                    <span className={cn("num text-xs font-semibold", overdue ? "text-rose-300" : "text-slate-100")}>
                      {fmtMoney(Number(p.amount), p.currency)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ),
    };
  }, [summary]);

  if (summaryQuery.isLoading) {
    return (
      <div className="glass rounded-2xl">
        <Spinner label="Загрузка финансов…" />
      </div>
    );
  }

  if (summaryQuery.isError) {
    return (
      <div className="glass rounded-2xl p-5 text-sm text-rose-300">
        Не удалось загрузить данные. Попробуйте обновить страницу.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Wallet size={16} className="text-emerald-400" />
          <p className="text-sm font-medium text-slate-200">Финансовый обзор</p>
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ["finance-summary"] })}
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-800/60 hover:text-cyan-300"
            title="Обновить"
          >
            <RefreshCw size={13} className={cn(summaryQuery.isFetching && "animate-spin")} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setReportOpen(true)} className="btn btn-outline btn-sm">
            Сформировать отчёт
          </button>
          <div className="relative">
            <button onClick={() => setConfigOpen((v) => !v)} className="btn btn-ghost btn-sm">
              Виджеты
            </button>
            {configOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setConfigOpen(false)} />
                <div className="glass-strong absolute right-0 z-40 mt-2 w-64 rounded-xl p-2">
                  <p className="px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    Показывать виджеты
                  </p>
                  {prefs.order.map((id) => {
                    const w = WIDGETS.find((x) => x.id === id)!;
                    const hidden = prefs.hidden.includes(id);
                    return (
                      <button key={id} onClick={() => toggleHidden(id)} className="nav-item w-full justify-between">
                        <span>{w.name}</span>
                        {hidden ? <EyeOff size={14} className="text-slate-600" /> : <Eye size={14} className="text-cyan-400" />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Сетка виджетов */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-flow-dense lg:grid-cols-12">
        {prefs.order.map((id, idx) => {
          const w = WIDGETS.find((x) => x.id === id)!;
          if (prefs.hidden.includes(id)) return null;
          const sizeClass = prefs.sizes[id] || DEFAULT_SIZES[id] || w.span;
          const isSizeMenuOpen = sizeMenu === id;

          return (
            <div
              key={id}
              style={{ order: idx }}
              draggable
              onDragStart={(e) => {
                setDragId(id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOverId(id);
              }}
              onDragLeave={() => setOverId((v) => (v === id ? null : v))}
              onDrop={(e) => {
                e.preventDefault();
                onDrop(id);
                setDragId(null);
                setOverId(null);
              }}
              className={cn(
                "widget glass group relative rounded-2xl p-5 md:col-span-1 transition-all duration-300",
                sizeClass,
                dragId === id && "dragging",
                overId === id && dragId !== id && "drag-over",
              )}
            >
              <div className="absolute right-3 top-3 z-10 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSizeMenu(isSizeMenuOpen ? null : id);
                    }}
                    className="cursor-pointer rounded-md p-1.5 text-slate-500 hover:bg-slate-700/50 hover:text-cyan-300"
                    title="Размер виджета"
                  >
                    <Maximize2 size={14} />
                  </button>
                  {isSizeMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setSizeMenu(null)} />
                      <div className="glass-strong absolute right-0 top-8 z-30 w-40 rounded-lg p-1">
                        {SIZE_OPTIONS.map((opt) => (
                          <button
                            key={opt.cls}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSize(id, opt.cls);
                              setSizeMenu(null);
                            }}
                            className={cn(
                              "block w-full rounded px-2 py-1.5 text-left text-xs transition",
                              sizeClass === opt.cls
                                ? "bg-cyan-500/20 text-cyan-200"
                                : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200",
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <div className="cursor-grab text-slate-700">
                  <GripVertical size={15} />
                </div>
              </div>
              {widgets[id]}
            </div>
          );
        })}
      </div>

      <ReportDialog open={reportOpen} onClose={() => setReportOpen(false)} presetSections={[section.id]} />
    </div>
  );
}
"use client";

import { useMemo, useState } from "react";
import { Download, TrendingDown, TrendingUp } from "lucide-react";
import { apiUrl } from "@/lib/client/api";
import { fmtMoney, useFinanceSummary, type Section } from "@/lib/client/hooks";
import { DataTable } from "@/components/data-table";
import { cn } from "@/components/ui";

/**
 * Вкладка «Доходы / Расходы» в бюджете.
 * Сверху — сводка по текущему месяцу (PnL), ниже — DataTable раздела «Бюджет».
 */
export function BudgetIncomeExpenseTable({ section }: { section: Section }) {
  const summaryQuery = useFinanceSummary();
  const summary = summaryQuery.data;
  const base = summary?.baseCurrency ?? "USD";
  const pnl = summary?.pnl ?? { income: 0, expense: 0, net: 0 };

  return (
    <div className="space-y-4">
      {/* Сводка месяца */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="glass rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 to-transparent p-4">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300/80">
            <TrendingUp size={12} /> Доходы
          </p>
          <p className="num mt-1 text-2xl font-semibold text-emerald-200">
            +{fmtMoney(pnl.income, base)}
          </p>
        </div>
        <div className="glass rounded-2xl border border-rose-500/25 bg-gradient-to-br from-rose-500/10 to-transparent p-4">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-rose-300/80">
            <TrendingDown size={12} /> Расходы
          </p>
          <p className="num mt-1 text-2xl font-semibold text-rose-200">
            −{fmtMoney(pnl.expense, base)}
          </p>
        </div>
        <div className="glass rounded-2xl border border-slate-700/60 bg-slate-900/60 p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">PnL за месяц</p>
          <p
            className={cn(
              "num mt-1 text-2xl font-semibold",
              pnl.net >= 0 ? "text-emerald-300" : "text-rose-300",
            )}
          >
            {pnl.net >= 0 ? "+" : "−"}
            {fmtMoney(Math.abs(pnl.net), base)}
          </p>
        </div>
      </div>

      {/* Экспорт CSV */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Записи раздела «Бюджет» · {base}
        </p>
        <a
          href={apiUrl(`/sections/${section.id}/records/export.csv`)}
          className="btn btn-outline btn-sm"
          title="Экспорт CSV"
        >
          <Download size={14} /> Экспорт
        </a>
      </div>

      {/* Таблица записей */}
      <DataTable section={section} />
    </div>
  );
}
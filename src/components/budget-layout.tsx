"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LayoutDashboard, TrendingUp, CreditCard } from "lucide-react";
import { cn, Spinner } from "@/components/ui";
import type { Section } from "@/lib/client/hooks";
import { BudgetDashboard } from "./budget-dashboard";
import { BudgetIncomeExpenseTable } from "./budget-income-expense-table";
import { BudgetCreditsSettings } from "./budget-credits-settings";

const TABS = [
  { id: "dashboard", label: "Дашборд", icon: LayoutDashboard },
  { id: "income", label: "Доходы / Расходы", icon: TrendingUp },
  { id: "credits", label: "Кредиты", icon: CreditCard },
] as const;

type TabId = (typeof TABS)[number]["id"];

function BudgetTabs({ section }: { section: Section }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const raw = searchParams.get("tab");
  const active: TabId = (TABS.find((t) => t.id === raw)?.id ?? "dashboard") as TabId;

  const setTab = (id: TabId) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", id);
    router.replace(`/sections/${section.id}?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/50 p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = active === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition",
                isActive
                  ? "bg-cyan-500/20 text-cyan-200 shadow-[0_0_18px_-6px_rgba(34,211,238,0.6)]"
                  : "text-slate-500 hover:bg-slate-800/60 hover:text-slate-300",
              )}
            >
              <Icon size={14} />
              <span className="whitespace-nowrap">{t.label}</span>
            </button>
          );
        })}
      </div>

      {active === "dashboard" && <BudgetDashboard section={section} />}
      {active === "income" && <BudgetIncomeExpenseTable section={section} />}
      {active === "credits" && <BudgetCreditsSettings section={section} />}
    </div>
  );
}

export function BudgetLayout({ section }: { section: Section }) {
  return (
    <Suspense fallback={<div className="glass rounded-2xl"><Spinner label="Загрузка вкладок…" /></div>}>
      <BudgetTabs section={section} />
    </Suspense>
  );
}
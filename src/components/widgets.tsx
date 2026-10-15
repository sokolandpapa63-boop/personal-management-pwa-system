"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, ResponsiveContainer } from "recharts";
import {
  ArrowRight, CalendarDays, CheckCircle2, Circle, Clock, FileText, GraduationCap, RefreshCw, TrendingDown, TrendingUp,
} from "lucide-react";
import { api } from "@/lib/client/api";
import { toast } from "@/lib/client/stores";
import {
  addDaysKey, countdownParts, dateKey, fmtMoney, fmtTime, todayKey, useNow,
  useEvents, useRates, useSections, useSettings, useStudySession, useTasks, TZ,
} from "@/lib/client/hooks";
import { Badge, Button, cn } from "@/components/ui";

function WidgetHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{title}</p>
      {action}
    </div>
  );
}

// ── Задачи на сегодня ───────────────────────────────────────────────────────
export function TasksTodayWidget() {
  const queryClient = useQueryClient();
  const tasks = useTasks().data ?? [];
  const today = todayKey();
  const todays = tasks
    .filter((t) => t.status === "active" && t.dueAt && dateKey(t.dueAt) <= today)
    .sort((a, b) => (a.dueAt! < b.dueAt! ? -1 : 1));

  const complete = useMutation({
    mutationFn: (id: string) => api(`/tasks/${id}/complete`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks"] }),
    onError: (e) => toast.error("Ошибка", e instanceof Error ? e.message : undefined),
  });

  return (
    <div className="flex h-full flex-col">
      <WidgetHeader
        title="Задачи на сегодня"
        action={
          <Link href="/tasks" className="flex items-center gap-1 text-xs text-cyan-300/80 transition hover:text-cyan-200">
            все <ArrowRight size={12} />
          </Link>
        }
      />
      <div className="flex-1 space-y-1 overflow-y-auto">
        {!todays.length && <p className="py-6 text-center text-sm text-slate-500">На сегодня задач нет ✦</p>}
        {todays.slice(0, 7).map((t) => {
          const overdue = dateKey(t.dueAt!) < today;
          return (
            <button
              key={t.id}
              onClick={() => complete.mutate(t.id)}
              className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-slate-800/40"
            >
              {complete.isPending && complete.variables === t.id ? (
                <Circle size={17} className="shrink-0 animate-pulse text-cyan-400" />
              ) : (
                <Circle size={17} className="shrink-0 text-slate-600 transition group-hover:text-cyan-300" />
              )}
              <span className="flex-1 truncate text-sm text-slate-200">{t.title}</span>
              {overdue ? <Badge color="red">просрочена</Badge> : t.dueAt && <span className="num text-xs text-slate-500">{fmtTime(t.dueAt)}</span>}
            </button>
          );
        })}
        {todays.length > 7 && <p className="px-2 pt-1 text-xs text-slate-500">ещё {todays.length - 7}…</p>}
      </div>
    </div>
  );
}

// ── Ближайшие события ───────────────────────────────────────────────────────
export function UpcomingEventsWidget() {
  const from = new Date().toISOString();
  const to = `${addDaysKey(todayKey(), 7)}T23:59:59+03:00`;
  const events = useEvents(from, to).data ?? [];
  const tasks = useTasks({ status: "active", from, to }).data ?? [];

  const items = useMemo(() => {
    const list = [
      ...events.map((e) => ({ id: e.id, kind: "event" as const, title: e.title, at: e.startAt })),
      ...tasks.filter((t) => t.dueAt).map((t) => ({ id: t.id, kind: "task" as const, title: t.title, at: t.dueAt! })),
    ];
    return list.sort((a, b) => (a.at < b.at ? -1 : 1)).slice(0, 8);
  }, [events, tasks]);

  const dayLabel = (iso: string) => {
    const key = dateKey(iso);
    if (key === todayKey()) return "Сегодня";
    if (key === addDaysKey(todayKey(), 1)) return "Завтра";
    return new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, day: "numeric", month: "short", weekday: "short" }).format(new Date(iso));
  };

  return (
    <div className="flex h-full flex-col">
      <WidgetHeader
        title="Ближайшие события · 7 дней"
        action={
          <Link href="/planner" className="flex items-center gap-1 text-xs text-cyan-300/80 transition hover:text-cyan-200">
            планер <ArrowRight size={12} />
          </Link>
        }
      />
      <div className="flex-1 space-y-1 overflow-y-auto">
        {!items.length && <p className="py-6 text-center text-sm text-slate-500">Неделя свободна</p>}
        {items.map((item) => (
          <div key={`${item.kind}-${item.id}`} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-slate-800/40">
            <span className={cn("h-8 w-1 rounded-full", item.kind === "event" ? "bg-emerald-400/70" : "bg-indigo-400/70")} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-slate-200">{item.title}</p>
              <p className="text-[11px] text-slate-500">{dayLabel(item.at)} · {fmtTime(item.at)}</p>
            </div>
            {item.kind === "event" ? <CalendarDays size={14} className="text-emerald-400/60" /> : <CheckCircle2 size={14} className="text-indigo-400/60" />}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Статистика разделов (неделя) ────────────────────────────────────────────
export function StatsWidget() {
  const sections = useSections().data ?? [];
  const from = addDaysKey(todayKey(), -6);
  const to = todayKey();

  const targets = useMemo(() => {
    const sport = sections.find((s) => s.slug === "sport");
    const education = sections.find((s) => s.slug === "education");
    const finance = sections.find((s) => s.slug === "finance");
    const financeKids = finance ? sections.filter((s) => s.parentId === finance.id) : [];
    return { sport, education, financeKids: financeKids.slice(0, 4) };
  }, [sections]);

  const queries = useQueries({
    queries: [
      ...(targets.sport ? [targets.sport] : []),
      ...(targets.education ? [targets.education] : []),
      ...targets.financeKids,
    ].map((sec) => ({
      queryKey: ["stats", sec.id, from, to],
      queryFn: () =>
        api<{ days: { date: string; count: number; volume?: number }[]; finance: { income: number; expense: number } }>(
          `/sections/${sec.id}/stats?from=${from}&to=${to}`,
        ),
      staleTime: 60_000,
    })),
  });

  const sportStats = targets.sport ? queries[0]?.data : undefined;
  const eduStats = targets.education ? queries[targets.sport ? 1 : 0]?.data : undefined;
  const financeStats = queries.slice((targets.sport ? 1 : 0) + (targets.education ? 1 : 0)).map((q) => q.data);

  const financeIncome = financeStats.reduce((s, f) => s + (f?.finance.income ?? 0), 0);
  const financeExpense = financeStats.reduce((s, f) => s + (f?.finance.expense ?? 0), 0);

  const toChart = (stats?: { days: { date: string; count: number; volume?: number }[] }, key: "count" | "volume" = "count") =>
    (stats?.days ?? []).map((d) => ({ name: d.date.slice(5), value: key === "volume" ? d.volume ?? 0 : d.count }));

  return (
    <div className="flex h-full flex-col">
      <WidgetHeader title="Статистика разделов · 7 дней" />
      <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-xs text-slate-400"><TrendingUp size={13} className="text-cyan-400" /> Спорт · объём</p>
          <ResponsiveContainer width="100%" height={80}>
            <BarChart data={toChart(sportStats, "volume")}>
              <Bar dataKey="value" radius={[4, 4, 0, 0]} fill="#22d3ee" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-xs text-slate-400"><GraduationCap size={13} className="text-violet-400" /> Образование · записи</p>
          <ResponsiveContainer width="100%" height={80}>
            <BarChart data={toChart(eduStats, "count")}>
              <Bar dataKey="value" radius={[4, 4, 0, 0]} fill="#a78bfa" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-xs text-slate-400"><TrendingDown size={13} className="text-emerald-400" /> Финансы · поток</p>
          <div className="flex h-[80px] flex-col justify-center gap-2">
            <div>
              <div className="flex justify-between text-[11px] text-slate-500"><span>Доход</span><span className="num text-emerald-300">{fmtMoney(financeIncome)}</span></div>
              <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-emerald-400/80 transition-all duration-500" style={{ width: `${financeIncome + financeExpense ? (financeIncome / (financeIncome + financeExpense)) * 100 : 0}%` }} /></div>
            </div>
            <div>
              <div className="flex justify-between text-[11px] text-slate-500"><span>Расход</span><span className="num text-rose-300">{fmtMoney(financeExpense)}</span></div>
              <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-rose-400/80 transition-all duration-500" style={{ width: `${financeIncome + financeExpense ? (financeExpense / (financeIncome + financeExpense)) * 100 : 0}%` }} /></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Отсчёт учебной сессии ───────────────────────────────────────────────────
export function StudySessionWidget() {
  const session = useStudySession().data;
  const now = useNow(1000);

  if (!session) {
    return (
      <div className="flex h-full flex-col">
        <WidgetHeader title="Учебная сессия" />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <GraduationCap size={28} className="text-slate-600" />
          <p className="text-sm text-slate-400">Сессия не настроена</p>
          <Link href="/settings" className="text-xs text-cyan-300/80 transition hover:text-cyan-200">Указать даты →</Link>
        </div>
      </div>
    );
  }

  const startsAt = new Date(session.startsAt).getTime();
  const endsAt = new Date(session.endsAt).getTime();
  const status = now < startsAt ? "not_started" : now > endsAt ? "finished" : "active";
  const target = status === "not_started" ? startsAt : endsAt;
  const parts = countdownParts(now, target);

  const cells = [
    { v: parts.months, l: "мес" },
    { v: parts.days, l: "дн" },
    { v: parts.hours, l: "ч" },
    { v: parts.minutes, l: "мин" },
    { v: parts.seconds, l: "сек" },
  ];

  return (
    <div className="flex h-full flex-col">
      <WidgetHeader
        title="Учебная сессия"
        action={
          <Badge color={status === "active" ? "green" : status === "not_started" ? "amber" : "slate"}>
            {status === "active" ? "идёт" : status === "not_started" ? "не началась" : "закончилась"}
          </Badge>
        }
      />
      <p className="text-sm font-semibold text-slate-200">
        {session.course} курс · {session.sessionType === "winter" ? "зимняя" : "летняя"} сессия
      </p>
      {status !== "finished" ? (
        <>
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500">
            <Clock size={11} /> {status === "active" ? "до конца" : "до начала"}
          </p>
          <div className="mt-3 grid flex-1 grid-cols-5 content-center gap-1.5">
            {cells.map((c) => (
              <div key={c.l} className="rounded-xl bg-slate-900/70 py-2.5 text-center ring-1 ring-slate-800">
                <p className="font-display num text-lg font-semibold text-cyan-200">{c.v}</p>
                <p className="text-[9px] uppercase tracking-wider text-slate-500">{c.l}</p>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-slate-400">Сессия завершена — обновите даты в настройках</p>
        </div>
      )}
    </div>
  );
}

// ── Курсы валют ─────────────────────────────────────────────────────────────
export function CurrencyWidget() {
  const queryClient = useQueryClient();
  const settings = useSettings().data;
  const ratesQuery = useRates();
  const [refreshing, setRefreshing] = useState(false);
  const base = settings?.baseCurrency ?? "USD";
  const rates = ratesQuery.data?.rates;

  const codes = ["USD", "RUB", "EUR", "USDT", "KZT", "GEL"].filter((c) => c !== base);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await api("/currencies/rates?force=1");
      await queryClient.invalidateQueries({ queryKey: ["rates"] });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <WidgetHeader
        title={`Валюты · базовая ${base}`}
        action={
          <button onClick={refresh} className="text-slate-500 transition hover:text-cyan-300" title="Обновить курсы">
            <RefreshCw size={13} className={cn(refreshing && "animate-spin")} />
          </button>
        }
      />
      <div className="grid flex-1 grid-cols-2 content-start gap-1.5">
        {codes.map((code) => {
          const rate = rates ? rates[code] / (rates[base] ?? 1) : null;
          return (
            <div key={code} className="flex items-baseline justify-between rounded-lg bg-slate-900/60 px-2.5 py-2 ring-1 ring-slate-800/70">
              <span className="text-[11px] font-semibold text-slate-400">{code}</span>
              <span className="num text-sm font-semibold text-slate-100">
                {rate ? new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(rate) : "…"}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] text-slate-600">
        {ratesQuery.data ? `обновлено ${fmtTime(ratesQuery.data.fetchedAt)} · за 1 ${base}` : "загрузка…"}
      </p>
    </div>
  );
}

// ── Кнопка «Сформировать отчёт» ─────────────────────────────────────────────
export function ReportTriggerButton({ onClick }: { onClick: () => void }) {
  return (
    <Button onClick={onClick} variant="outline" size="sm">
      <FileText size={14} />
      Сформировать отчёт
    </Button>
  );
}

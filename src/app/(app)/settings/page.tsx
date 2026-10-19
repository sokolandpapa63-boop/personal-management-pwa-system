"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { toast } from "@/lib/client/stores";
import { useSettings, useStudySession, type Settings } from "@/lib/client/hooks";
import { Button, Card, Field, Input, Select, Switch } from "@/components/ui";
import { useAuthStore } from "@/lib/client/stores";
import { HyperfocusSettings } from "@/components/hyperfocus-settings";

function SettingsBlock<S extends object>({
  title,
  description,
  initial,
  render,
  onSave,
}: {
  title: string;
  description: string;
  initial: S;
  render: (state: S, set: <K extends keyof S>(k: K, v: S[K]) => void) => React.ReactNode;
  onSave: (state: S) => Promise<void>;
}) {
  const [state, setState] = useState(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => setState(initial), [initial]);
  const set = <K extends keyof S>(k: K, v: S[K]) => setState((s) => ({ ...s, [k]: v }));

  return (
    <Card>
      <h2 className="text-sm font-bold text-slate-200">{title}</h2>
      <p className="mb-4 text-xs text-slate-500">{description}</p>
      <div className="space-y-4">{render(state, set)}</div>
      <div className="mt-5 flex justify-end">
        <Button
          size="sm"
          loading={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave(state);
              toast.success("Сохранено", title);
            } catch (e) {
              toast.error("Ошибка сохранения", e instanceof Error ? e.message : undefined);
            } finally {
              setSaving(false);
            }
          }}
        >
          Сохранить
        </Button>
      </div>
    </Card>
  );
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useSettings().data;
  const study = useStudySession().data;
  const user = useAuthStore((s) => s.user);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [pwLoading, setPwLoading] = useState(false);

  if (!settings) return null;
  const s = settings;

  const patchSettings = async (patch: Partial<Settings>) => {
    await api("/me/settings", { method: "PATCH", body: patch });
    await queryClient.invalidateQueries({ queryKey: ["settings"] });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-semibold text-slate-50">Настройки</h1>
        <p className="text-xs text-slate-500">{user?.login} · {user?.email} · Europe/Moscow</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* БЛОК ГИПЕРФОКУСА (Вставлен первым) */}
        <div className="lg:col-span-2">
          <Card>
            <h2 className="text-sm font-bold text-slate-200">Гиперфокус дня</h2>
            <p className="mb-4 text-xs text-slate-500">
              Задайте главные задачи на каждый день недели. Они будут выводиться в виджете на дашборде.
            </p>
            <HyperfocusSettings />
          </Card>
        </div>
        {/* КОНЕЦ БЛОКА ГИПЕРФОКУСА */}

        <SettingsBlock
          title="Валюты"
          description="Базовая валюта — все агрегаты и отчёты приводятся к ней"
          initial={{ baseCurrency: s.baseCurrency, displayCurrency: s.displayCurrency }}
          onSave={patchSettings}
          render={(st, set) => (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Базовая валюта">
                <Select value={st.baseCurrency} onChange={(e) => set("baseCurrency", e.target.value)}>
                  <option value="USD">USD</option>
                  <option value="USDT">USDT</option>
                </Select>
              </Field>
              <Field label="Валюта отображения">
                <Select value={st.displayCurrency} onChange={(e) => set("displayCurrency", e.target.value)}>
                  {["USD", "USDT", "RUB", "EUR"].map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
            </div>
          )}
        />

        <SettingsBlock
          title="Pomodoro"
          description="Классика 25/5, длинный перерыв каждые N циклов"
          initial={{
            pomodoroWork: s.pomodoroWork,
            pomodoroShortBreak: s.pomodoroShortBreak,
            pomodoroLongBreak: s.pomodoroLongBreak,
            pomodoroCycles: s.pomodoroCycles,
          }}
          onSave={patchSettings}
          render={(st, set) => (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Работа, мин"><Input type="number" min={1} max={180} value={st.pomodoroWork} onChange={(e) => set("pomodoroWork", Number(e.target.value))} /></Field>
              <Field label="Короткий"><Input type="number" min={1} max={60} value={st.pomodoroShortBreak} onChange={(e) => set("pomodoroShortBreak", Number(e.target.value))} /></Field>
              <Field label="Длинный"><Input type="number" min={1} max={120} value={st.pomodoroLongBreak} onChange={(e) => set("pomodoroLongBreak", Number(e.target.value))} /></Field>
              <Field label="Циклов"><Input type="number" min={1} max={12} value={st.pomodoroCycles} onChange={(e) => set("pomodoroCycles", Number(e.target.value))} /></Field>
            </div>
          )}
        />

        <SettingsBlock
          title="Автоматические отчёты"
          description="PDF-отчёты формируются по расписанию (Europe/Moscow)"
          initial={{ dailyReportTime: s.dailyReportTime, weeklyReportDay: s.weeklyReportDay, monthlyReportDay: s.monthlyReportDay }}
          onSave={patchSettings}
          render={(st, set) => (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Ежедневный, время"><Input type="time" value={st.dailyReportTime} onChange={(e) => set("dailyReportTime", e.target.value)} /></Field>
              <Field label="Еженедельный, день">
                <Select value={String(st.weeklyReportDay)} onChange={(e) => set("weeklyReportDay", Number(e.target.value))}>
                  {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
                </Select>
              </Field>
              <Field label="Ежемесячный, число"><Input type="number" min={1} max={28} value={st.monthlyReportDay} onChange={(e) => set("monthlyReportDay", Number(e.target.value))} /></Field>
            </div>
          )}
        />

        <SettingsBlock
          title="Уведомления"
          description="Типы событий и время напоминания до срока"
          initial={{
            notifyTask: s.notifyTask,
            notifyEvent: s.notifyEvent,
            notifyPomodoro: s.notifyPomodoro,
            notifyReport: s.notifyReport,
            notifySession: s.notifySession,
            leadTimeMinutes: s.leadTimeMinutes,
          }}
          onSave={patchSettings}
          render={(st, set) => (
            <div className="space-y-3">
              {(
                [
                  ["notifyTask", "Задачи"],
                  ["notifyEvent", "События"],
                  ["notifyPomodoro", "Pomodoro"],
                  ["notifyReport", "Готовность отчёта"],
                  ["notifySession", "Старт / конец сессии"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between text-sm text-slate-300">
                  {label}
                  <Switch checked={st[key]} onChange={(v) => set(key, v)} />
                </div>
              ))}
              <Field label="Напоминать за N минут">
                <Input type="number" min={1} max={180} value={st.leadTimeMinutes} onChange={(e) => set("leadTimeMinutes", Number(e.target.value))} />
              </Field>
            </div>
          )}
        />

        <SettingsBlock
          title="Учебная сессия"
          description="Обратный отсчёт показывается на дашборде и в «Образовании»"
          initial={{
            course: study?.course ?? 1,
            sessionType: (study?.sessionType ?? "winter") as "winter" | "summer",
            startsAt: study ? study.startsAt.slice(0, 10) : "",
            endsAt: study ? study.endsAt.slice(0, 10) : "",
          }}
          render={(st, set) => (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Курс">
                <Select value={String(st.course)} onChange={(e) => set("course", Number(e.target.value))}>
                  {[1, 2, 3, 4, 5, 6].map((c) => <option key={c} value={c}>{c} курс</option>)}
                </Select>
              </Field>
              <Field label="Тип сессии">
                <Select value={st.sessionType} onChange={(e) => set("sessionType", e.target.value as "winter" | "summer")}>
                  <option value="winter">Зимняя</option>
                  <option value="summer">Летняя</option>
                </Select>
              </Field>
              <Field label="Начало"><Input type="date" value={st.startsAt} onChange={(e) => set("startsAt", e.target.value)} /></Field>
              <Field label="Конец"><Input type="date" value={st.endsAt} onChange={(e) => set("endsAt", e.target.value)} /></Field>
            </div>
          )}
          onSave={async (st) => {
            if (!st.startsAt || !st.endsAt) throw new Error("Укажите даты");
            await api("/me/study-session", {
              method: "PUT",
              body: {
                course: st.course,
                sessionType: st.sessionType,
                startsAt: `${st.startsAt}T00:00:00+03:00`,
                endsAt: `${st.endsAt}T23:59:59+03:00`,
              },
            });
            await queryClient.invalidateQueries({ queryKey: ["study"] });
          }}
        />

        <Card>
          <h2 className="text-sm font-bold text-slate-200">Смена пароля</h2>
          <p className="mb-4 text-xs text-slate-500">После смены все сессии будут завершены</p>
          <div className="space-y-3">
            <Field label="Текущий пароль">
              <Input type="password" value={pw.current} onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} />
            </Field>
            <Field label="Новый пароль (мин. 8)">
              <Input type="password" value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} />
            </Field>
          </div>
          <div className="mt-5 flex justify-end">
            <Button
              size="sm"
              variant="outline"
              loading={pwLoading}
              disabled={pw.next.length < 8 || !pw.current}
              onClick={async () => {
                setPwLoading(true);
                try {
                  await api("/me/password", { method: "PATCH", body: pw });
                  toast.success("Пароль изменён", "Войдите заново на других устройствах");
                  setPw({ current: "", next: "" });
                } catch (e) {
                  toast.error("Ошибка", e instanceof Error ? e.message : undefined);
                } finally {
                  setPwLoading(false);
                }
              }}
            >
              Изменить пароль
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
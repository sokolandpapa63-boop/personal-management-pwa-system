"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { toast } from "@/lib/client/stores";
import { fmtDate, fmtMoney, useCreditPayments, type CreditPayment } from "@/lib/client/hooks";
import { Button, Dialog, Field, Input, Select, Textarea, cn } from "@/components/ui";

export function BudgetCreditsSettings({ section }: { section: { id: string } }) {
  void section;
  const queryClient = useQueryClient();
  const { data = [], isLoading } = useCreditPayments();
  const [editing, setEditing] = useState<CreditPayment | "new" | null>(null);
  const [deleting, setDeleting] = useState<CreditPayment | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => api(`/finance/payments/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["credit-payments"] });
      queryClient.invalidateQueries({ queryKey: ["finance-summary"] });
      toast.success("Погашение удалено");
      setDeleting(null);
    },
    onError: (e) => toast.error("Ошибка удаления", e instanceof Error ? e.message : undefined),
  });

  const markPaid = useMutation({
    mutationFn: (id: string) => api(`/finance/payments/${id}/pay`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["credit-payments"] });
      queryClient.invalidateQueries({ queryKey: ["finance-summary"] });
      toast.success("Отмечено оплаченным");
    },
    onError: (e) => toast.error("Ошибка", e instanceof Error ? e.message : undefined),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          {data.length} {data.length === 1 ? "погашение" : "погашений"}
        </p>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus size={14} /> Добавить погашение
        </Button>
      </div>

      <div className="glass overflow-x-auto rounded-2xl">
        <table className="data-table w-full">
          <thead>
            <tr>
              <th>Банк</th>
              <th>Сумма</th>
              <th>Дата платежа</th>
              <th>Статус</th>
              <th className="w-32" />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="py-10 text-center text-slate-500">
                  Загрузка…
                </td>
              </tr>
            )}
            {!isLoading && data.length === 0 && (
              <tr>
                <td colSpan={5} className="py-10 text-center text-slate-500">
                  Погашений пока нет — добавьте первое
                </td>
              </tr>
            )}
            {data.map((p) => {
              const overdue = !p.isPaid && new Date(p.dueAt) < new Date();
              return (
                <tr key={p.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      {p.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.logoUrl} alt={p.bank} className="h-6 w-6 rounded object-contain" />
                      ) : (
                        <span className="flex h-6 w-6 items-center justify-center rounded bg-slate-700 text-[10px] font-bold text-slate-200">
                          {p.bank.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      <span className="text-slate-200">{p.bank}</span>
                    </div>
                  </td>
                  <td className="num">{fmtMoney(Number(p.amount), p.currency)}</td>
                  <td className="num">{fmtDate(p.dueAt)}</td>
                  <td>
                    {p.isPaid ? (
                      <span className="text-emerald-400">оплачено</span>
                    ) : overdue ? (
                      <span className="text-rose-400">просрочено</span>
                    ) : (
                      <span className="text-amber-400">ожидает</span>
                    )}
                  </td>
                  <td>
                    <div className="flex justify-end gap-1">
                      {!p.isPaid && (
                        <button
                          onClick={() => markPaid.mutate(p.id)}
                          className="rounded-md p-1.5 text-slate-500 transition hover:bg-emerald-500/20 hover:text-emerald-300"
                          title="Отметить оплаченным"
                        >
                          <Check size={13} />
                        </button>
                      )}
                      <button
                        onClick={() => setEditing(p)}
                        className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-700/40 hover:text-cyan-300"
                        title="Редактировать"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => setDeleting(p)}
                        className="rounded-md p-1.5 text-slate-500 transition hover:bg-rose-500/20 hover:text-rose-300"
                        title="Удалить"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <CreditPaymentDialog
          payment={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}

      <Dialog open={!!deleting} onClose={() => setDeleting(null)} title="Удалить погашение?">
        <p className="text-sm text-slate-400">
          «{deleting?.bank}» — {fmtMoney(Number(deleting?.amount ?? 0), deleting?.currency)}. Действие необратимо.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleting(null)}>
            Отмена
          </Button>
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() => deleting && remove.mutate(deleting.id)}
          >
            Удалить
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

// ── Диалог добавления/редактирования ────────────────────────────────────────
const CURRENCIES = ["RUB", "USD", "EUR", "USDT", "KZT", "GEL"];
const FREQS: { value: string; label: string }[] = [
  { value: "", label: "Разово" },
  { value: "monthly", label: "Ежемесячно" },
  { value: "weekly", label: "Еженедельно" },
  { value: "custom", label: "Каждые N дней" },
];

function CreditPaymentDialog({
  payment,
  onClose,
}: {
  payment: CreditPayment | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [bank, setBank] = useState(payment?.bank ?? "");
  const [logoUrl, setLogoUrl] = useState(payment?.logoUrl ?? "");
  const [amount, setAmount] = useState(payment ? String(payment.amount) : "");
  const [currency, setCurrency] = useState(payment?.currency ?? "RUB");
  const [dueAt, setDueAt] = useState(
    payment ? payment.dueAt.slice(0, 10) : new Date().toISOString().slice(0, 10),
  );
  const [note, setNote] = useState(payment?.note ?? "");
  const [freq, setFreq] = useState(payment?.recurrence?.freq ?? "");
  const [interval, setInterval] = useState(payment?.recurrence?.interval ?? 1);
  const [until, setUntil] = useState(payment?.recurrence?.until ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!bank.trim()) {
      setError("Укажите банк");
      return;
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Сумма должна быть > 0");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const body = {
        bank: bank.trim(),
        logoUrl: logoUrl.trim() || null,
        amount: amt,
        currency,
        dueAt: `${dueAt}T00:00:00+03:00`,
        note: note.trim() || null,
        recurrence: freq
          ? {
              freq,
              interval: freq === "custom" ? Math.max(1, Number(interval) || 1) : 1,
              until: until || null,
            }
          : null,
      };
      if (payment) {
        await api(`/finance/payments/${payment.id}`, { method: "PATCH", body });
      } else {
        await api("/finance/payments", { method: "POST", body });
      }
      queryClient.invalidateQueries({ queryKey: ["credit-payments"] });
      queryClient.invalidateQueries({ queryKey: ["finance-summary"] });
      toast.success(payment ? "Погашение обновлено" : "Погашение добавлено");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={payment ? "Редактировать погашение" : "Новое погашение"}>
      <div className="space-y-4">
        <Field label="Банк *">
          <Input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Сбер, Тинькофф…" autoFocus />
        </Field>

        <Field label="URL логотипа (PNG)" hint={logoUrl ? "Логотип будет показан в виджете и таблице" : "Необязательно — иначе будут инициалы"}>
          <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://.../logo.png" />
        </Field>
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="preview" className="h-10 w-10 rounded object-contain" />
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Сумма *">
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
            />
          </Field>
          <Field label="Валюта">
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Дата платежа *">
          <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </Field>

        <Field label="Повторяемость">
          <Select value={freq} onChange={(e) => setFreq(e.target.value)}>
            {FREQS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </Select>
        </Field>

        {freq === "custom" && (
          <Field label="Интервал (дней)">
            <Input
              type="number"
              min={1}
              max={365}
              value={interval}
              onChange={(e) => setInterval(Number(e.target.value) || 1)}
            />
          </Field>
        )}

        {freq && (
          <Field label="Повторять до (включительно)">
            <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </Field>
        )}

        <Field label="Заметка">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Например: минимальный платёж" />
        </Field>

        {error && (
          <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button onClick={submit} loading={loading}>
            {payment ? "Сохранить" : "Добавить"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
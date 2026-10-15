"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyRound, LogIn, Mail, UserRound, Waves } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { useAuthStore, toast } from "@/lib/client/stores";
import { Button, Field, Input } from "@/components/ui";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [login, setLogin] = useState("");
  const [email, setEmail] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data =
        mode === "register"
          ? await api<{ user: never; accessToken: string }>("/auth/register", {
              method: "POST",
              body: { login, email, password },
            })
          : await api<{ user: never; accessToken: string }>("/auth/login", {
              method: "POST",
              body: { identifier, password },
            });
      setAuth(data.accessToken, data.user);
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка сети");
    } finally {
      setLoading(false);
    }
  }

  async function forgot(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api("/auth/forgot-password", { method: "POST", body: { email: forgotEmail } });
      toast.info("Проверьте лог сервера", "SMTP не настроен — токен сброса выводится в логе");
      setForgotOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="glass-strong rise-in w-full max-w-md rounded-3xl p-8">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400/25 to-indigo-500/25 shadow-[0_0_40px_rgba(34,211,238,0.25)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="Моя система" className="h-12 w-12 rounded-xl" />
        </div>
        <h1 className="font-display text-xl font-semibold tracking-wide text-slate-100">Моя система</h1>
        <p className="mt-1 text-sm text-slate-500">
          {mode === "login" ? "С возвращением. Войдите в свой контур." : "Создайте персональный контур управления."}
        </p>
      </div>

      {!forgotOpen ? (
        <form onSubmit={submit} className="space-y-4">
          {mode === "register" ? (
            <>
              <Field label="Логин">
                <div className="relative">
                  <UserRound size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <Input className="pl-9" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="3–32 символа" minLength={3} maxLength={32} required />
                </div>
              </Field>
              <Field label="Email">
                <div className="relative">
                  <Mail size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <Input className="pl-9" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
                </div>
              </Field>
            </>
          ) : (
            <Field label="Логин или email">
              <div className="relative">
                <UserRound size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <Input className="pl-9" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="login или you@example.com" required />
              </div>
            </Field>
          )}
          <Field label="Пароль">
            <div className="relative">
              <KeyRound size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <Input
                className="pl-9"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "register" ? "минимум 8 символов" : "••••••••"}
                minLength={mode === "register" ? 8 : 1}
                required
              />
            </div>
          </Field>

          {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>}

          <Button type="submit" loading={loading} className="w-full" size="lg">
            <LogIn size={16} />
            {mode === "login" ? "Войти" : "Создать аккаунт"}
          </Button>

          <div className="flex items-center justify-between pt-1 text-xs">
            {mode === "login" ? (
              <>
                <button type="button" onClick={() => setForgotOpen(true)} className="text-slate-500 transition hover:text-cyan-300">
                  Забыли пароль?
                </button>
                <Link href="/register" className="text-cyan-300/90 transition hover:text-cyan-200">
                  Регистрация
                </Link>
              </>
            ) : (
              <>
                <span className="text-slate-600">Уже есть аккаунт?</span>
                <Link href="/login" className="text-cyan-300/90 transition hover:text-cyan-200">
                  Войти
                </Link>
              </>
            )}
          </div>
        </form>
      ) : (
        <form onSubmit={forgot} className="space-y-4">
          <Field label="Email для восстановления">
            <Input type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} placeholder="you@example.com" required autoFocus />
          </Field>
          <Button type="submit" loading={loading} className="w-full">
            Отправить токен сброса
          </Button>
          <button type="button" onClick={() => setForgotOpen(false)} className="w-full text-center text-xs text-slate-500 transition hover:text-slate-300">
            ← Назад ко входу
          </button>
        </form>
      )}

      <div className="mt-8 flex items-center justify-center gap-2 text-[11px] text-slate-600">
        <Waves size={13} />
        Europe/Moscow · мультидевайс-синхронизация · PWA
      </div>
    </div>
  );
}
